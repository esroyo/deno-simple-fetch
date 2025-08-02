import type { AgentPool, RequestInit, SendOptions } from './types.ts';
import { createAgentPool } from './agent-pool.ts';

export class HttpClient {
    protected _agentPools: Record<string, AgentPool> = {};

    async send(
        options: SendOptions,
    ): Promise<Response> {
        // Use existing pool or create temporary one
        const agentPool = this._getOrCreateAgentPool(options.url);
        return agentPool.send(options);
    }

    async close(): Promise<void> {
        await Promise.all(
            Object.entries(this._agentPools).map(([key, agentPool]) =>
                agentPool.close()
                    .then(() => delete this._agentPools[key])
            ),
        );
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    protected _getOrCreateAgentPool(
        url: string,
    ): AgentPool {
        const origin = new URL(url).origin;
        return this._agentPools[origin] = this._agentPools[origin] ||
            createAgentPool(origin);
    }
}

function normalizeHeaders(headersInit?: HeadersInit): Headers {
    if (!headersInit) return new Headers();
    if (headersInit instanceof Headers) return headersInit;
    return new Headers(headersInit);
}

function processBody(
    body?: BodyInit,
    headers?: Headers,
): string | Uint8Array | ReadableStream | undefined {
    if (!body) return undefined;

    if (
        typeof body === 'string' ||
        body instanceof Uint8Array ||
        body instanceof ReadableStream
    ) {
        return body;
    }

    if (body instanceof FormData) {
        throw new Error(
            'FormData bodies require multipart encoding implementation',
        );
    }

    if (body instanceof URLSearchParams) {
        headers?.set('content-type', 'application/x-www-form-urlencoded');
        return body.toString();
    }

    return String(body);
}

async function fetchImpl(
    input: RequestInfo | URL,
    init: RequestInit & { client: HttpClient },
): Promise<Response> {
    const url = input instanceof Request ? input.url : input.toString();
    const {
        method = 'GET',
        headers: headersInit,
        body,
        signal,
    } = init;

    const headers = normalizeHeaders(headersInit);
    const processedBody = processBody(body, headers);
    const { client } = init;

    return client.send({
        url,
        method,
        headers,
        body: processedBody,
        signal,
    });
}

// Factory function for creating bound fetch function
export function createFetch() {
    let fallbackHttpClient: HttpClient | undefined;
    const fetch = async (
        input: RequestInfo | URL,
        init: RequestInit & { client?: HttpClient } = {},
    ): Promise<Response> => {
        if (!init.client) {
            Object.defineProperty(init, 'client', {
                enumerable: false,
                configurable: true,
                get() {
                    if (!fallbackHttpClient) {
                        fallbackHttpClient = new HttpClient();
                    }
                    return fallbackHttpClient;
                },
            });
        }
        return fetchImpl(input, init as RequestInit & { client: HttpClient });
    };
    const close: () => Promise<void> = async () => fallbackHttpClient?.close();
    return Object.assign(fetch, { close, [Symbol.asyncDispose]: close });
}
