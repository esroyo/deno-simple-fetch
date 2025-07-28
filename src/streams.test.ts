import { assertEquals } from './test-utils.ts';
import {
    createChunkedDecodingStream,
    createChunkedEncodingStream,
} from './streams.ts';

Deno.test('Stream utilities', async (t) => {
    await t.step('chunked encoding/decoding round trip', async () => {
        const originalData = 'Hello, chunked world!';
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Create source stream
        const sourceStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(originalData));
                controller.close();
            },
        });

        // Encode then decode
        const processedStream = sourceStream
            .pipeThrough(createChunkedEncodingStream())
            .pipeThrough(createChunkedDecodingStream());

        // Read result
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

        assertEquals(result, originalData);
    });
});
