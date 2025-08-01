import type {
    AgentPool,
    RequestInit,
    Response,
    ResponseWithExtras,
} from './types.ts';
import { createAgentPool } from './agent-pool.ts';

export class HttpClient {
    protected _agentPools: Record<string, AgentPool> = {};

    async fetch(
        input: string | URL,
        init: RequestInit = {},
    ): Promise<Response> {
        const url = typeof input === 'string' ? input : input.toString();
        const {
            method = 'GET',
            headers: headersInit,
            body,
            signal,
        } = init;

        const headers = this._normalizeHeaders(headersInit);
        const processedBody = this._processBody(body, headers);

        // Use existing pool or create temporary one
        const agentPool = this._getOrCreateAgentPool(url);
        const response = await agentPool.send({
            url,
            method,
            headers,
            body: processedBody,
            signal,
        });
        return response;
    }

    async close(): Promise<void> {
        await Promise.all(
            Object.entries(this._agentPools).map(([key, agentPool]) =>
                agentPool.close().then(() => delete this._agentPools[key])
            ),
        );
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    protected _normalizeHeaders(headersInit?: HeadersInit): Headers {
        if (!headersInit) return new Headers();
        if (headersInit instanceof Headers) return headersInit;
        if (Array.isArray(headersInit)) {
            return new Headers(headersInit);
        }
        return new Headers(Object.entries(headersInit));
    }

    protected _processBody(
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

    protected _getOrCreateAgentPool(
        url: string,
    ): AgentPool {
        const origin = new URL(url).origin;
        return this._agentPools[origin] = this._agentPools[origin] ||
            createAgentPool(origin);
    }
}

// Factory function for creating bound fetch function
export function createFetch() {
    const client = new HttpClient();
    return {
        fetch: client.fetch.bind(client),
        close: client.close.bind(client),
        [Symbol.asyncDispose]: client[Symbol.asyncDispose].bind(client),
    };
}
