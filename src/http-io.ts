import {
    connectionToReadableStream,
    createChunkedDecodingStream,
    createChunkedEncodingStream,
} from './streams.ts';
import { UnexpectedEofError } from './errors.ts';

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

    protected _findLineEnd(): { pos: number; length: number } {
        for (let i = 0; i < this._buffer.length; i += 1) {
            // Check for CRLF first
            if (
                i < this._buffer.length - 1 &&
                this._buffer[i] === 0x0D && this._buffer[i + 1] === 0x0A
            ) {
                return { pos: i, length: 2 }; // Skip both \r\n
            }
            // Check for LF only
            if (this._buffer[i] === 0x0A) {
                return { pos: i, length: 1 }; // Skip just \n
            }
        }
        return { pos: -1, length: 0 };
    }

    async readLine(): Promise<string | null> {
        while (true) {
            const { pos: lineEnd, length } = this._findLineEnd();
            if (lineEnd !== -1) {
                const line = this._decoder.decode(
                    this._buffer.slice(0, lineEnd),
                );
                this._buffer = this._buffer.slice(lineEnd + length);
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
        url: URL;
        method: string;
        headers?: Headers;
        body?: string | Uint8Array | ReadableStream;
    },
): Promise<void> {
    const { method, headers = new Headers(), body } = request;

    const encoder = new TextEncoder();

    // Write request line
    const requestLine = `${method.toUpperCase()} ${request.url.pathname}${
        request.url.search || ''
    } HTTP/1.1\r\n`;
    await conn.write(encoder.encode(requestLine));

    if (!headers.has('host')) {
        headers.set('host', request.url.host);
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
    shouldIgnoreBody: (status: number) => boolean,
    onDone?: () => void,
): Promise<Response> {
    const lineReader = new LineReader(
        connectionToReadableStream(conn).getReader(),
    );
    const statusLine = await lineReader.readLine();
    if (statusLine === null) {
        throw new UnexpectedEofError();
    }

    const [_proto, status, ...statusTextParts] = statusLine.split(' ');
    const statusText = statusTextParts.join(' ');
    const statusParsed = parseInt(status);

    const headers = await lineReader.readHeaders();

    const ignoreBody = shouldIgnoreBody(statusParsed);
    if (ignoreBody) {
        headers.delete('content-length');
        headers.delete('transfer-encoding');
        headers.delete('content-encoding');
    }
    const contentLength = headers.get('content-length');
    const isChunked = headers.get('transfer-encoding')?.includes('chunked');
    const contentEncoding = headers.get('content-encoding');

    // Create body stream from remaining buffer and connection
    const remainingBuffer = lineReader.getRemainingBuffer();
    const abortController = new AbortController();
    let bodyStream: ReadableStream<Uint8Array> = new ReadableStream({
        async start(controller) {
            if (ignoreBody) {
                controller.close();
                onDone?.();
                return;
            }
            if (remainingBuffer.length > 0) {
                controller.enqueue(remainingBuffer);
            }
        },
        async pull(controller) {
            const stream = connectionToReadableStream(conn);
            const reader = stream.getReader();
            try {
                while (true) {
                    if (abortController.signal.aborted) break;
                    const { done, value } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            } finally {
                onDone?.();
            }
        },
        cancel(_reason) {
            onDone?.();
        },
    }, { highWaterMark: 0 });

    // Handle chunked encoding
    if (isChunked) {
        bodyStream = bodyStream.pipeThrough(
            createChunkedDecodingStream(abortController),
        );
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
                        abortController.abort();
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

    // Create standard Response object
    const response = new Response(bodyStream, {
        status: statusParsed,
        statusText,
        headers,
    });

    return response;
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
