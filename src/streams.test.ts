import { assertEquals, assertRejects } from './test-utils.ts';
import {
    createChunkedDecodingStream,
    createChunkedEncodingStream,
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
});
