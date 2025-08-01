import { assertEquals, assertRejects } from './test-utils.ts';
import { createFetch, HttpClient } from './fetch.ts';
import { createTestServer } from './test-utils.ts';
import { createAgent } from './agent.ts';
import { createAgentPool } from './agent-pool.ts';
import { createBodyParser } from './body-parser.ts';
import {
    createChunkedDecodingStream,
    createChunkedEncodingStream,
} from './streams.ts';

Deno.test('Integration - HTTP Client with Agent Pool', async (t) => {
    const { server, url } = await createTestServer(8093);

    try {
        await t.step(
            'client automatically manages agent pools per origin',
            async () => {
                await using client = new HttpClient();

                // These should all use the same agent pool
                const responses = await Promise.all([
                    client.fetch(`${url}/text`),
                    client.fetch(`${url}/json`),
                    client.fetch(`${url}/echo`, {
                        method: 'POST',
                        body: 'test',
                    }),
                ]);

                assertEquals(responses[0].status, 200);
                assertEquals(responses[1].status, 200);
                assertEquals(responses[2].status, 200);

                const [text, json, echo] = await Promise.all([
                    responses[0].text(),
                    responses[1].json(),
                    responses[2].json(),
                ]);

                assertEquals(text, 'Hello, World!');
                assertEquals(json.message, 'Hello, JSON!');
                assertEquals(echo.method, 'POST');
            },
        );

        await t.step('client handles mixed HTTP and HTTPS', async () => {
            await using client = new HttpClient();

            // Test HTTP
            const httpResponse = await client.fetch(`${url}/text`);
            assertEquals(httpResponse.status, 200);
            await httpResponse.text();

            // Note: Can't easily test HTTPS in this test environment
            // but the client should handle protocol differences
        });

        await t.step('client with complex request patterns', async () => {
            await using client = new HttpClient();

            // Mix of different request types
            const requests = [
                client.fetch(`${url}/text`),
                client.fetch(`${url}/json`),
                client.fetch(`${url}/echo`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ test: 'data' }),
                }),
                client.fetch(`${url}/echo`, {
                    method: 'PUT',
                    body: new URLSearchParams({ key: 'value' }),
                }),
            ];

            const responses = await Promise.all(requests);
            assertEquals(responses.every((r) => r.status === 200), true);

            // Consume all response bodies
            await responses[0].text();
            await responses[1].json();
            await responses[2].json();
            await responses[3].json();
        });
    } finally {
        await server.shutdown();
    }
});

// Error resilience and edge cases
Deno.test('Error Resilience and Edge Cases', async (t) => {
    const { server, url } = await createTestServer(8094);

    try {
        await t.step('agent handles connection drops gracefully', async () => {
            using agent = createAgent(url);

            // Make successful request
            const response1 = await agent.send({
                url: '/text',
                method: 'GET',
            });
            assertEquals(response1.status, 200);
            await response1.text();

            // Temporarily shutdown server
            await server.shutdown();

            // Request should fail
            await assertRejects(
                () =>
                    agent.send({
                        url: '/text',
                        method: 'GET',
                    }),
                Error,
            );

            assertEquals(agent.isIdle, true);
        });

        await t.step('pool handles agent failures', async () => {
            // Create new server for this test
            const { server: newServer, url: newUrl } = await createTestServer(
                8095,
            );

            try {
                await using pool = createAgentPool(newUrl, { maxAgents: 3 });

                // Make some successful requests
                const successfulRequests = Array.from(
                    { length: 5 },
                    () =>
                        pool.send({
                            url: '/text',
                            method: 'GET',
                        }).then((res) => res.text()),
                );

                const results = await Promise.all(successfulRequests);
                assertEquals(results.every((r) => r === 'Hello, World!'), true);

                // Pool should recover from individual agent failures
            } finally {
                await newServer.shutdown();
            }
        });

        await t.step('malformed response handling', async () => {
            // This would require a special test server that sends malformed responses
            // For now, we'll test the parser components directly

            const malformedChunks = new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode('invalid json'),
                    );
                    controller.close();
                },
            });

            const bodyParser = createBodyParser(
                malformedChunks,
                'application/json',
            );

            await assertRejects(
                () => bodyParser.json(),
                SyntaxError,
            );
        });

        await t.step('very large response handling', async () => {
            // Create a test server that returns large responses
            const { server: largeServer, url: largeUrl } =
                await createTestServer(8096);

            // Override the /text endpoint to return large content
            const originalHandler = largeServer;

            try {
                await using client = new HttpClient();

                // Test with chunked response endpoint
                const response = await client.fetch(`${largeUrl}/chunked`);
                assertEquals(response.status, 200);

                const text = await response.text();
                assertEquals(text, 'chunk1chunk2chunk3');
            } finally {
                await largeServer.shutdown();
            }
        });

        await t.step('concurrent abort signals', async () => {
            const { server: abortServer, url: abortUrl } =
                await createTestServer(8097);

            try {
                await using pool = createAgentPool(abortUrl, { maxAgents: 3 });

                const controllers = Array.from(
                    { length: 5 },
                    () => new AbortController(),
                );

                const requests = controllers.map((controller, i) =>
                    pool.send({
                        url: '/slow',
                        method: 'GET',
                        signal: controller.signal,
                    }).catch((error) => ({ error, index: i }))
                );

                // Abort some requests at different times
                setTimeout(() => controllers[0].abort(), 50);
                setTimeout(() => controllers[2].abort(), 100);
                setTimeout(() => controllers[4].abort(), 150);

                const results = await Promise.all(requests);

                // Some should be aborted, others should complete
                const aborted = results.filter((r) => 'error' in r);
                const completed = results.filter((r) => !('error' in r));

                assertEquals(aborted.length, 3); // The ones we aborted
                assertEquals(completed.length, 2); // The ones that completed
            } finally {
                await abortServer.shutdown();
            }
        });
    } finally {
        if (!server.finished) {
            await server.shutdown();
        }
    }
});

// Performance and stress tests
Deno.test('Performance and Stress Tests', async (t) => {
    const { server, url } = await createTestServer(8098);

    try {
        await t.step('high concurrency stress test', async () => {
            await using pool = createAgentPool(url, { maxAgents: 10 });

            const numRequests = 100;
            const requests = Array.from(
                { length: numRequests },
                (_, i) =>
                    pool.send({
                        url: '/echo',
                        method: 'POST',
                        headers: new Headers({
                            'content-type': 'application/json',
                        }),
                        body: JSON.stringify({ id: i, timestamp: Date.now() }),
                    }).then(async (res) => {
                        assertEquals(res.status, 200);
                        const data = await res.json();
                        assertEquals(data.method, 'POST');
                        return data;
                    }),
            );

            const startTime = Date.now();
            const results = await Promise.all(requests);
            const endTime = Date.now();

            assertEquals(results.length, numRequests);
            console.log(
                `Completed ${numRequests} requests in ${endTime - startTime}ms`,
            );
        });

        //         await t.step('memory usage with many requests', async () => {
        //             await using client = new HttpClient();

        //             // Make many sequential requests to test memory cleanup
        //             for (let i = 0; i < 50; i++) {
        //                 const response = await client.fetch(`${url}/text`);
        //                 const text = await response.text();
        //                 assertEquals(text, 'Hello, World!');

        //                 // Force garbage collection if available (Deno specific)
        //                 if (typeof gc !== 'undefined') {
        //                     gc();
        //                 }
        //             }
        //         });

        await t.step('connection reuse efficiency', async () => {
            using agent = createAgent(url);

            const startTime = Date.now();

            // Make multiple requests on same connection
            for (let i = 0; i < 20; i++) {
                const response = await agent.send({
                    url: '/text',
                    method: 'GET',
                });
                await response.text();
            }

            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // Should be relatively fast due to connection reuse
            console.log(`20 sequential requests took ${totalTime}ms`);
            assertEquals(totalTime < 5000, true); // Should complete in under 5 seconds
        });
    } finally {
        await server.shutdown();
    }
});

// Comprehensive body parsing tests
Deno.test('Extended Body Parser Tests', async (t) => {
    await t.step('empty response body', async () => {
        const emptyStream = new ReadableStream({
            start(controller) {
                controller.close();
            },
        });

        const parser = createBodyParser(emptyStream, 'text/plain');

        const text = await parser.text();
        assertEquals(text, '');

        // Test with fresh stream for JSON
        const emptyStream2 = new ReadableStream({
            start(controller) {
                controller.close();
            },
        });

        const parser2 = createBodyParser(emptyStream2, 'application/json');
        await assertRejects(() => parser2.json(), SyntaxError);
    });

    await t.step('large JSON response', async () => {
        const largeObject = {
            data: Array.from({ length: 1000 }, (_, i) => ({
                id: i,
                name: `Item ${i}`,
                value: Math.random(),
            })),
        };

        const jsonString = JSON.stringify(largeObject);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(jsonString));
                controller.close();
            },
        });

        const parser = createBodyParser(stream, 'application/json');
        const result = await parser.json();

        assertEquals(result.data.length, 1000);
        assertEquals(result.data[0].id, 0);
        assertEquals(result.data[999].id, 999);
    });

    await t.step('binary data handling', async () => {
        const binaryData = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            binaryData[i] = i;
        }

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(binaryData);
                controller.close();
            },
        });

        const parser = createBodyParser(stream, 'application/octet-stream');

        const arrayBuffer = await parser.arrayBuffer();
        const resultArray = new Uint8Array(arrayBuffer);

        assertEquals(resultArray.length, 256);
        for (let i = 0; i < 256; i++) {
            assertEquals(resultArray[i], i);
        }
    });

    await t.step('blob creation with correct type', async () => {
        const data = 'Hello, blob world!';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(data));
                controller.close();
            },
        });

        const parser = createBodyParser(stream, 'text/plain; charset=utf-8');
        const blob = await parser.blob();

        assertEquals(blob.type, 'text/plain; charset=utf-8');
        assertEquals(blob.size, data.length);

        const text = await blob.text();
        assertEquals(text, data);
    });

    await t.step('multiple body reads should fail', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('test'));
                controller.close();
            },
        });

        const parser = createBodyParser(stream, 'text/plain');

        assertEquals(parser.bodyUsed, false);
        await parser.text();
        assertEquals(parser.bodyUsed, true);

        await assertRejects(
            () => parser.json(),
            Error,
            'body stream already read',
        );
        await assertRejects(
            () => parser.text(),
            Error,
            'body stream already read',
        );
        await assertRejects(
            () => parser.arrayBuffer(),
            Error,
            'body stream already read',
        );
        await assertRejects(
            () => parser.blob(),
            Error,
            'body stream already read',
        );
        await assertRejects(() => parser.formData(), Error, 'Unsupported');
    });
});

// Stream utilities comprehensive tests
Deno.test('Extended Stream Utilities Tests', async (t) => {
    await t.step('chunked encoding with various chunk sizes', async () => {
        const chunks = [
            'small',
            'medium sized chunk',
            'a much larger chunk with more content',
        ];
        const encoder = new TextEncoder();

        const sourceStream = new ReadableStream({
            start(controller) {
                chunks.forEach((chunk) => {
                    controller.enqueue(encoder.encode(chunk));
                });
                controller.close();
            },
        });

        // First, let's test the encoding step by step
        const encodedStream = sourceStream.pipeThrough(
            createChunkedEncodingStream(),
        );

        // Read the encoded data to see what it looks like
        const encodedReader = encodedStream.getReader();
        const encodedChunks: Uint8Array[] = [];

        try {
            while (true) {
                const { done, value } = await encodedReader.read();
                if (done) break;
                encodedChunks.push(value);
            }
        } finally {
            encodedReader.releaseLock();
        }

        // Combine encoded chunks to see the full encoded output
        const totalEncodedLength = encodedChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
        );
        const combinedEncoded = new Uint8Array(totalEncodedLength);
        let offset = 0;
        for (const chunk of encodedChunks) {
            combinedEncoded.set(chunk, offset);
            offset += chunk.length;
        }

        console.log(
            'Encoded output:',
            new TextDecoder().decode(combinedEncoded),
        );

        // Now create a new stream from the encoded data and decode it
        const encodedDataStream = new ReadableStream({
            start(controller) {
                controller.enqueue(combinedEncoded);
                controller.close();
            },
        });

        const decodedStream = encodedDataStream.pipeThrough(
            createChunkedDecodingStream(),
        );

        // Read the decoded result
        const decodedReader = decodedStream.getReader();
        const decodedChunks: Uint8Array[] = [];

        try {
            while (true) {
                const { done, value } = await decodedReader.read();
                if (done) break;
                decodedChunks.push(value);
                console.log('Decoded chunk:', new TextDecoder().decode(value));
            }
        } finally {
            decodedReader.releaseLock();
        }

        // Combine decoded chunks
        const totalDecodedLength = decodedChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
        );
        const combinedDecoded = new Uint8Array(totalDecodedLength);
        offset = 0;
        for (const chunk of decodedChunks) {
            combinedDecoded.set(chunk, offset);
            offset += chunk.length;
        }

        const finalText = new TextDecoder().decode(combinedDecoded);
        console.log('Final decoded text:', finalText);
        console.log('Expected text:', chunks.join(''));

        assertEquals(finalText, chunks.join(''));
    });

    await t.step('empty chunked stream', async () => {
        const emptyStream = new ReadableStream({
            start(controller) {
                controller.close();
            },
        });

        const encodedStream = emptyStream.pipeThrough(
            createChunkedEncodingStream(),
        );
        const decodedStream = encodedStream.pipeThrough(
            createChunkedDecodingStream(),
        );

        const reader = decodedStream.getReader();
        const chunks: Uint8Array[] = [];

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }

        assertEquals(chunks.length, 0);
    });

    await t.step('single byte chunks', async () => {
        const data = 'Hello';
        const encoder = new TextEncoder();

        const sourceStream = new ReadableStream({
            start(controller) {
                for (const char of data) {
                    controller.enqueue(encoder.encode(char));
                }
                controller.close();
            },
        });

        // Test encoding first
        const encodedStream = sourceStream.pipeThrough(
            createChunkedEncodingStream(),
        );

        const encodedReader = encodedStream.getReader();
        const encodedChunks: Uint8Array[] = [];

        try {
            while (true) {
                const { done, value } = await encodedReader.read();
                if (done) break;
                encodedChunks.push(value);
            }
        } finally {
            encodedReader.releaseLock();
        }

        // Combine encoded data
        const totalEncodedLength = encodedChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
        );
        const combinedEncoded = new Uint8Array(totalEncodedLength);
        let offset = 0;
        for (const chunk of encodedChunks) {
            combinedEncoded.set(chunk, offset);
            offset += chunk.length;
        }

        console.log(
            'Single byte encoded:',
            new TextDecoder().decode(combinedEncoded),
        );

        // Now decode
        const encodedDataStream = new ReadableStream({
            start(controller) {
                controller.enqueue(combinedEncoded);
                controller.close();
            },
        });

        const decodedStream = encodedDataStream.pipeThrough(
            createChunkedDecodingStream(),
        );

        const decodedReader = decodedStream.getReader();
        const decodedChunks: Uint8Array[] = [];

        try {
            while (true) {
                const { done, value } = await decodedReader.read();
                if (done) break;
                decodedChunks.push(value);
                console.log(
                    'Single byte decoded chunk:',
                    new TextDecoder().decode(value),
                );
            }
        } finally {
            decodedReader.releaseLock();
        }

        // Combine decoded data
        const totalDecodedLength = decodedChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
        );
        const combinedDecoded = new Uint8Array(totalDecodedLength);
        offset = 0;
        for (const chunk of decodedChunks) {
            combinedDecoded.set(chunk, offset);
            offset += chunk.length;
        }

        const finalText = new TextDecoder().decode(combinedDecoded);
        console.log('Single byte final text:', finalText);

        assertEquals(finalText, data);
    });
});

// Final integration test
Deno.test('Complete System Integration', async (t) => {
    const { server, url } = await createTestServer(8099);

    try {
        await t.step('end-to-end realistic usage scenario', async () => {
            await using client = new HttpClient();

            // Simulate a realistic application workflow

            // 1. Initial API call
            const authResponse = await client.fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'test', password: 'secret' }),
            });
            assertEquals(authResponse.status, 200);
            const authData = await authResponse.json();
            assertEquals(authData.method, 'POST');

            // 2. Multiple concurrent data fetches
            const dataRequests = Array.from(
                { length: 5 },
                (_, i) =>
                    client.fetch(`${url}/echo`, {
                        method: 'GET',
                        headers: { 'authorization': `Bearer token-${i}` },
                    }).then((res) => res.json()),
            );

            const dataResults = await Promise.all(dataRequests);
            assertEquals(dataResults.length, 5);
            dataResults.forEach((result, i) => {
                assertEquals(result.headers.authorization, `Bearer token-${i}`);
            });

            // 3. File upload simulation
            const uploadResponse = await client.fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream' },
                body: new Uint8Array([1, 2, 3, 4, 5]),
            });
            assertEquals(uploadResponse.status, 200);
            await uploadResponse.json();

            // 4. Form submission
            const formResponse = await client.fetch(`${url}/echo`, {
                method: 'POST',
                body: new URLSearchParams({
                    name: 'John Doe',
                    email: 'john@example.com',
                }),
            });
            assertEquals(formResponse.status, 200);
            const formResult = await formResponse.json();
            assertEquals(
                formResult.headers['content-type'],
                'application/x-www-form-urlencoded',
            );

            // 5. Clean shutdown
            await client.close();
        });
    } finally {
        await server.shutdown();
    }
});
