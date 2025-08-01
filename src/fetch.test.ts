import { assertEquals, assertRejects } from './test-utils.ts';
import { createFetch, HttpClient } from './fetch.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('HTTP Client - Fetch-like API', async (t) => {
    const { server, url } = await createTestServer(8090);

    try {
        await t.step('basic GET request with fetch method', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/text`);

            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('GET request with explicit method', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/json`, {
                method: 'GET',
            });

            assertEquals(response.status, 200);
            assertEquals(response.ok, true);
            const json = await response.json();
            assertEquals(json.message, 'Hello, JSON!');
        });

        await t.step('POST request with JSON body', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ test: 'data' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('PUT request', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ updated: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PUT');
        });

        await t.step('DELETE request', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'DELETE',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'DELETE');
        });

        await t.step('PATCH request', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ patched: true }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'PATCH');
        });

        await t.step('HEAD request', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'HEAD',
            });
            assertEquals(response.status, 200);
        });

        await t.step('OPTIONS request', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'OPTIONS',
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'OPTIONS');
        });

        await t.step('custom headers with fetch', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'GET',
                headers: { 'x-custom-header': 'test-value' },
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-custom-header'], 'test-value');
        });

        await t.step('headers as Headers object', async () => {
            await using client = new HttpClient();
            const headers = new Headers();
            headers.set('authorization', 'Bearer token123');

            const response = await client.fetch(`${url}/echo`, {
                method: 'GET',
                headers,
            });

            const echo = await response.json();
            assertEquals(echo.headers['authorization'], 'Bearer token123');
        });

        await t.step('headers as array', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'GET',
                headers: [['x-api-key', 'secret'], ['x-version', '1.0']],
            });

            const echo = await response.json();
            assertEquals(echo.headers['x-api-key'], 'secret');
            assertEquals(echo.headers['x-version'], '1.0');
        });

        await t.step('AbortSignal timeout', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () =>
                    client.fetch(`${url}/slow`, {
                        signal: AbortSignal.timeout(100),
                    }).then((res) => res.text()),
                'TimeoutError',
            );
        });

        await t.step('manual AbortController', async () => {
            await using client = new HttpClient();
            const controller = new AbortController();

            // Abort after 50ms
            setTimeout(() => controller.abort(), 50);

            await assertRejects(
                () =>
                    client.fetch(`${url}/slow`, { signal: controller.signal })
                        .then((res) => res.text()),
                'TimeoutError',
            );
        });

        await t.step('bodyUsed tracking', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/text`);

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
            await using client = new HttpClient();

            // Success response
            const goodResponse = await client.fetch(`${url}/text`);
            assertEquals(goodResponse.ok, true);

            // Error response
            const badResponse = await client.fetch(`${url}/notfound`);
            assertEquals(badResponse.ok, false);
            assertEquals(badResponse.status, 404);
        });

        await t.step('arrayBuffer and blob methods', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/text`);

            const arrayBuffer = await response.arrayBuffer();
            assertEquals(arrayBuffer instanceof ArrayBuffer, true);

            // Test with fresh response for blob
            const response2 = await client.fetch(`${url}/text`);
            const blob = await response2.blob();
            assertEquals(blob instanceof Blob, true);
        });

        await t.step(
            'redirect response with location header access',
            async () => {
                await using client = new HttpClient();

                // Make request to redirect endpoint
                const response = await client.fetch(`${url}/redirect`);

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
            await using client = new HttpClient();

            // Test with URL object
            const urlObj = new URL(`${url}/echo`);
            urlObj.searchParams.set('param1', 'value1');
            urlObj.searchParams.set('param2', 'value with spaces');

            const response = await client.fetch(urlObj);
            assertEquals(response.status, 200);

            const echo = await response.json();
            assertEquals(echo.url.includes('param1=value1'), true);
            assertEquals(echo.url.includes('param2=value+with+spaces'), true);
        });

        await t.step('URLSearchParams body', async () => {
            await using client = new HttpClient();
            const params = new URLSearchParams();
            params.set('username', 'john');
            params.set('password', 'secret123');

            const response = await client.fetch(`${url}/echo`, {
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
            await using client = new HttpClient();
            const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

            const response = await client.fetch(`${url}/echo`, {
                method: 'POST',
                body: data,
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.headers['content-length'], '5');
        });

        await t.step('ReadableStream body', async () => {
            await using client = new HttpClient();
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('chunk1'));
                    controller.enqueue(encoder.encode('chunk2'));
                    controller.close();
                },
            });

            const response = await client.fetch(`${url}/echo`, {
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

Deno.test('HTTP Client - No Base URL (like global fetch)', async (t) => {
    const { server, url } = await createTestServer(8091);

    try {
        await t.step('fetch with full URL', async () => {
            await using client = new HttpClient(); // No base URL
            const response = await client.fetch(`${url}/text`);

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');
        });

        await t.step('POST with full URL', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ message: 'test' }),
            });

            assertEquals(response.status, 200);
            const echo = await response.json();
            assertEquals(echo.method, 'POST');
        });

        await t.step('multiple different origins', async () => {
            await using client = new HttpClient();

            // Make requests to the same server (different agent pools would be created for different origins)
            const response1 = await client.fetch(`${url}/text`);
            const response2 = await client.fetch(`${url}/json`);

            assertEquals(response1.status, 200);
            assertEquals(response2.status, 200);

            const text = await response1.text();
            const json = await response2.json();

            assertEquals(text, 'Hello, World!');
            assertEquals(json.message, 'Hello, JSON!');
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('createFetch factory function', async (t) => {
    const { server, url } = await createTestServer(8084);

    try {
        await t.step('createFetch with base URL', async () => {
            const { fetch, close } = createFetch();

            try {
                // Test fetch method
                const response1 = await fetch(`${url}/text`);
                assertEquals(response1.status, 200);
                const text = await response1.text();
                assertEquals(text, 'Hello, World!');

                // Test GET request
                const response2 = await fetch(`${url}/json`, { method: 'GET' });
                const json = await response2.json();
                assertEquals(json.message, 'Hello, JSON!');

                // Test POST request
                const response3 = await fetch(`${url}/echo`, {
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

        await t.step('createFetch with Symbol.asyncDispose', async () => {
            await using fetchClient = createFetch();

            const response = await fetchClient.fetch(`${url}/text`);
            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'Hello, World!');

            // Client will be automatically disposed
        });
    } finally {
        await server.shutdown();
    }
});

Deno.test('HTTP Client - Stream Access', async (t) => {
    const { server, url } = await createTestServer(8085);

    try {
        await t.step('direct stream access', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/text`);

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

        await t.step('chunked response handling', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/chunked`);

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'chunk1chunk2chunk3');
        });

        await t.step('gzip decompression', async () => {
            await using client = new HttpClient();
            const response = await client.fetch(`${url}/gzip`);

            assertEquals(response.status, 200);
            const text = await response.text();
            assertEquals(text, 'This is compressed content!');
        });

        await t.step('stream cancellation', async () => {
            await using client = new HttpClient();
            const controller = new AbortController();

            const responsePromise = client.fetch(`${url}/slow`, {
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
    const { server, url } = await createTestServer(8086);

    try {
        await t.step('connection errors', async () => {
            await using client = new HttpClient();

            // Try to connect to non-existent server
            await assertRejects(
                () => client.fetch('http://localhost:99999/test'),
                Error,
            );
        });

        await t.step('invalid URLs', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () => client.fetch('not-a-url'),
                Error,
            );
        });

        await t.step('unsupported protocols', async () => {
            await using client = new HttpClient();

            await assertRejects(
                () => client.fetch('ftp://example.com/file'),
                Error,
                'Unsupported protocol',
            );
        });

        await t.step('FormData body rejection', async () => {
            await using client = new HttpClient();
            const formData = new FormData();
            formData.append('test', 'value');

            await assertRejects(
                () =>
                    client.fetch(`${url}/echo`, {
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

Deno.test('HTTP Client - Connection Management', async (t) => {
    const { server, url } = await createTestServer(8087);

    try {
        await t.step('agent pool reuse', async () => {
            await using client = new HttpClient();

            // Make multiple requests to same origin
            const response1 = await client.fetch(`${url}/text`);
            const response2 = await client.fetch(`${url}/json`);
            const response3 = await client.fetch(`${url}/echo`);

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
            const response = await client.fetch(`${url}/text`);
            await response.text();

            // Close client
            await client.close();

            // Subsequent requests should create new agent pools
            const response2 = await client.fetch(`${url}/text`);
            assertEquals(response2.status, 200);
            await response2.text();

            await client.close();
        });
    } finally {
        await server.shutdown();
    }
});
