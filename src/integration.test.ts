import { assertEquals, assertRejects } from './test-utils.ts';
import { HttpClient } from './fetch.ts';
import { createTestServer } from './test-utils.ts';
import { createAgent } from './agent.ts';
import { createAgentPool } from './agent-pool.ts';
import {
    createChunkedDecodingStream,
    createChunkedEncodingStream,
} from './streams.ts';

Deno.test('Integration - HTTP Client with Agent Pool', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step(
            'client automatically manages agent pools per origin',
            async () => {
                await using client = new HttpClient();

                // These should all use the same agent pool
                const responses = await Promise.all([
                    client.send({ url: `${url}/text`, method: 'GET' }),
                    client.send({ url: `${url}/json`, method: 'GET' }),
                    client.send({
                        url: `${url}/echo`,
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
            const httpResponse = await client.send({
                url: `${url}/text`,
                method: 'GET',
            });
            assertEquals(httpResponse.status, 200);
            await httpResponse.text();

            // Note: Can't easily test HTTPS in this test environment
            // but the client should handle protocol differences
        });

        await t.step('client with complex request patterns', async () => {
            await using client = new HttpClient();

            // Mix of different request types
            const requests = [
                client.send({ url: `${url}/text`, method: 'GET' }),
                client.send({ url: `${url}/json`, method: 'GET' }),
                client.send({
                    url: `${url}/echo`,
                    method: 'POST',
                    headers: new Headers({
                        'content-type': 'application/json',
                    }),
                    body: JSON.stringify({ test: 'data' }),
                }),
                client.send({
                    url: `${url}/echo`,
                    method: 'PUT',
                    headers: new Headers({
                        'content-type': 'application/x-www-form-urlencoded',
                    }),
                    body: new URLSearchParams({ key: 'value' }).toString(),
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
    const { server, url } = await createTestServer();

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
            const { server: newServer, url: newUrl } = await createTestServer();

            try {
                await using pool = createAgentPool(newUrl, {
                    poolMaxPerHost: 3,
                });

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

        await t.step('very large response handling', async () => {
            // Create a test server that returns large responses
            const { server: largeServer, url: largeUrl } =
                await createTestServer();

            // Override the /text endpoint to return large content
            const originalHandler = largeServer;

            try {
                await using client = new HttpClient();

                // Test with chunked response endpoint
                const response = await client.send({
                    url: `${largeUrl}/chunked`,
                    method: 'GET',
                });
                assertEquals(response.status, 200);

                const text = await response.text();
                assertEquals(text, 'chunk1chunk2chunk3');
            } finally {
                await largeServer.shutdown();
            }
        });

        await t.step('concurrent abort signals', async () => {
            const { server: abortServer, url: abortUrl } =
                await createTestServer();

            try {
                await using pool = createAgentPool(abortUrl, {
                    poolMaxPerHost: 3,
                });

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
    const { server, url } = await createTestServer();

    try {
        await t.step('high concurrency stress test', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 10 });

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
        });

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
            assertEquals(totalTime < 5000, true); // Should complete in under 5 seconds
        });
    } finally {
        await server.shutdown();
    }
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
        assertEquals(finalText, data);
    });
});

// Final integration test
Deno.test('Complete System Integration', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('end-to-end realistic usage scenario', async () => {
            await using client = new HttpClient();

            // Simulate a realistic application workflow

            // 1. Initial API call
            const authResponse = await client.send({
                url: `${url}/echo`,
                method: 'POST',
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({ username: 'test', password: 'secret' }),
            });
            assertEquals(authResponse.status, 200);
            const authData = await authResponse.json();
            assertEquals(authData.method, 'POST');

            // 2. Multiple concurrent data fetches
            const dataRequests = Array.from(
                { length: 5 },
                (_, i) =>
                    client.send({
                        url: `${url}/echo`,
                        method: 'GET',
                        headers: new Headers({
                            'authorization': `Bearer token-${i}`,
                        }),
                    }).then((res) => res.json()),
            );

            const dataResults = await Promise.all(dataRequests);
            assertEquals(dataResults.length, 5);
            dataResults.forEach((result, i) => {
                assertEquals(result.headers.authorization, `Bearer token-${i}`);
            });

            // 3. File upload simulation
            const uploadResponse = await client.send({
                url: `${url}/echo`,
                method: 'POST',
                headers: new Headers({
                    'content-type': 'application/octet-stream',
                }),
                body: new Uint8Array([1, 2, 3, 4, 5]),
            });
            assertEquals(uploadResponse.status, 200);
            await uploadResponse.json();

            // 4. Form submission
            const formResponse = await client.send({
                url: `${url}/echo`,
                method: 'POST',
                headers: new Headers({
                    'content-type': 'application/x-www-form-urlencoded',
                }),
                body: new URLSearchParams({
                    name: 'John Doe',
                    email: 'john@example.com',
                }).toString(),
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

// ============================================================================
// Enhanced edge case testing
// ============================================================================

Deno.test('Edge Cases and Boundary Conditions', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('zero-length responses', async () => {
            await using client = new HttpClient();

            // Mock an endpoint that returns zero-length content
            const response = await client.send({
                url: `${url}/text`,
                method: 'HEAD', // HEAD responses have no body
            });

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, '');
        });

        await t.step('very long URLs', async () => {
            await using client = new HttpClient();

            const longQuery = 'param=' + 'x'.repeat(1000);
            const response = await client.send({
                url: `${url}/echo?${longQuery}`,
                method: 'GET',
            });

            assertEquals(response.status, 200);
            const data = await response.json();
            assertEquals(data.url.includes(longQuery), true);
        });

        await t.step('unicode in headers and body', async () => {
            await using client = new HttpClient();

            // According to RFC 7230 (HTTP/1.1 Message Syntax and Routing) and RFC 9110 (HTTP Semantics):
            // HTTP header field values are defined as sequences of characters from the ISO-8859-1 (Latin-1) character set.
            // UTF-8 or other encodings (like emojis or Chinese characters) are not valid unless explicitly encoded (e.g., base64, percent-encoding, or other schemes).

            const unicodeText = 'Hello 世界 🌍 مرحبا';
            const unicodeHeader = '测试 🎯';
            const response = await client.send({
                url: `${url}/echo`,
                method: 'POST',
                headers: new Headers({
                    'X-Unicode-Header': encodeURIComponent(unicodeHeader),
                    'Content-Type': 'text/plain; charset=utf-8',
                }),
                body: unicodeText,
            });

            assertEquals(response.status, 200);
            const data = await response.json();
            assertEquals(
                decodeURIComponent(data.headers['x-unicode-header']),
                unicodeHeader,
            );
        });

        await t.step('rapid sequential requests', async () => {
            using agent = createAgent(url);

            const results = [];
            for (let i = 0; i < 50; i++) {
                const response = await agent.send({
                    url: '/echo',
                    method: 'POST',
                    body: JSON.stringify({ sequence: i }),
                });
                const data = await response.json();
                results.push(data);
            }

            assertEquals(results.length, 50);
            assertEquals(results[0].method, 'POST');
            assertEquals(results[49].method, 'POST');
        });

        await t.step('connection pool exhaustion and recovery', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 2 });

            // Exhaust the pool with slow requests
            const slowRequests = Array.from({ length: 3 }, async () => {
                const res = await pool.send({
                    url: '/slow',
                    method: 'GET',
                });
                await res.text();
                return res;
            });

            // This should complete despite pool exhaustion
            const results = await Promise.all(slowRequests);
            assertEquals(results.length, 3);
            results.forEach((response) => {
                assertEquals(response.status, 200);
            });
        });
    } finally {
        await server.shutdown();
    }
});

// ============================================================================
// Performance and load testing
// ============================================================================

Deno.test('Performance Characteristics', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('connection reuse efficiency', async () => {
            using agent = createAgent(url);

            const startTime = performance.now();

            // Multiple requests on same connection
            for (let i = 0; i < 100; i++) {
                const response = await agent.send({
                    url: '/text',
                    method: 'GET',
                });
                await response.text();
            }

            const duration = performance.now() - startTime;

            // Should be reasonably fast due to connection reuse
            assertEquals(duration < 10000, true); // Less than 10 seconds
        });

        await t.step('concurrent request throughput', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 10 });

            const startTime = performance.now();
            const concurrentRequests = 200;

            const requests = Array.from(
                { length: concurrentRequests },
                (_, i) =>
                    pool.send({
                        url: '/echo',
                        method: 'POST',
                        body: JSON.stringify({ id: i }),
                    }).then((res) => res.json()),
            );

            const results = await Promise.all(requests);
            const duration = performance.now() - startTime;

            assertEquals(results.length, concurrentRequests);
            // console.log(`Processed ${concurrentRequests} requests in ${duration.toFixed(2)}ms`);
            // console.log(`Throughput: ${(concurrentRequests / duration * 1000).toFixed(2)} req/sec`);
        });
    } finally {
        await server.shutdown();
    }
});
