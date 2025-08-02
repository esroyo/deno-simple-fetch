import { assertEquals, assertRejects } from './test-utils.ts';
import { createAgent } from './agent.ts';
import { createAgentPool } from './agent-pool.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('Agent Pool Concurrency', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('pool handles concurrent requests', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 5 });

            // Send multiple concurrent requests
            const requests = Array.from({ length: 10 }, (_, i) =>
                pool.send({
                    url: '/echo',
                    method: 'POST',
                    headers: new Headers({
                        'content-type': 'application/json',
                    }),
                    body: JSON.stringify({ requestId: i }),
                }).then((res) => {
                    assertEquals(res.status, 200);
                    return res.json();
                }).then((data) => {
                    assertEquals(data.method, 'POST');
                    return data;
                }));

            // Verify all requests completed successfully
            const results = await Promise.all(requests);
            assertEquals(results.length, 10);
        });

        await t.step('pool with limited agents', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 2 });

            // Send more requests than available agents
            const startTime = Date.now();
            const requests = Array.from({ length: 5 }, (_, i) =>
                pool.send({
                    url: '/slow', // Use slow endpoint to test queuing
                    method: 'GET',
                }).then((res) => {
                    assertEquals(res.status, 200);
                    return res.text();
                }));

            const results = await Promise.all(requests);
            const endTime = Date.now();

            assertEquals(results.length, 5);
            results.forEach((result) => assertEquals(result, 'Finally!'));

            // Should take longer than a single request due to limited agents
            assertEquals(endTime - startTime > 2000, true);
        });

        await t.step('pool agent timeout and cleanup', async () => {
            await using pool = createAgentPool(url, {
                poolMaxPerHost: 3,
                poolIdleTimeout: 100, // Very short timeout for testing
            });

            // Make some requests to create agents
            const response1 = await pool.send({
                url: '/text',
                method: 'GET',
            });
            await response1.text();

            // Wait for agents to timeout
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Make another request - should work fine with new agents
            const response2 = await pool.send({
                url: '/json',
                method: 'GET',
            });
            const json = await response2.json();
            assertEquals(json.message, 'Hello, JSON!');
        });

        await t.step('pool abort signal handling', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 2 });
            const controller = new AbortController();

            const requestPromise = pool.send({
                url: '/slow',
                method: 'GET',
                signal: controller.signal,
            });

            // Abort after short delay
            setTimeout(() => controller.abort(), 100);

            await assertRejects(() => requestPromise, Error);
        });

        await t.step('pool proper resource cleanup', async () => {
            const pool = createAgentPool(url, { poolMaxPerHost: 3 });

            // Make several requests
            const requests = Array.from({ length: 5 }, () =>
                pool.send({
                    url: '/text',
                    method: 'GET',
                }).then((res) => res.text()));

            await Promise.all(requests);

            // Close pool
            await pool.close();

            // Verify pool is properly closed by attempting another request
            await assertRejects(
                () =>
                    pool.send({
                        url: '/text',
                        method: 'GET',
                    }),
                Error,
            );
        });

        await t.step('pool Symbol.asyncDispose', async () => {
            await using pool = createAgentPool(url, { poolMaxPerHost: 2 });

            const response = await pool.send({
                url: '/text',
                method: 'GET',
            });
            const text = await response.text();
            assertEquals(text, 'Hello, World!');

            // Pool will be automatically disposed
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('Agent Pool vs Single Agent Performance', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('concurrent performance comparison', async () => {
            const numRequests = 20;

            // Test with single agent (sequential)
            const singleAgentStart = Date.now();
            using agent = createAgent(url);

            for (let i = 0; i < numRequests; i++) {
                const response = await agent.send({
                    url: '/text',
                    method: 'GET',
                });
                await response.text();
            }
            const singleAgentTime = Date.now() - singleAgentStart;

            // Test with agent pool (concurrent)
            const poolStart = Date.now();
            await using pool = createAgentPool(url, { poolMaxPerHost: 5 });

            const poolRequests = Array.from(
                { length: numRequests },
                () =>
                    pool.send({
                        url: '/text',
                        method: 'GET',
                    }).then((res) => res.text()),
            );

            await Promise.all(poolRequests);
            const poolTime = Date.now() - poolStart;

            // Pool should be significantly faster for concurrent requests
            // console.log(
            //     `Single agent time: ${singleAgentTime}ms, Pool time: ${poolTime}ms`,
            // );
            assertEquals(poolTime < singleAgentTime, true);
        });
    } finally {
        await server.shutdown();
    }
});
