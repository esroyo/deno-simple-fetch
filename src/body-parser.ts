import type { StreamingOptions } from './types.ts';

export function createBodyParser(
    stream: ReadableStream<Uint8Array>,
    contentType: string,
    options: StreamingOptions = {},
): {
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    bodyUsed: boolean;
} {
    const {
        maxResponseSize = 100 * 1024 * 1024, // 100MB
        maxChunkSize = 64 * 1024, // 64KB
        enableBackpressure = true,
    } = options;

    let bodyUsed = false;
    let totalBytesRead = 0;

    function assertNotUsed() {
        if (bodyUsed) {
            throw new TypeError('body stream already read');
        }
        bodyUsed = true;
    }

    // Create a size-limited stream
    function createSizeLimitedStream(): ReadableStream<Uint8Array> {
        return stream.pipeThrough(
            new TransformStream({
                transform(chunk, controller) {
                    totalBytesRead += chunk.length;

                    if (totalBytesRead > maxResponseSize) {
                        controller.error(
                            new Error(
                                `Response size limit exceeded: ${maxResponseSize} bytes`,
                            ),
                        );
                        return;
                    }

                    // Enforce chunk size limits
                    if (chunk.length > maxChunkSize) {
                        // Split large chunks
                        for (let i = 0; i < chunk.length; i += maxChunkSize) {
                            const subChunk = chunk.slice(i, i + maxChunkSize);
                            controller.enqueue(subChunk);
                        }
                    } else {
                        controller.enqueue(chunk);
                    }
                },
            }),
        );
    }

    async function getArrayBufferWithLimits(): Promise<ArrayBuffer> {
        assertNotUsed();

        const limitedStream = createSizeLimitedStream();
        const chunks: Uint8Array[] = [];
        let totalLength = 0;

        try {
            for await (const chunk of limitedStream) {
                chunks.push(chunk);
                totalLength += chunk.length;

                // Implement backpressure by yielding control periodically
                if (enableBackpressure && totalLength % 100 === 0) {
                    await new Promise<void>((resolve) =>
                        globalThis.queueMicrotask(resolve)
                    );
                }
            }
        } catch (error) {
            // Clean up chunks to prevent memory leaks
            chunks.length = 0;
            throw error;
        }

        const arrayBuffer = new ArrayBuffer(totalLength);
        const view = new Uint8Array(arrayBuffer);

        let offset = 0;
        for (const chunk of chunks) {
            view.set(chunk, offset);
            offset += chunk.length;
        }

        // Clear chunks array to help GC
        chunks.length = 0;

        return arrayBuffer;
    }

    return {
        get bodyUsed(): boolean {
            return bodyUsed;
        },

        async json(): Promise<any> {
            const buffer = await getArrayBufferWithLimits();
            const text = new TextDecoder().decode(buffer);

            try {
                return JSON.parse(text);
            } catch (error) {
                throw new SyntaxError(
                    `Invalid JSON: ${
                        Error.isError(error) ? error.message : '-'
                    }`,
                );
            }
        },

        async text(): Promise<string> {
            const buffer = await getArrayBufferWithLimits();
            return new TextDecoder().decode(buffer);
        },

        async formData(): Promise<FormData> {
            if (contentType.includes('multipart/form-data')) {
                throw new Error(
                    'Multipart form data parsing requires additional implementation',
                );
            } else if (
                contentType.includes('application/x-www-form-urlencoded')
            ) {
                const text = await this.text();
                const formData = new FormData();
                const params = new URLSearchParams(text);
                for (const [key, value] of params) {
                    formData.append(key, value);
                }
                return formData;
            } else {
                throw new Error('Unsupported content type for form data');
            }
        },

        async blob(): Promise<Blob> {
            const buffer = await getArrayBufferWithLimits();
            return new Blob([buffer], {
                type: contentType || 'application/octet-stream',
            });
        },

        async arrayBuffer(): Promise<ArrayBuffer> {
            return getArrayBufferWithLimits();
        },
    };
}
