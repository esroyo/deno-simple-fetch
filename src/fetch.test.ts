import { assertEquals, assertRejects } from './test-utils.ts';
import { createFetch, HttpClient } from './fetch.ts'; // Assuming your fetch-like API is in this file
import { createTestServer } from './test-utils.ts';

Deno.test('HTTP Client - Fetch-like API', async (t) => {
    const { server, url } = await createTestServer(8090);

    try {
        await t.step('basic GET request with fetch method', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/text');

            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('GET request with explicit method', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/json', { method: 'GET' });

            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const json = await response.json();
            assertEquals(json.message, 'Hello, JSON!');
        });

        await t.step('POST request with JSON body', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ test: 'data' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('PUT request', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ updated: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PUT');
        });

        await t.step('DELETE request', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', { method: 'DELETE' });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'DELETE');
        });

        await t.step('PATCH request', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ patched: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PATCH');
        });

        await t.step('HEAD request', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', { method: 'HEAD' });

            assertEquals(response.status, 200);
        });

        await t.step('OPTIONS request', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', { method: 'OPTIONS' });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'OPTIONS');
        });

        await t.step('custom headers with fetch', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', {
                method: 'GET',
                headers: { 'x-custom-header': 'test-value' },
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-custom-header'], 'test-value');
        });

        await t.step('headers as Headers object', async () => {
            using client = new HttpClient(url);
            const headers = new Headers();
            headers.set('authorization', 'Bearer token123');

            const response = await client.fetch('/echo', { method: 'GET', headers });

            const echo = await response.json();
            assertEquals(echo.headers['authorization'], 'Bearer token123');
        });

        await t.step('headers as array', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/echo', {
                method: 'GET',
                headers: [['x-api-key', 'secret'], ['x-version', '1.0']],
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-api-key'], 'secret');
            assertEquals(echo.headers['x-version'], '1.0');
        });

        await t.step('timeout handling', async () => {
            using client = new HttpClient(url);

            await assertRejects(
                () => client.fetch('/slow', { timeout: 100 }),
                Error,
            );
        });

        await t.step('AbortSignal timeout', async () => {
            using client = new HttpClient(url);

            await assertRejects(
                () => client.fetch('/slow', { signal: AbortSignal.timeout(100) }),
                Error,
            );
        });

        await t.step('manual AbortController', async () => {
            using client = new HttpClient(url);
            const controller = new AbortController();

            // Abort after 50ms
            setTimeout(() => controller.abort(), 50);

            await assertRejects(
                () => client.fetch('/slow', { signal: controller.signal }),
                Error,
            );
        });

        await t.step('bodyUsed tracking', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/text');

            assertEquals(response.bodyUsed, false);
            await response.text();
            assertEquals(response.bodyUsed, true);

            // Should throw when trying to read body again
            await assertRejects(
                () => response.json(),
                TypeError,
                'body stream already read',
            );
        });

        await t.step('response.ok property', async () => {
            using client = new HttpClient(url);

            // Success response
            const goodResponse = await client.fetch('/text');
            assertEquals(goodResponse.ok, true);

            // Error response
            const badResponse = await client.fetch('/notfound');
            assertEquals(badResponse.ok, false);
            assertEquals(badResponse.status, 404);
        });

        await t.step('arrayBuffer and blob methods', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/text');

            const arrayBuffer = await response.arrayBuffer();
            assertEquals(arrayBuffer instanceof ArrayBuffer, true);

            // Test with fresh response for blob
            const response2 = await client.fetch('/text');
            const blob = await response2.blob();
            assertEquals(blob instanceof Blob, true);
        });

        await t.step('redirect response with location header access', async () => {
            using client = new HttpClient(url);
            
            // Make request to redirect endpoint
            const response = await client.fetch('/redirect');

            // Should get the redirect status code (not follow the redirect)
            assertEquals(response.status, 302);
            assertEquals(response.ok, false); // 3xx responses are not "ok"

            // Should be able to access the Location header
            const locationHeader = response.headers.get('location');
            assertEquals(locationHeader, '/redirected-target');

            // Should also be able to read any body content from the redirect response
            const text = await response.text();
            assertEquals(text, 'Redirecting to /redirected-target');
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - No Base URL (like global fetch)', async (t) => {
    const { server, url } = await createTestServer(8091);

    try {
        await t.step('fetch with full URL', async () => {
            using client = new HttpClient(); // No base URL
            const response = await client.fetch(`${url}/text`);

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('POST with full URL', async () => {
            using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ message: 'test' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('createFetch factory function', async (t) => {
    const { server, url } = await createTestServer(8084);

    try {
        await t.step('createFetch with base URL', async () => {
            const { fetch, close } = createFetch(url);

            try {
                // Test fetch method
                const response1 = await fetch('/text');
                assertEquals(response1.status, 200);
                const text = await response1.text();
                assertEquals(text, 'Hello, World!');

                // Test GET request
                const response2 = await fetch('/json', { method: 'GET' });
                const json = await response2.json();
                assertEquals(json.message, 'Hello, JSON!');

                // Test POST request
                const response3 = await fetch('/echo', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ test: 'factory' }),
                });
                const echo = await response3.json();
                assertEquals(echo.method, 'POST');
            } finally {
                close();
            }
        });

        await t.step('createFetch without base URL', async () => {
            const { fetch, close } = createFetch();

            try {
                const response = await fetch(`${url}/text`);
                assertEquals(response.status, 200);
                const text = await response.text();
                assertEquals(text, 'Hello, World!');
            } finally {
                close();
            }
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - Stream Access', async (t) => {
    const { server, url } = await createTestServer(8085);

    try {
        await t.step('direct stream access', async () => {
            using client = new HttpClient(url);
            const response = await client.fetch('/text');

            // Access raw stream
            const reader = response.body.getReader();
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

            const text = new TextDecoder().decode(
                new Uint8Array(
                    chunks.reduce(
                        (acc, chunk) => [...acc, ...chunk],
                        [] as number[],
                    ),
                ),
            );
            assertEquals(text, 'Hello, World!');

            // bodyUsed should still be false since we used the stream directly
            assertEquals(response.bodyUsed, false);
        });
    } finally {
        await server.shutdown();
    }
});
