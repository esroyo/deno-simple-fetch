import { assertEquals, assertRejects } from '@std/assert';

export { assertEquals, assertRejects };

const initialPort = 8080;
let port = initialPort;

// Mock test server
export async function createTestServer(): Promise<
    { server: Deno.HttpServer; url: string; onReady: () => Promise<void> }
> {
    port += 1;
    const serverReady = Promise.withResolvers<void>();

    if (port - initialPort > 100) {
        throw new Error('Address port retries exhausted');
    }

    try {
        const server = Deno.serve({
            port,
            hostname: '127.0.0.1',
            onListen: () => {
                serverReady.resolve();
            },
        }, (req) => {
            const url = new URL(req.url);

            // Echo endpoint - returns request info as JSON
            if (url.pathname === '/echo') {
                return Response.json({
                    method: req.method,
                    url: req.url,
                    headers: Object.fromEntries(req.headers.entries()),
                });
            }

            // Text endpoint
            if (url.pathname === '/text') {
                return new Response('Hello, World!');
            }

            // JSON endpoint
            if (url.pathname === '/json') {
                return Response.json({ message: 'Hello, JSON!' });
            }

            // Redirect endpoint - returns 302 with Location header
            if (url.pathname === '/redirect') {
                return new Response('Redirecting to /redirected-target', {
                    status: 302,
                    headers: {
                        'location': '/redirected-target',
                        'content-type': 'text/plain',
                    },
                });
            }

            // Redirect target endpoint
            if (url.pathname === '/redirected-target') {
                return new Response('You have been redirected!', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                    },
                });
            }

            // Chunked endpoint
            if (url.pathname === '/chunked') {
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('chunk1'));
                        controller.enqueue(encoder.encode('chunk2'));
                        controller.enqueue(encoder.encode('chunk3'));
                        controller.close();
                    },
                });

                return new Response(stream, {
                    headers: { 'transfer-encoding': 'chunked' },
                });
            }

            // Gzip endpoint
            if (url.pathname === '/gzip') {
                const text = 'This is compressed content!';
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(text));
                        controller.close();
                    },
                }).pipeThrough(new CompressionStream('gzip'));

                return new Response(stream, {
                    headers: { 'content-encoding': 'gzip' },
                });
            }

            // Timeout endpoint (slow response)
            if (url.pathname === '/slow') {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(new Response('Finally!'));
                    }, 2000);
                });
            }

            return new Response('Not Found', { status: 404 });
        });
        return {
            server,
            url: `http://127.0.0.1:${port}`,
            onReady: () => serverReady.promise,
        };
    } catch (e) {
        if (Error.isError(e) && e.name === 'AddrInUse') {
            return createTestServer();
        }
        throw e;
    }
}
