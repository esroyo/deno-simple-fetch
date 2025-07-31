import { Agent, SendOptions, TimeoutOptions } from './types.ts';
import { ConnectionClosedError, UnexpectedEofError } from './errors.ts';
import { readResponse, writeRequest } from './http-io.ts';
import { createAbortablePromise } from './utils.ts';

const PORT_MAP: Record<string, number> = {
    'http:': 80,
    'https:': 443,
};

export function createAgent(
    baseUrl: string,
    options: TimeoutOptions = {},
): Agent {
    let isConnected = false;
    let isConnecting = false;
    let connection: Deno.Conn | undefined;
    let connectPromise = Promise.withResolvers<void>();

    const url = new URL(baseUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(
            `Unsupported protocol: ${url.protocol}. Only http: and https: are supported.`,
        );
    }

    const hostname = url.hostname;
    const port = url.port ? parseInt(url.port) : PORT_MAP[url.protocol];

    if (port === undefined) {
        throw new Error(`Unexpected protocol: ${url.protocol}`);
    }

    const connect = async (): Promise<void> => {
        if (isConnected) return;
        if (isConnecting) return connectPromise.promise;

        isConnecting = true;

        try {
            const connectOptions: Deno.ConnectOptions = {
                port,
                transport: 'tcp',
                hostname,
            };

            let connectPromiseForTimeout: Promise<Deno.Conn>;

            if (url.protocol === 'http:') {
                connectPromiseForTimeout = Deno.connect(connectOptions);
            } else {
                connectPromiseForTimeout = Deno.connectTls(connectOptions);
            }

            // Apply timeout to connection if specified
            connection = await createAbortablePromise(
                connectPromiseForTimeout,
                options,
            );

            isConnected = true;
            isConnecting = false;
            connectPromise.resolve();
        } catch (error) {
            isConnecting = false;
            connectPromise.reject(error);
            throw error;
        }
    };

    let isSending = false;

    async function send(sendOptions: SendOptions) {
        if (isSending) {
            throw new Error('Cannot send HTTP requests concurrently');
        }

        isSending = true;

        try {
            if (!isConnected) {
                await connect();
            }

            const { path, method, headers, body } = sendOptions;
            const requestUrl = new URL(path, url);

            if (!connection) {
                throw new Error('Connection not established');
            }

            // Apply timeout to write request
            await createAbortablePromise(
                writeRequest(connection, {
                    url: requestUrl.toString(),
                    method,
                    headers,
                    body,
                }),
                options,
            );

            // Apply timeout to read response
            const response = await createAbortablePromise(
                readResponse(connection, options),
                options,
            );

            return {
                ...response,
                conn: connection,
            };
        } catch (error) {
            if (error instanceof UnexpectedEofError) {
                // Connection was closed, reset state
                isConnected = false;
                connection?.close();
                connection = undefined;
                connectPromise = Promise.withResolvers<void>();
                throw new ConnectionClosedError();
            }
            throw error;
        } finally {
            isSending = false;
        }
    }

    function close() {
        connection?.close();
        connection = undefined;
        isConnected = false;
        connectPromise = Promise.withResolvers<void>();
    }

    return {
        [Symbol.dispose]: close,
        close,
        hostname,
        port,
        send,
        get conn(): Deno.Conn | undefined {
            return connection;
        },
    };
}
