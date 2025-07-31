import { assertEquals, assertRejects } from './test-utils.ts';
import { createAgent } from './agent.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('HTTP Agent', async (t) => {
    const { server, url } = await createTestServer(8081);

    try {
        await t.step('basic GET request', async () => {
            using agent = createAgent(url);
            const response = await agent.send({
                path: '/text',
                method: 'GET',
            });

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('JSON response', async () => {
            using agent = createAgent(url);
            const response = await agent.send({
                path: '/json',
                method: 'GET',
            });

            assertEquals(response.status, 200);
            const json = await response.json();
            assertEquals(json.message, 'Hello, JSON!');
        });

        await t.step('POST request with body', async () => {
            using agent = createAgent(url);
            const response = await agent.send({
                path: '/echo',
                method: 'POST',
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({ test: 'data' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('custom headers', async () => {
            using agent = createAgent(url);
            const response = await agent.send({
                path: '/echo',
                method: 'GET',
                headers: new Headers({ 'x-custom-header': 'test-value' }),
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-custom-header'], 'test-value');
        });
    } finally {
        await server.shutdown();
    }
});
