import { assertEquals, assertRejects } from './test-utils.ts';
import { createAgent } from './agent.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('Agent - Connection Management', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('agent reuses connections', async () => {
            using agent = createAgent(url);

            // First request establishes connection
            const response1 = await agent.send({
                url: '/text',
                method: 'GET',
            });
            assertEquals(response1.status, 200);
            await response1.text();

            // Second request should reuse connection
            const response2 = await agent.send({
                url: '/json',
                method: 'GET',
            });
            assertEquals(response2.status, 200);
            await response2.json();
        });

        await t.step('agent handles connection errors gracefully', async () => {
            using agent = createAgent(url);

            // Make successful request first
            const response1 = await agent.send({
                url: '/text',
                method: 'GET',
            });
            await response1.text();

            // Close server to simulate connection drop
            await server.shutdown();

            // Next request should fail but agent should handle it
            await assertRejects(
                () =>
                    agent.send({
                        url: '/text',
                        method: 'GET',
                    }),
                Error,
            );

            // Agent should be idle after error
            assertEquals(agent.isIdle, true);
        });

        await t.step('agent validates request URLs', async () => {
            using agent = createAgent(url);

            // Try to send request to different origin
            await assertRejects(
                () =>
                    agent.send({
                        url: 'http://different-host.com/test',
                        method: 'GET',
                    }),
                Error,
                'Request to send',
            );
        });

        await t.step('agent handles protocol validation', async () => {
            await assertRejects(
                async () => createAgent('ftp://example.com'),
                Error,
                'Unsupported protocol',
            );

            await assertRejects(
                async () => createAgent('ws://example.com'),
                Error,
                'Unsupported protocol',
            );
        });

        await t.step('agent supports HTTP and HTTPS', async () => {
            // HTTP agent
            using httpAgent = createAgent('http://example.com');
            assertEquals(httpAgent.hostname, 'example.com');
            assertEquals(httpAgent.port, 80);

            // HTTPS agent
            using httpsAgent = createAgent('https://example.com');
            assertEquals(httpsAgent.hostname, 'example.com');
            assertEquals(httpsAgent.port, 443);

            // Custom port
            using customAgent = createAgent('http://example.com:8080');
            assertEquals(customAgent.port, 8080);
        });
    } finally {
        if (!server.finished) {
            await server.shutdown();
        }
    }
});

Deno.test('Agent - Request Processing', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('agent handles different HTTP methods', async () => {
            using agent = createAgent(url);

            const methods = [
                'GET',
                'POST',
                'PUT',
                'DELETE',
                'PATCH',
                'HEAD',
                'OPTIONS',
            ];

            for (const method of methods) {
                const response = await agent.send({
                    url: '/echo',
                    method,
                    body: method === 'GET' || method === 'HEAD'
                        ? undefined
                        : 'test',
                });
                assertEquals(response.status, 200);

                if (method !== 'HEAD') {
                    const data = await response.json();
                    assertEquals(data.method, method);
                }
            }
        });

        await t.step('agent handles custom headers', async () => {
            using agent = createAgent(url);

            const customHeaders = new Headers({
                'X-Custom-Header': 'test-value',
                'Authorization': 'Bearer token123',
            });

            const response = await agent.send({
                url: '/echo',
                method: 'GET',
                headers: customHeaders,
            });

            const data = await response.json();
            assertEquals(data.headers['x-custom-header'], 'test-value');
            assertEquals(data.headers['authorization'], 'Bearer token123');
        });

        await t.step('agent handles different body types', async () => {
            using agent = createAgent(url);

            // String body
            const stringResponse = await agent.send({
                url: '/echo',
                method: 'POST',
                body: 'string body',
            });
            assertEquals(stringResponse.status, 200);
            agent.close();

            // Uint8Array body
            const binaryResponse = await agent.send({
                url: '/echo',
                method: 'POST',
                body: new Uint8Array([1, 2, 3, 4, 5]),
            });
            assertEquals(binaryResponse.status, 200);
            agent.close();

            // ReadableStream body
            const streamBody = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('stream body'));
                    controller.close();
                },
            });
            const streamResponse = await agent.send({
                url: '/echo',
                method: 'POST',
                body: streamBody,
            });
            assertEquals(streamResponse.status, 200);
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('Agent - Concurrency', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('single agent handles sequential requests', async () => {
            using agent = createAgent(url);

            // First request
            const response1 = await agent.send({
                url: '/text',
                method: 'GET',
            });
            assertEquals(response1.status, 200);
            const text1 = await response1.text();
            assertEquals(text1, 'Hello, World!');

            // Second request on same agent (connection reuse)
            const response2 = await agent.send({
                url: '/json',
                method: 'GET',
            });
            assertEquals(response2.status, 200);
            const json2 = await response2.json();
            assertEquals(json2.message, 'Hello, JSON!');
        });

        await t.step('single agent blocks concurrent requests', async () => {
            using agent = createAgent(url);

            // Start a slow request
            const slowRequest = agent.send({
                url: '/slow',
                method: 'GET',
            });

            // Try concurrent request - should fail immediately
            await assertRejects(
                async () =>
                    await agent.send({
                        url: '/text',
                        method: 'GET',
                    }),
                Error,
                'Agent is busy',
            );

            // Wait for slow request to complete
            const response = await slowRequest;
            assertEquals(response.status, 200);
            await response.text();

            // Now agent should be available
            const response2 = await agent.send({
                url: '/text',
                method: 'GET',
            });
            assertEquals(response2.status, 200);
            await response2.text();
        });

        await t.step('agent state tracking', async () => {
            using agent = createAgent(url);

            assertEquals(agent.isIdle, true);

            const requestPromise = agent.send({
                url: '/slow',
                method: 'GET',
            });

            // Agent should be busy during request
            assertEquals(agent.isIdle, false);

            const res = await requestPromise;
            await res.text();

            // Agent should be idle after request
            assertEquals(agent.isIdle, true);
        });

        await t.step('agent whenIdle promise', async () => {
            using agent = createAgent(url);

            let idleResolved = false;
            agent.whenIdle().then(() => {
                idleResolved = true;
            });

            // Should already be resolved since agent is idle
            await new Promise((resolve) => setTimeout(resolve, 10));
            assertEquals(idleResolved, true);

            // Start a request
            const requestPromise = agent.send({
                url: '/slow',
                method: 'GET',
            });

            // Reset flag
            idleResolved = false;
            agent.whenIdle().then(() => {
                idleResolved = true;
            });

            // Should not be resolved yet
            assertEquals(idleResolved, false);

            // Complete the request
            const response = await requestPromise;
            await response.text();

            // Now should be resolved
            await new Promise((resolve) => setTimeout(resolve, 10));
            assertEquals(idleResolved, true);
        });

        await t.step('agent lastUsed tracking', async () => {
            using agent = createAgent(url);

            const initialTime = agent.lastUsed;

            // Make a request after a small delay
            await new Promise((resolve) => setTimeout(resolve, 10));
            const response = await agent.send({
                url: '/text',
                method: 'GET',
            });
            await response.text();

            // lastUsed should be updated
            assertEquals(agent.lastUsed > initialTime, true);
        });

        await t.step(
            'not consumed responses will close the connection when garbage collected',
            async () => {
                using agent = createAgent(url);

                await (async () => {
                    const response1 = await agent.send({
                        url: '/text',
                        method: 'GET',
                    });
                    assertEquals(response1.status, 200);
                    // Note: not consuming the body
                })();

                const idlePromise = agent.whenIdle();

                // Force garbage collection multiple times
                for (let i = 0; i < 5; i += 1) {
                    // @ts-ignore
                    globalThis?.gc?.();
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }

                // Clean-up should free the agent
                await idlePromise;

                // Second request would be able to reuse the same agent
                const response2 = await agent.send({
                    url: '/json',
                    method: 'GET',
                });
                assertEquals(response2.status, 200);
            },
        );

        await t.step('agent connection error handling', async () => {
            using agent = createAgent(url);

            // Close the test server to simulate connection error
            await server.shutdown();

            await assertRejects(
                () =>
                    agent.send({
                        url: '/text',
                        method: 'GET',
                    }),
                Error,
            );

            // Agent should still be idle after error
            assertEquals(agent.isIdle, true);
        });
    } finally {
        if (!server.finished) {
            await server.shutdown();
        }
    }
});
