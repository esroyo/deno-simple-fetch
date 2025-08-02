import { assertEquals, assertRejects } from './test-utils.ts';
import {
    createChunkedDecodingStream,
    createChunkedEncodingStream,
    StreamingResponseReader,
} from './streams.ts';

Deno.test('Stream Utilities - Advanced Cases', async (t) => {
    await t.step('chunked encoding with empty chunks', async () => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const sourceStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('')); // Empty chunk
                controller.enqueue(encoder.encode('data'));
                controller.enqueue(encoder.encode('')); // Another empty chunk
                controller.close();
            },
        });

        const processedStream = sourceStream
            .pipeThrough(createChunkedEncodingStream())
            .pipeThrough(createChunkedDecodingStream());

        const reader = processedStream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const result = decoder.decode(
            new Uint8Array(
                chunks.reduce(
                    (acc, chunk) => [...acc, ...chunk],
                    [] as number[],
                ),
            ),
        );

        assertEquals(result, 'data');
    });

    await t.step('chunked decoding with malformed data', async () => {
        const encoder = new TextEncoder();

        // Missing CRLF after chunk size
        const malformedData = '5\ndata\r\n0\r\n\r\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(malformedData));
                controller.close();
            },
        });

        const decodingStream = stream.pipeThrough(
            createChunkedDecodingStream(),
        );
        const reader = decodingStream.getReader();

        await assertRejects(
            async () => {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                }
            },
            Error,
        );
    });

    await t.step('chunked decoding with trailer headers', async () => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Chunked data with trailer headers
        const chunkedData = '5\r\nhello\r\n0\r\nX-Trailer: value\r\n\r\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(chunkedData));
                controller.close();
            },
        });

        const decodingStream = stream.pipeThrough(
            createChunkedDecodingStream(),
        );
        const reader = decodingStream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const result = decoder.decode(
            new Uint8Array(
                chunks.reduce(
                    (acc, chunk) => [...acc, ...chunk],
                    [] as number[],
                ),
            ),
        );

        assertEquals(result, 'hello');
    });

    await t.step('streaming response reader with backpressure', async () => {
        const totalSize = 10000; // 10KB
        const chunkSize = 1000; // 1KB chunks

        const stream = new ReadableStream({
            start(controller) {
                for (let i = 0; i < totalSize; i += chunkSize) {
                    const chunk = new Uint8Array(
                        Math.min(chunkSize, totalSize - i),
                    );
                    chunk.fill(i % 256);
                    controller.enqueue(chunk);
                }
                controller.close();
            },
        });

        const reader = new StreamingResponseReader(stream, totalSize + 1000); // Allow slightly more
        let totalRead = 0;

        for await (const chunk of reader.readChunks()) {
            totalRead += chunk.length;
        }

        assertEquals(totalRead, totalSize);
        assertEquals(reader.bytesRead, totalSize);
    });
});

Deno.test('Memory Limits - Chunked Encoding Size Limits', async (t) => {
    await t.step('chunked decoder respects response size limits', async () => {
        const encoder = new TextEncoder();
        const maxSize = 500; // 500 bytes limit

        // Create chunked encoded data that exceeds the limit
        const createLargeChunkedData = () => {
            const chunks = [];
            // Create chunks totaling ~800 bytes (exceeds 500 byte limit)
            for (let i = 0; i < 4; i++) {
                const data = `chunk${i}`.repeat(25); // ~150 bytes per chunk
                const size = data.length.toString(16);
                chunks.push(`${size}\r\n${data}\r\n`);
            }
            chunks.push('0\r\n\r\n'); // End chunk
            return chunks.join('');
        };

        const chunkedData = createLargeChunkedData();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(chunkedData));
                controller.close();
            },
        });

        const decodingStream = stream.pipeThrough(
            createChunkedDecodingStream({ maxResponseSize: maxSize }),
        );

        const reader = decodingStream.getReader();

        await assertRejects(
            async () => {
                const chunks = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
            },
            Error,
            'Response size limit exceeded: 500 bytes',
        );
    });

    await t.step('chunked decoder respects chunk size limits', async () => {
        const encoder = new TextEncoder();
        const maxChunkSize = 50; // 50 bytes max chunk size

        // Create a chunk size that exceeds the limit but send it gradually
        // to avoid hitting buffer limits before chunk size validation
        const largeChunkSize = 100; // 100 bytes (exceeds 50 byte limit)
        const chunkSizeHex = largeChunkSize.toString(16); // "64"

        // Send just the chunk size line first - this should trigger the chunk size validation
        const chunkedData = `${chunkSizeHex}\r\n`;

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(chunkedData));
                controller.close();
            },
        });

        const decodingStream = stream.pipeThrough(
            createChunkedDecodingStream({
                maxChunkSize,
                maxResponseSize: 10000, // Set high to avoid response size limit
            }),
        );

        const reader = decodingStream.getReader();

        await assertRejects(
            async () => {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                }
            },
            Error,
            'Chunk size 100 exceeds limit 50',
        );
    });

    await t.step(
        'buffer size limit prevents excessive memory usage',
        async () => {
            const encoder = new TextEncoder();

            // Strategy: Send incomplete chunk size lines to force buffer accumulation
            // The decoder will keep waiting for CRLF to complete the line, causing buffer growth
            const maxBufferSize = 128 * 1024; // Default max buffer size from streams.ts

            const stream = new ReadableStream({
                start(controller) {
                    // Send data that looks like it could be a chunk size but never complete it with CRLF
                    // This forces the decoder to accumulate data in the buffer while waiting for line completion
                    const partialHex = '1234567890abcdef'; // Valid hex characters
                    const repetitions = Math.ceil(
                        (maxBufferSize + 1000) / partialHex.length,
                    );

                    // Send the partial hex data in small chunks to simulate slow network
                    for (let i = 0; i < repetitions; i++) {
                        controller.enqueue(encoder.encode(partialHex));
                    }

                    controller.close(); // Close without ever sending CRLF
                },
            });

            const decodingStream = stream.pipeThrough(
                createChunkedDecodingStream(),
            );

            const reader = decodingStream.getReader();

            await assertRejects(
                async () => {
                    let iterations = 0;
                    while (iterations < 200) { // Safety limit
                        try {
                            const { done, value } = await reader.read();
                            if (done) break;
                        } catch (error) {
                            // Re-throw to be caught by assertRejects
                            throw error;
                        }
                        iterations++;
                    }

                    // If we reach here without error, fail the test
                    throw new Error(
                        'Expected buffer size limit error but none occurred',
                    );
                },
                Error,
                'Buffer size limit exceeded',
            );
        },
    );
});
