import { assertEquals, assertRejects } from './test-utils.ts';
import { createFetch, HttpClient } from './fetch.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('HTTP Client - raw API', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('basic GET request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('POST request with JSON body', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'POST',
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({ test: 'data' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('PUT request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'PUT',
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({ updated: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PUT');
        });

        await t.step('DELETE request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'DELETE',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'DELETE');
        });

        await t.step('PATCH request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'PATCH',
                headers: new Headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({ patched: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PATCH');
        });

        await t.step('HEAD request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'HEAD',
            });
            assertEquals(response.status, 200);
        });

        await t.step('OPTIONS request', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'OPTIONS',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'OPTIONS');
        });

        await t.step('custom headers', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/echo', url),
                method: 'GET',
                headers: new Headers({ 'x-custom-header': 'test-value' }),
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-custom-header'], 'test-value');
        });

        await t.step('AbortSignal timeout', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () =>
                    client.send({
                        url: new URL('/slow', url),
                        method: 'GET',
                        signal: AbortSignal.timeout(100),
                    }).then((res) => res.text()),
                Error,
                'timed out',
            );
        });

        await t.step('manual AbortController', async () => {
            await using client = new HttpClient();
            const controller = new AbortController();

            // Abort after 50ms
            setTimeout(() => controller.abort(), 50);

            await assertRejects(
                () =>
                    client.send({
                        url: new URL('/slow', url),
                        method: 'GET',
                        signal: controller.signal,
                    })
                        .then((res) => res.text()),
                Error,
                'aborted',
            );
        });

        await t.step('bodyUsed tracking', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });

            assertEquals(response.bodyUsed, false);
            await response.text();
            assertEquals(response.bodyUsed, true);

            // Should throw when trying to read body again
            await assertRejects(
                () => response.json(),
                TypeError,
                'Body already consumed',
            );
        });

        await t.step('response.ok property', async () => {
            await using client = new HttpClient();

            // Success response
            const goodResponse = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            assertEquals(goodResponse.ok, true);

            // Error response
            const badResponse = await client.send({
                url: new URL('/notfound', url),
                method: 'GET',
            });
            assertEquals(badResponse.ok, false);
            assertEquals(badResponse.status, 404);
        });

        await t.step('arrayBuffer and blob methods', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });

            const arrayBuffer = await response.arrayBuffer();
            assertEquals(arrayBuffer instanceof ArrayBuffer, true);

            // Test with fresh response for blob
            const response2 = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            const blob = await response2.blob();
            assertEquals(blob instanceof Blob, true);
        });

        await t.step(
            'redirect response with location header access',
            async () => {
                await using client = new HttpClient();

                // Make request to redirect endpoint
                const response = await client.send({
                    url: new URL('/redirect', url),
                    method: 'GET',
                });

                // Should get the redirect status code (not follow the redirect)
                assertEquals(response.status, 302);
                assertEquals(response.ok, false); // 3xx responses are not "ok"

                // Should be able to access the Location header
                const locationHeader = response.headers.get('location');
                assertEquals(locationHeader, '/redirected-target');

                // Should also be able to read any body content from the redirect response
                const text = await response.text();
                assertEquals(text, 'Redirecting to /redirected-target');
            },
        );
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - Stream Access', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('direct stream access', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });

            // Access raw stream
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];

            if (!reader) {
                throw new Error('Unexpected missing body');
            }

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
            assertEquals(response.bodyUsed, true);
        });

        await t.step('chunked response handling', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/chunked', url),
                method: 'GET',
            });

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'chunk1chunk2chunk3');
        });

        await t.step('gzip decompression', async () => {
            await using client = new HttpClient();
            const response = await client.send({
                url: new URL('/gzip', url),
                method: 'GET',
            });

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'This is compressed content!');
        });

        await t.step('stream cancellation', async () => {
            await using client = new HttpClient();
            const controller = new AbortController();

            const responsePromise = client.send({
                url: new URL('/slow', url),
                method: 'GET',
                signal: controller.signal,
            });

            // Cancel after a short delay
            setTimeout(() => controller.abort(), 50);

            await assertRejects(() => responsePromise, Error);
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - Error Handling', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('connection errors', async () => {
            await using client = new HttpClient();

            // Try to connect to non-existent server
            await assertRejects(
                () =>
                    client.send({
                        url: new URL('http://localhost:65535/test'),
                        method: 'GET',
                    }),
                Error,
            );
        });

        await t.step('invalid URLs', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () =>
                    client.send({
                        url: 'not-a-url' as unknown as URL,
                        method: 'GET',
                    }),
                Error,
            );
        });

        await t.step('unsupported protocols', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () =>
                    client.send({
                        url: new URL('ftp://example.com/file'),
                        method: 'GET',
                    }),
                Error,
                'Unsupported protocol',
            );
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - Connection Management', async (t) => {
    const { server, url } = await createTestServer();

    try {
        await t.step('agent pool reuse', async () => {
            await using client = new HttpClient();

            // Make multiple requests to same origin
            const response1 = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            const response2 = await client.send({
                url: new URL('/json', url),
                method: 'GET',
            });
            const response3 = await client.send({
                url: new URL('/echo', url),
                method: 'GET',
            });

            assertEquals(response1.status, 200);
            assertEquals(response2.status, 200);
            assertEquals(response3.status, 200);

            await response1.text();
            await response2.json();
            await response3.json();
        });

        await t.step('proper cleanup on close', async () => {
            const client = new HttpClient();

            // Make a request
            const response = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            await response.text();

            // Close client
            await client.close();

            // Subsequent requests should create new agent pools
            const response2 = await client.send({
                url: new URL('/text', url),
                method: 'GET',
            });
            assertEquals(response2.status, 200);
            await response2.text();

            await client.close();
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('Fetch API', async (t) => {
    const { server, url } = await createTestServer();

    await using fetch = createFetch();

    try {
        await t.step('basic GET request', async () => {
            const response = await fetch(`${url}/text`);
            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('basic GET request with explicit method', async () => {
            const response = await fetch(`${url}/text`, { method: 'GET' });
            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('POST request with JSON body', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ test: 'data' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('PUT request', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ updated: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PUT');
        });

        await t.step('DELETE request', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'DELETE',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'DELETE');
        });

        await t.step('PATCH request', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ patched: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PATCH');
        });

        await t.step('HEAD request', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'HEAD',
            });
            assertEquals(response.status, 200);
        });

        await t.step('OPTIONS request', async () => {
            const response = await fetch(`${url}/echo`, {
                method: 'OPTIONS',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'OPTIONS');
        });

        await t.step('custom headers', async () => {
            const response = await fetch(`${url}/echo`, {
                headers: { 'x-custom-header': 'test-value' },
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-custom-header'], 'test-value');
        });

        await t.step('AbortSignal timeout', async () => {
            await assertRejects(
                () =>
                    fetch(`${url}/slow`, {
                        signal: AbortSignal.timeout(100),
                    }).then((res) => res.text()),
                Error,
                'timed out',
            );
        });

        await t.step('manual AbortController', async () => {
            const controller = new AbortController();

            // Abort after 50ms
            setTimeout(() => controller.abort(), 50);

            await assertRejects(
                () =>
                    fetch(`${url}/slow`, {
                        signal: controller.signal,
                    })
                        .then((res) => res.text()),
                Error,
                'aborted',
            );
        });

        await t.step('bodyUsed tracking', async () => {
            const response = await fetch(`${url}/text`);

            assertEquals(response.bodyUsed, false);
            await response.text();
            assertEquals(response.bodyUsed, true);

            // Should throw when trying to read body again
            await assertRejects(
                () => response.json(),
                TypeError,
                'Body already consumed',
            );
        });

        await t.step('response.ok property', async () => {
            // Success response
            const goodResponse = await fetch(`${url}/text`);
            assertEquals(goodResponse.ok, true);

            // Error response
            const badResponse = await fetch(`${url}/notfound`);
            assertEquals(badResponse.ok, false);
            assertEquals(badResponse.status, 404);
        });

        await t.step('arrayBuffer and blob methods', async () => {
            const response = await fetch(`${url}/text`);

            const arrayBuffer = await response.arrayBuffer();
            assertEquals(arrayBuffer instanceof ArrayBuffer, true);

            // Test with fresh response for blob
            const response2 = await fetch(`${url}/text`);
            const blob = await response2.blob();
            assertEquals(blob instanceof Blob, true);
        });

        await t.step(
            'redirect response with location header access',
            async () => {
                // Make request to redirect endpoint
                const response = await fetch(`${url}/redirect`);

                // Should get the redirect status code (not follow the redirect)
                assertEquals(response.status, 302);
                assertEquals(response.ok, false); // 3xx responses are not "ok"

                // Should be able to access the Location header
                const locationHeader = response.headers.get('location');
                assertEquals(locationHeader, '/redirected-target');

                // Should also be able to read any body content from the redirect response
                const text = await response.text();
                assertEquals(text, 'Redirecting to /redirected-target');
            },
        );

        await t.step('URL parameter handling', async () => {
            // Test with URL object
            const urlObj = new URL(`${url}/echo`);
            urlObj.searchParams.set('param1', 'value1');
            urlObj.searchParams.set('param2', 'value with spaces');

            const response = await fetch(urlObj);
            assertEquals(response.status, 200);

            const echo = await response.json();
            assertEquals(echo.url.includes('param1=value1'), true);
            assertEquals(echo.url.includes('param2=value+with+spaces'), true);
        });

        await t.step('URLSearchParams body', async () => {
            const params = new URLSearchParams();
            params.set('username', 'john');
            params.set('password', 'secret123');

            const response = await fetch(`${url}/echo`, {
                method: 'POST',
                body: params,
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(
                echo.headers['content-type'],
                'application/x-www-form-urlencoded',
            );
        });

        await t.step('Uint8Array body', async () => {
            const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

            const response = await fetch(`${url}/echo`, {
                method: 'POST',
                body: data,
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.headers['content-length'], '5');
        });

        await t.step('ReadableStream body', async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('chunk1'));
                    controller.enqueue(encoder.encode('chunk2'));
                    controller.close();
                },
            });

            const response = await fetch(`${url}/echo`, {
                method: 'POST',
                body: stream,
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.headers['transfer-encoding'], 'chunked');
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('Fetch API - Error Handling', async (t) => {
    const { server, url } = await createTestServer();

    await using fetch = createFetch();

    try {
        await t.step('connection errors', async () => {
            // Try to connect to non-existent server
            await assertRejects(
                () => fetch('http://localhost:99999/test'),
                Error,
            );
        });

        await t.step('invalid URLs', async () => {
            await assertRejects(
                () => fetch('not-a-url'),
                Error,
            );
        });

        await t.step('unsupported protocols', async () => {
            await assertRejects(
                () => fetch('ftp://example.com/file'),
                Error,
                'Unsupported protocol',
            );
        });

        await t.step('FormData body rejection', async () => {
            const formData = new FormData();
            formData.append('test', 'value');

            await assertRejects(
                () =>
                    fetch(`${url}/echo`, {
                        method: 'POST',
                        body: formData,
                    }),
                Error,
                'FormData bodies require multipart encoding implementation',
            );
        });
    } finally {
        await server.shutdown();
    }
});
