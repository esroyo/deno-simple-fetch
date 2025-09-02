// Chunked encoding using TransformStream
export function createChunkedEncodingStream(): TransformStream<
    Uint8Array,
    Uint8Array
> {
    const encoder = new TextEncoder();

    return new TransformStream({
        transform(chunk, controller) {
            // Skip empty chunks to avoid premature termination
            if (chunk.length === 0) {
                return;
            }

            const chunkSize = chunk.length.toString(16);
            controller.enqueue(encoder.encode(`${chunkSize}\r\n`));
            controller.enqueue(chunk);
            controller.enqueue(encoder.encode('\r\n'));
        },

        flush(controller) {
            controller.enqueue(encoder.encode('0\r\n\r\n'));
        },
    });
}

// Chunked decoding using TransformStream
export function createChunkedDecodingStream(
    abortController?: AbortController,
): TransformStream<
    Uint8Array,
    Uint8Array
> {
    const decoder = new TextDecoder();
    let buffer = new Uint8Array(0);
    let state: 'size' | 'data' | 'after_chunk' | 'trailer' | 'done' = 'size';
    let chunkSize = 0;
    let chunkBytesRead = 0;
    let totalBytesProcessed = 0;

    function appendToBuffer(newData: Uint8Array) {
        const combined = new Uint8Array(buffer.length + newData.length);
        combined.set(buffer);
        combined.set(newData, buffer.length);
        buffer = combined;
    }

    function readLine(): string | null {
        const { pos: crlfIndex, length } = findLineEnd(buffer);
        if (crlfIndex === -1) return null;

        const line = decoder.decode(buffer.slice(0, crlfIndex));
        buffer = buffer.slice(crlfIndex + length);
        return line;
    }

    function findLineEnd(data: Uint8Array): { pos: number; length: number } {
        for (let i = 0; i < data.length; i += 1) {
            // Check for CRLF first
            if (
                i < data.length - 1 &&
                data[i] === 0x0D && data[i + 1] === 0x0A
            ) {
                return { pos: i, length: 2 }; // Skip both \r\n
            }
            // Check for LF only
            if (data[i] === 0x0A) {
                return { pos: i, length: 1 }; // Skip just \n
            }
        }
        return { pos: -1, length: 0 };
    }

    // Strict validation for chunk size line format
    function validateChunkSizeLine(sizeLine: string): void {
        // Must contain only hex digits and optional whitespace
        const trimmed = sizeLine.trim();
        if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
            throw new Error(`Invalid chunk size format: "${sizeLine}"`);
        }
    }

    return new TransformStream({
        transform(chunk, controller) {
            totalBytesProcessed += chunk.length;

            appendToBuffer(chunk);

            while (buffer.length > 0 && state !== 'done') {
                if (state === 'size') {
                    const sizeLine = readLine();
                    if (sizeLine === null) break;

                    // Strict validation: chunk size must be followed by CRLF
                    validateChunkSizeLine(sizeLine);

                    const sizeStr = sizeLine.trim();
                    chunkSize = parseInt(sizeStr, 16);

                    if (chunkSize === 0) {
                        state = 'trailer';
                        continue;
                    }

                    state = 'data';
                    chunkBytesRead = 0;
                } else if (state === 'data') {
                    const bytesNeeded = chunkSize - chunkBytesRead;
                    const bytesAvailable = Math.min(bytesNeeded, buffer.length);

                    if (bytesAvailable > 0) {
                        const dataChunk = buffer.slice(0, bytesAvailable);
                        controller.enqueue(dataChunk);
                        buffer = buffer.slice(bytesAvailable);
                        chunkBytesRead += bytesAvailable;
                    }

                    if (chunkBytesRead === chunkSize) {
                        state = 'after_chunk';
                    } else {
                        break;
                    }
                } else if (state === 'after_chunk') {
                    if (
                        buffer.length >= 2 && buffer[0] === 0x0D &&
                        buffer[1] === 0x0A
                    ) {
                        buffer = buffer.slice(2);
                        state = 'size';
                    } else if (
                        buffer.length >= 1 && buffer[0] === 0x0A
                    ) {
                        buffer = buffer.slice(1);
                        state = 'size';
                    } else if (buffer.length === 1 && buffer[0] === 0x0D) {
                        break;
                    } else if (buffer.length === 0) {
                        break;
                    } else {
                        controller.error(
                            new Error('Expected CRLF after chunk data'),
                        );
                        return;
                    }
                } else if (state === 'trailer') {
                    const trailerLine = readLine();
                    if (trailerLine === null) break;

                    if (trailerLine === '') {
                        state = 'done';
                        controller.terminate();
                        abortController?.abort();
                        return;
                    }
                }
            }
        },

        flush(controller) {
            // Clean up any remaining buffer
            buffer = new Uint8Array(0);

            if (
                state === 'data' && chunkBytesRead > 0 &&
                chunkBytesRead < chunkSize
            ) {
                controller.error(new Error('Incomplete chunked data'));
            }
        },
    });
}

// Connection to ReadableStream
export function connectionToReadableStream(
    conn: Deno.Conn,
): ReadableStream<Uint8Array> {
    const buffer = new Uint8Array(8192);
    return new ReadableStream({
        async pull(controller) {
            try {
                const bytesRead = await conn.read(buffer);
                if (bytesRead === null) {
                    controller.close();
                    return;
                }
                controller.enqueue(buffer.slice(0, bytesRead));
            } catch (error) {
                controller.error(error);
            }
        },
    }, { highWaterMark: 0 });
}
