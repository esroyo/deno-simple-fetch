import { assertEquals, assertRejects } from './test-utils.ts';
import { LineReader, readResponse, writeRequest } from './http-io.ts';
import { createTestServer } from './test-utils.ts';

Deno.test('HTTP I/O - Line Reader', async (t) => {
    await t.step('read single line', async () => {
        const data = 'Hello, World!\r\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(data));
                controller.close();
            },
        });

        const lineReader = new LineReader(stream.getReader());
        const line = await lineReader.readLine();
        assertEquals(line, 'Hello, World!');
    });

    await t.step('read multiple lines', async () => {
        const data = 'Line 1\r\nLine 2\r\nLine 3\r\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(data));
                controller.close();
            },
        });

        const lineReader = new LineReader(stream.getReader());
        assertEquals(await lineReader.readLine(), 'Line 1');
        assertEquals(await lineReader.readLine(), 'Line 2');
        assertEquals(await lineReader.readLine(), 'Line 3');
        assertEquals(await lineReader.readLine(), null);
    });

    await t.step('read headers', async () => {
        const data =
            'Content-Type: application/json\r\nContent-Length: 100\r\n\r\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(data));
                controller.close();
            },
        });

        const lineReader = new LineReader(stream.getReader());
        const headers = await lineReader.readHeaders();

        assertEquals(headers.get('content-type'), 'application/json');
        assertEquals(headers.get('content-length'), '100');
    });

    await t.step('handle partial reads', async () => {
        const data = 'Partial line\r\n';
        const stream = new ReadableStream({
            start(controller) {
                // Send data in small chunks
                for (let i = 0; i < data.length; i += 3) {
                    const chunk = data.slice(i, i + 3);
                    controller.enqueue(new TextEncoder().encode(chunk));
                }
                controller.close();
            },
        });

        const lineReader = new LineReader(stream.getReader());
        const line = await lineReader.readLine();
        assertEquals(line, 'Partial line');
    });
});

Deno.test('HTTP I/O - Request Writing', async (t) => {
    await t.step('write basic GET request', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            await writeRequest(conn, {
                url: `${url}/echo`,
                method: 'GET',
                headers: new Headers({ 'User-Agent': 'Test' }),
            });

            // Read the response to verify request was written correctly
            const response = await readResponse(conn, () => false);
            assertEquals(response.status, 200);
            const data = await response.json();
            assertEquals(data.method, 'GET');
            assertEquals(data.headers['user-agent'], 'Test');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });

    await t.step('write POST request with body', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            const requestBody = JSON.stringify({ test: 'data' });
            await writeRequest(conn, {
                url: `${url}/echo`,
                method: 'POST',
                headers: new Headers({ 'Content-Type': 'application/json' }),
                body: requestBody,
            });

            const response = await readResponse(conn, () => false);
            assertEquals(response.status, 200);
            const data = await response.json();
            assertEquals(data.method, 'POST');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });
});

Deno.test('HTTP I/O - Response Reading', async (t) => {
    await t.step('read response with content-length', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            await writeRequest(conn, {
                url: `${url}/text`,
                method: 'GET',
            });

            const response = await readResponse(conn, () => false);
            assertEquals(response.status, 200);
            assertEquals(response.ok, true);

            const text = await response.text();
            assertEquals(text, 'Hello, World!');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });

    await t.step('read chunked response', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            await writeRequest(conn, {
                url: `${url}/chunked`,
                method: 'GET',
            });

            const response = await readResponse(conn, () => false);
            assertEquals(response.status, 200);

            const text = await response.text();
            assertEquals(text, 'chunk1chunk2chunk3');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });

    await t.step('read gzip response', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            await writeRequest(conn, {
                url: `${url}/gzip`,
                method: 'GET',
                headers: new Headers({ 'Accept-Encoding': 'gzip' }),
            });

            const response = await readResponse(conn, () => false);
            assertEquals(response.status, 200);

            const text = await response.text();
            assertEquals(text, 'This is compressed content!');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });

    await t.step('handle HEAD request (ignore body)', async () => {
        const { server, url } = await createTestServer();
        const serverUrl = new URL(url);

        try {
            const conn = await Deno.connect({
                hostname: serverUrl.hostname,
                port: Number(serverUrl.port),
            });

            await writeRequest(conn, {
                url: `${url}/text`,
                method: 'HEAD',
            });

            const response = await readResponse(conn, (status) => true); // Ignore body for HEAD
            assertEquals(response.status, 200);

            // Body should be empty for HEAD request
            const text = await response.text();
            assertEquals(text, '');

            conn.close();
        } finally {
            await server.shutdown();
        }
    });
});
