import type {
    Agent,
    RequestInit,
    Response,
    ResponseWithExtras,
    TimeoutOptions,
} from './types.ts';
import { createAgent } from './agent.ts';
import { createAbortablePromise } from './utils.ts';

// Fetch-like client class
export class HttpClient {
    protected _agent?: Agent;

    constructor(baseUrl?: string, options: TimeoutOptions = {}) {
        if (baseUrl) {
            this._agent = createAgent(baseUrl, options);
        }
    }

    // Main fetch method - matches standard fetch API
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

        // Convert headers to Headers object
        const headers = this._normalizeHeaders(headersInit);

        // Convert body to supported format
        const processedBody = this._processBody(body, headers);

        // If no base URL was provided, create a one-time agent
        const agent = this._agent ||
            this._createTemporaryAgent(url, { signal });

        try {
            // Apply abort signal to the send operation
            const sendPromise = agent.send({
                path: this._agent
                    ? url
                    : new URL(url).pathname + new URL(url).search,
                method,
                headers,
                body: processedBody,
            });

            // Create timeout options for this specific request
            const timeoutOptions: TimeoutOptions = {};
            if (signal) timeoutOptions.signal = signal;

            const response = await createAbortablePromise(
                sendPromise,
                timeoutOptions,
            );

            return this._createResponse(response, url);
        } finally {
            // Clean up temporary agent
            if (!this._agent) {
                agent.close();
            }
        }
    }

    // Connection management
    close(): void {
        this._agent?.close();
    }

    [Symbol.dispose](): void {
        this.close();
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
            typeof body === 'string' || body instanceof Uint8Array ||
            body instanceof ReadableStream
        ) {
            return body;
        }

        if (body instanceof FormData) {
            // For multipart form data, you'd need to implement multipart encoding
            throw new Error(
                'FormData bodies require multipart encoding implementation',
            );
        }

        if (body instanceof URLSearchParams) {
            headers?.set('content-type', 'application/x-www-form-urlencoded');
            return body.toString();
        }

        // Handle other body types
        return String(body);
    }

    protected _createTemporaryAgent(
        url: string,
        options: { signal?: AbortSignal },
    ): Agent {
        const urlObj = new URL(url);
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        return createAgent(baseUrl, {
            signal: options.signal,
        });
    }

    protected _createResponse(
        response: ResponseWithExtras,
        url: string,
    ): Response {
        // Track if body has been used for any of the response methods
        let bodyUsed = false;

        // Create wrapped methods that track usage
        const wrapBodyMethod = <T>(method: () => Promise<T>) => {
            return async (): Promise<T> => {
                if (bodyUsed) {
                    throw new TypeError('body stream already read');
                }
                bodyUsed = true;
                return await method();
            };
        };

        return {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            ok: response.ok,
            url,
            body: response.body,
            get bodyUsed() {
                return bodyUsed;
            },
            json: wrapBodyMethod(() => response.json()),
            text: wrapBodyMethod(() => response.text()),
            formData: wrapBodyMethod(() => response.formData()),
            arrayBuffer: wrapBodyMethod(() => response.arrayBuffer()),
            blob: wrapBodyMethod(() => response.blob()),
        };
    }
}

// Factory function for creating a bound fetch function
export function createFetch(
    baseUrl?: string,
    defaultOptions: TimeoutOptions = {},
) {
    const client = new HttpClient(baseUrl, defaultOptions);

    return {
        fetch: client.fetch.bind(client),
        close: client.close.bind(client),
        [Symbol.dispose]: client[Symbol.dispose].bind(client),
    };
}
