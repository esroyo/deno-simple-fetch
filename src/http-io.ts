import { createAbortablePromise } from './utils.ts';
import {
    connectionToReadableStream,
    createChunkedDecodingStream,
    createChunkedEncodingStream,
} from './streams.ts';
import { UnexpectedEofError } from './errors.ts';
import { createBodyParser } from './body-parser.ts';
import { ResponseWithExtras, TimeoutOptions } from './types.ts';

// Line reader for HTTP headers using ReadableStream
export class LineReader {
    protected _buffer = new Uint8Array(0);
    protected _decoder = new TextDecoder();

    constructor(protected _reader: ReadableStreamDefaultReader<Uint8Array>) {}

    protected _appendToBuffer(newData: Uint8Array) {
        const combined = new Uint8Array(this._buffer.length + newData.length);
        combined.set(this._buffer);
        combined.set(newData, this._buffer.length);
        this._buffer = combined;
    }

    protected _findLineEnd(): number {
        for (let i = 0; i < this._buffer.length - 1; i++) {
            if (this._buffer[i] === 0x0D && this._buffer[i + 1] === 0x0A) {
                return i;
            }
        }
        return -1;
    }

    async readLine(): Promise<string | null> {
        while (true) {
            const lineEnd = this._findLineEnd();
            if (lineEnd !== -1) {
                const line = this._decoder.decode(
                    this._buffer.slice(0, lineEnd),
                );
                this._buffer = this._buffer.slice(lineEnd + 2);
                return line;
            }

            const { done, value } = await this._reader.read();
            if (done) {
                if (this._buffer.length > 0) {
                    const line = this._decoder.decode(this._buffer);
                    this._buffer = new Uint8Array(0);
                    return line;
                }
                return null;
            }

            this._appendToBuffer(value);
        }
    }

    async readHeaders(): Promise<Headers> {
        const headers = new Headers();

        while (true) {
            const line = await this.readLine();
            if (line === null || line === '') {
                break;
            }

            const colonIndex = line.indexOf(':');
            if (colonIndex !== -1) {
                const name = line.slice(0, colonIndex).trim().toLowerCase();
                const value = line.slice(colonIndex + 1).trim();
                headers.append(name, value);
            }
        }

        return headers;
    }

    getRemainingBuffer(): Uint8Array {
        return this._buffer;
    }
}

export async function writeRequest(
    conn: Deno.Conn,
    request: {
        url: string;
        method: string;
        headers?: Headers;
        body?: string | Uint8Array | ReadableStream;
    },
): Promise<void> {
    const { method, headers = new Headers(), body } = request;
    const url = new URL(request.url);

    const encoder = new TextEncoder();

    // Write request line
    const requestLine = `${method.toUpperCase()} ${url.pathname}${
        url.search || ''
    } HTTP/1.1\r\n`;
    await conn.write(encoder.encode(requestLine));

    if (!headers.has('host')) {
        headers.set('host', url.host);
    }

    let bodyStream: ReadableStream<Uint8Array> | undefined;

    if (body) {
        bodyStream = setupRequestBody(body, headers);
    }

    await writeHeaders(conn, headers);

    if (bodyStream) {
        await writeRequestBody(conn, bodyStream);
    }
}

export async function readResponse(
    conn: Deno.Conn,
    options: TimeoutOptions = {},
): Promise<ResponseWithExtras> {
    const lineReader = new LineReader(
        connectionToReadableStream(conn).getReader(),
    );
    const statusLine = await createAbortablePromise(
        lineReader.readLine(),
        options,
    );
    if (statusLine === null) {
        throw new UnexpectedEofError();
    }

    const [proto, status, ...statusTextParts] = statusLine.split(' ');
    const statusText = statusTextParts.join(' ');

    const headers = await createAbortablePromise(
        lineReader.readHeaders(),
        options,
    );

    const contentLength = headers.get('content-length');
    const isChunked = headers.get('transfer-encoding')?.includes('chunked');
    const contentEncoding = headers.get('content-encoding');

    // Create body stream from remaining buffer and connection
    const remainingBuffer = lineReader.getRemainingBuffer();
    let bodyStream: ReadableStream<Uint8Array> = new ReadableStream({
        async start(controller) {
            if (remainingBuffer.length > 0) {
                controller.enqueue(remainingBuffer);
            }
        },
        async pull(controller) {
            try {
                for await (const chunk of connectionToReadableStream(conn)) {
                    controller.enqueue(chunk);
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    }, { highWaterMark: 0 });

    // Handle chunked encoding
    if (isChunked) {
        bodyStream = bodyStream.pipeThrough(createChunkedDecodingStream());
    } else if (contentLength !== null) {
        const length = parseInt(contentLength);
        let bytesRead = 0;
        bodyStream = bodyStream.pipeThrough(
            new TransformStream({
                transform(chunk, controller) {
                    const remaining = length - bytesRead;
                    if (remaining <= 0) {
                        controller.terminate();
                        return;
                    }

                    const toEnqueue = chunk.slice(
                        0,
                        Math.min(chunk.length, remaining),
                    );
                    bytesRead += toEnqueue.length;
                    controller.enqueue(toEnqueue);

                    if (bytesRead >= length) {
                        controller.terminate();
                    }
                },
            }),
        );
    }

    // Handle compression
    if (contentEncoding) {
        if (contentEncoding.includes('gzip')) {
            bodyStream = bodyStream.pipeThrough(
                new DecompressionStream('gzip'),
            );
        } else if (contentEncoding.includes('deflate')) {
            bodyStream = bodyStream.pipeThrough(
                new DecompressionStream('deflate'),
            );
        }
    }

    const bodyParser = createBodyParser(
        bodyStream,
        headers.get('content-type') ?? '',
    );

    const statusParsed = parseInt(status);
    return {
        proto,
        status: statusParsed,
        statusText,
        headers,
        body: bodyStream,
        ok: statusParsed >= 200 && statusParsed < 300,
        ...bodyParser,
    };
}

function setupRequestBody(
    body: string | Uint8Array | ReadableStream,
    headers: Headers,
): ReadableStream<Uint8Array> {
    let stream: ReadableStream<Uint8Array>;

    if (typeof body === 'string') {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(body);
        stream = new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        });

        if (!headers.has('content-type')) {
            headers.set('content-type', 'text/plain; charset=UTF-8');
        }
        if (!headers.has('content-length')) {
            headers.set('content-length', bytes.byteLength.toString());
        }
    } else if (body instanceof Uint8Array) {
        stream = new ReadableStream({
            start(controller) {
                controller.enqueue(body);
                controller.close();
            },
        });

        if (!headers.has('content-length')) {
            headers.set('content-length', body.byteLength.toString());
        }
    } else {
        stream = body;
    }

    // Handle compression
    const contentEncoding = headers.get('content-encoding');
    if (contentEncoding?.includes('gzip')) {
        stream = stream.pipeThrough(new CompressionStream('gzip'));
    } else if (contentEncoding?.includes('deflate')) {
        stream = stream.pipeThrough(new CompressionStream('deflate'));
    }

    // Handle chunked encoding
    const transferEncoding = headers.get('transfer-encoding');
    const isChunked = transferEncoding?.includes('chunked') ?? false;

    if (isChunked) {
        stream = stream.pipeThrough(createChunkedEncodingStream());
    } else if (
        !headers.has('content-length') && !headers.has('transfer-encoding')
    ) {
        headers.set('transfer-encoding', 'chunked');
        stream = stream.pipeThrough(createChunkedEncodingStream());
    }

    if (!headers.has('content-type')) {
        headers.set('content-type', 'application/octet-stream');
    }

    return stream;
}

async function writeHeaders(conn: Deno.Conn, headers: Headers): Promise<void> {
    if (!headers.has('date')) {
        headers.set('date', new Date().toUTCString());
    }

    const encoder = new TextEncoder();
    const headerLines: string[] = [];
    for (const [key, value] of headers) {
        headerLines.push(`${key}: ${value}`);
    }
    headerLines.push('\r\n');

    const headerText = headerLines.join('\r\n');
    await conn.write(encoder.encode(headerText));
}

async function writeRequestBody(
    conn: Deno.Conn,
    stream: ReadableStream<Uint8Array>,
): Promise<void> {
    for await (const chunk of stream) {
        await conn.write(chunk);
    }
}
