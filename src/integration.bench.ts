import { assertEquals, assertRejects } from './test-utils.ts';
import { createFetch, HttpClient } from './fetch.ts';
import { createTestServer } from './test-utils.ts';
import { nodeRequest } from '../vendor/node-request.ts';
import { createAgent } from './agent.ts';
import { createAgentPool } from './agent-pool.ts';

const { server, url, onReady } = await createTestServer();

Deno.bench('Built-in Deno fetch (as-is)', async (b) => {
    await onReady();

    b.start();

    // These should all use the same agent pool
    const responses = await Promise.all([
        fetch(`${url}/text`),
        fetch(`${url}/json`),
        fetch(`${url}/echo`, {
            method: 'POST',
            body: 'test',
        }),
    ]);

    const [_text, _json, _echo] = await Promise.all([
        responses[0].text(),
        responses[1].json(),
        responses[2].json(),
    ]);

    b.end();
});

const client = Deno.createHttpClient({ http2: false });

Deno.bench(
    'Built-in Deno fetch (HTTP1 Client)',
    { baseline: true },
    async (b) => {
        await onReady();

        b.start();

        // These should all use the same agent pool
        const responses = await Promise.all([
            fetch(`${url}/text`, { client }),
            fetch(`${url}/json`, { client }),
            fetch(`${url}/echo`, {
                method: 'POST',
                body: 'test',
                client,
            }),
        ]);

        const [_text, _json, _echo] = await Promise.all([
            responses[0].text(),
            responses[1].json(),
            responses[2].json(),
        ]);

        b.end();
    },
);

await using customClient = new HttpClient();
await using customFetch = createFetch(customClient);

Deno.bench('This library with fetch API', async (b) => {
    await onReady();

    const urls = [
        new URL('/text', url),
        new URL('/json', url),
        new URL('/echo', url),
    ];

    b.start();

    // These should all use the same agent pool
    const responses = await Promise.all([
        customFetch(urls[0]),
        customFetch(urls[1]),
        customFetch(urls[2], {
            method: 'POST',
            body: 'test',
        }),
    ]);

    const [_text, _json, _echo] = await Promise.all([
        responses[0].text(),
        responses[1].json(),
        responses[2].json(),
    ]);

    b.end();
});

Deno.bench('This library with an internal single-usage Agent', async (b) => {
    await onReady();

    const urls = [
        new URL('/text', url),
        new URL('/json', url),
        new URL('/echo', url),
    ];

    b.start();

    // These should all use the same agent pool
    const responses = await Promise.all([
        createAgent(urls[0]).send({ url: urls[0], method: 'GET' }),
        createAgent(urls[1]).send({ url: urls[1], method: 'GET' }),
        createAgent(urls[2]).send({
            url: urls[2],
            method: 'POST',
            body: 'test',
        }),
    ]);

    const [_text, _json, _echo] = await Promise.all([
        responses[0].text(),
        responses[1].json(),
        responses[2].json(),
    ]);

    b.end();
});

const agentPool = createAgentPool(new URL(url));

Deno.bench('This library with the internal Agent pool (not fetch API)', async (b) => {
    await onReady();

    const urls = [
        new URL('/text', url),
        new URL('/json', url),
        new URL('/echo', url),
    ];

    b.start();

    // These should all use the same agent pool
    const responses = await Promise.all([
        agentPool.send({ url: urls[0], method: 'GET' }),
        agentPool.send({ url: urls[1], method: 'GET' }),
        agentPool.send({ url: urls[2], method: 'POST', body: 'test' }),
    ]);

    const [_text, _json, _echo] = await Promise.all([
        responses[0].text(),
        responses[1].json(),
        responses[2].json(),
    ]);

    b.end();

    assertEquals(_text, 'Hello, World!');
    assertEquals(_json, { message: 'Hello, JSON!' });
});

Deno.bench('Node "request" package', async (b) => {
    await onReady();

    b.start();

    // These should all use the same agent pool
    const responses = await Promise.all([
        nodeRequest(`${url}/text`),
        nodeRequest(`${url}/json`),
        nodeRequest(`${url}/echo`, {
            method: 'POST',
            body: 'test',
        }),
    ]);

    const [_text, _json, _echo] = await Promise.all([
        responses[0].text(),
        responses[1].json(),
        responses[2].json(),
    ]);

    b.end();
});

//await server.shutdown();
