import type {
    AgentPool,
    AgentPoolOptions,
    RequestInit,
    SendOptions,
} from './types.ts';
import { createAgentPool } from './agent-pool.ts';

export class HttpClient {
    protected _agentPools: Record<string, AgentPool> = {};

    constructor(protected _agentPoolOptions: AgentPoolOptions = {}) {}

    async send(
        options: SendOptions,
    ): Promise<Response> {
        return this._getOrCreateAgentPool(options.url).send(options);
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
        url: URL,
    ): AgentPool {
        const { origin } = url;
        return this._agentPools[origin] = this._agentPools[origin] ||
            createAgentPool(url, this._agentPoolOptions);
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
    const url = input instanceof URL
        ? input
        : new URL(input instanceof Request ? input.url : input);
    const headers = normalizeHeaders(init.headers);
    const body = processBody(init.body, headers);
    return init.client.send({
        url,
        method: init.method || 'GET',
        headers,
        body,
        signal: init.signal,
    });
}

// Factory function for creating bound fetch function
export function createFetch(client?: HttpClient): typeof fetch {
    const defaultHttpClient: HttpClient = client || new HttpClient();
    const fetch = async (
        input: RequestInfo | URL,
        init: RequestInit & { client?: HttpClient } = {},
    ): Promise<Response> => {
        if (!init.client) {
            Object.defineProperty(init, 'client', {
                enumerable: false,
                configurable: true,
                value: defaultHttpClient,
            });
        }
        return fetchImpl(input, init as RequestInit & { client: HttpClient });
    };
    const close: () => Promise<void> = async () => {
        // Avoid closing the HttpClient if it was provided by param.
        if (!client) {
            return defaultHttpClient?.close();
        }
    };
    return Object.assign(fetch, { close, [Symbol.asyncDispose]: close });
}
