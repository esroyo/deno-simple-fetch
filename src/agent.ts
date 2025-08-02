import { Agent, SendOptions } from './types.ts';
import { ConnectionClosedError } from './errors.ts';
import { readResponse, writeRequest } from './http-io.ts';
import { createAbortablePromise } from './utils.ts';

const PORT_MAP: Record<string, number> = {
    'http:': 80,
    'https:': 443,
};

export function createAgent(
    baseUrl: string,
): Agent {
    const registry = new FinalizationRegistry<() => void>((cleanup) =>
        cleanup()
    );
    let connection: Deno.Conn | undefined;
    let isBusy = false;
    let lastController: AbortController | undefined;
    let whenIdle: Pick<PromiseWithResolvers<void>, 'promise' | 'resolve'> = {
        promise: Promise.resolve(),
        resolve: () => {},
    };
    let lastUsedTime = Date.now();

    const url = new URL(baseUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(
            `Unsupported protocol: ${url.protocol}. Only http: and https: are supported.`,
        );
    }

    const hostname = url.hostname;
    const port = url.port ? parseInt(url.port) : PORT_MAP[url.protocol];
    const isSecure = url.protocol === 'https:';

    if (port === undefined) {
        throw new Error(`Unexpected protocol: ${url.protocol}`);
    }

    const connect = async () => {
        if (connection) return;

        const connectOptions: Deno.ConnectOptions = {
            port,
            transport: 'tcp',
            hostname,
        };

        connection =
            await (isSecure
                ? Deno.connectTls(connectOptions)
                : Deno.connect(connectOptions));
    };

    async function send(
        sendOptions: SendOptions,
    ): Promise<Response> {
        if (isBusy) {
            throw new Error(
                'Agent is busy - use agent pool for concurrent requests',
            );
        }

        sendOptions.signal?.throwIfAborted();

        isBusy = true;
        whenIdle = Promise.withResolvers<void>();
        lastUsedTime = Date.now();
        lastController = new AbortController();

        try {
            const {
                url: requestUrl,
                method,
                headers,
                body,
                signal: requestSignal,
            } = sendOptions;
            const fullUrl = new URL(requestUrl, baseUrl);

            if (fullUrl.origin !== baseUrl) {
                throw new Error(
                    `Request to send "${requestUrl}" on a ${baseUrl} connection`,
                );
            }

            const signal = requestSignal
                ? AbortSignal.any([requestSignal, lastController.signal])
                : lastController.signal;

            if (!connection) {
                await createAbortablePromise(
                    connect(),
                    { signal },
                );
            }

            if (!connection) {
                throw new Error('Connection not established');
            }

            await createAbortablePromise(
                writeRequest(connection, {
                    url: fullUrl.toString(),
                    method,
                    headers,
                    body,
                }),
                { signal },
            );

            let shouldCloseAfterBody = false;
            let finalized = false;

            const onDone = (forceClose = shouldCloseAfterBody) => {
                if (finalized) return;
                finalized = true;

                if (forceClose) {
                    connection?.close();
                    connection = undefined;
                }
                lastUsedTime = Date.now();
                isBusy = false;
                lastController = undefined;
                whenIdle.resolve();
            };

            const isHeadRequest = method.toUpperCase() === 'HEAD';
            const shouldIgnoreBody = (status: number) =>
                isHeadRequest || (status >= 100 && status < 200) ||
                status === 204 || status === 304;

            const response = await createAbortablePromise(
                readResponse(connection, shouldIgnoreBody, onDone),
                { signal },
            );
            Object.defineProperty(response, 'url', {
                value: fullUrl.toString(),
                writable: false,
                configurable: true,
            });

            const responseRef = new WeakRef(response);
            signal.addEventListener('abort', (ev) => {
                responseRef.deref()?.body?.cancel(
                    (ev.target as AbortSignal)?.reason,
                );
            });

            // Important: For HTTP/1.1, connection can be reused if we can determine
            // when the response body ends (Content-Length or chunked encoding)
            const hasContentLength = response.headers.has('content-length');
            const isChunked = response.headers.get('transfer-encoding')
                ?.includes('chunked');

            // Without content-length or chunked encoding, we can't know when body ends
            // So we must close the connection after this response
            shouldCloseAfterBody = !hasContentLength && !isChunked;

            // Register the response for cleanup if it becomes unreachable
            // This is our safety net - if onDone never gets called due to an abandoned response,
            // the finalizer will force connection closure when the response is GC'd
            registry.register(response, () => {
                if (!finalized) {
                    onDone(true); // Force close the connection
                }
            });

            return response;
        } catch (error) {
            lastUsedTime = Date.now();
            isBusy = false;
            lastController = undefined;
            whenIdle.resolve();

            connection?.close();
            connection = undefined;

            if (
                Error.isError(error) &&
                error.name === 'UnexpectedEofError'
            ) {
                throw new ConnectionClosedError();
            }

            throw error;
        }
    }

    function close() {
        if (lastController) {
            lastController.abort();
            lastController = undefined;
        }
        connection?.close();
        connection = undefined;
        isBusy = false;
        whenIdle.resolve();
    }

    return {
        [Symbol.dispose]: close,
        close,
        hostname,
        port,
        send,
        whenIdle(): Promise<void> {
            return whenIdle.promise;
        },
        get isIdle(): boolean {
            return !isBusy;
        },
        get lastUsed(): number {
            return lastUsedTime;
        },
    };
}
