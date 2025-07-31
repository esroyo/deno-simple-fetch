import type {
    Agent,
    RequestInit,
    Response as CustomResponse,
    ResponseWithExtras,
    TimeoutOptions,
} from './types.ts';
import { createAgent } from './agent.ts';
import { createAbortablePromise } from './utils.ts';

// Fetch-like client class
export class HttpClient {
    protected agent?: Agent;

    constructor(baseUrl?: string, options: TimeoutOptions = {}) {
        if (baseUrl) {
            this.agent = createAgent(baseUrl, options);
        }
    }

    // Main fetch method - matches standard fetch API
    async fetch(
        input: string | URL,
        init: RequestInit = {},
    ): Promise<CustomResponse> {
        const url = typeof input === 'string' ? input : input.toString();
        const {
            method = 'GET',
            headers: headersInit,
            body,
            signal,
            timeout,
        } = init;

        // Convert headers to Headers object
        const headers = this.normalizeHeaders(headersInit);

        // Convert body to supported format
        const processedBody = this.processBody(body, headers);

        // If no base URL was provided, create a one-time agent with timeout options
        const agent = this.agent ||
            this.createTemporaryAgent(url, { signal, timeout });

        try {
            // Apply timeout to the send operation
            const sendPromise = agent.send({
                path: this.agent
                    ? url
                    : new URL(url).pathname + new URL(url).search,
                method,
                headers,
                body: processedBody,
            });

            // Create timeout options for this specific request
            const timeoutOptions: TimeoutOptions = {};
            if (timeout !== undefined) timeoutOptions.timeout = timeout;
            if (signal) timeoutOptions.signal = signal;

            const response = await createAbortablePromise(sendPromise, timeoutOptions);

            return this.createResponse(response, url);
        } finally {
            // Clean up temporary agent
            if (!this.agent) {
                agent.close();
            }
        }
    }

    // Connection management
    close(): void {
        this.agent?.close();
    }

    [Symbol.dispose](): void {
        this.close();
    }

    protected normalizeHeaders(headersInit?: HeadersInit): Headers {
        if (!headersInit) return new Headers();
        if (headersInit instanceof Headers) return headersInit;
        if (Array.isArray(headersInit)) {
            return new Headers(headersInit);
        }
        return new Headers(Object.entries(headersInit));
    }

    protected processBody(
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

    protected createTemporaryAgent(
        url: string,
        options: { signal?: AbortSignal; timeout?: number },
    ): Agent {
        const urlObj = new URL(url);
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        return createAgent(baseUrl, {
            timeout: options.timeout,
            signal: options.signal,
        });
    }

    protected createResponse(
        response: ResponseWithExtras,
        url: string,
    ): CustomResponse {
        // Track if body has been used for any of the response methods
        let bodyUsed = false;
        
        // Immediately tee the stream when creating the response to enable cloning
        const [stream1, stream2] = response.body.tee();
        let currentBody = stream1;
        let cloneBody = stream2;

        // Create body parser for the current stream
        const createBodyParser = (stream: ReadableStream<Uint8Array>) => {
            let streamUsed = false;
            
            const wrapMethod = <T>(method: () => Promise<T>) => {
                return async (): Promise<T> => {
                    if (streamUsed) {
                        throw new TypeError('body stream already read');
                    }
                    streamUsed = true;
                    bodyUsed = true;
                    
                    // Read the stream manually
                    const chunks: Uint8Array[] = [];
                    const reader = stream.getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            chunks.push(value);
                        }
                    } finally {
                        reader.releaseLock();
                    }
                    
                    // Combine chunks
                    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.length;
                    }
                    
                    return method.call({ 
                        buffer: combined,
                        contentType: response.headers.get('content-type') ?? ''
                    });
                };
            };

            return {
                json: wrapMethod(async function(this: { buffer: Uint8Array }) {
                    const text = new TextDecoder().decode(this.buffer);
                    return JSON.parse(text);
                }),
                text: wrapMethod(async function(this: { buffer: Uint8Array }) {
                    return new TextDecoder().decode(this.buffer);
                }),
                arrayBuffer: wrapMethod(async function(this: { buffer: Uint8Array }) {
                    return this.buffer.buffer.slice(
                        this.buffer.byteOffset,
                        this.buffer.byteOffset + this.buffer.byteLength
                    );
                }),
                blob: wrapMethod(async function(this: { buffer: Uint8Array; contentType: string }) {
                    return new Blob([this.buffer], { 
                        type: this.contentType || 'application/octet-stream' 
                    });
                }),
                formData: wrapMethod(async function(this: { buffer: Uint8Array; contentType: string }) {
                    const text = new TextDecoder().decode(this.buffer);
                    if (this.contentType.includes('application/x-www-form-urlencoded')) {
                        const formData = new FormData();
                        const params = new URLSearchParams(text);
                        for (const [key, value] of params) {
                            formData.append(key, value);
                        }
                        return formData;
                    }
                    throw new Error('Unsupported content type for form data');
                })
            };
        };

        const bodyParser = createBodyParser(currentBody);

        const clone = (): CustomResponse => {
            if (bodyUsed) {
                throw new TypeError('body stream already read');
            }

            // Create new response with the clone stream
            const clonedResponse: ResponseWithExtras = {
                ...response,
                body: cloneBody,
            };

            return this.createResponse(clonedResponse, url);
        };

        return {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            ok: response.ok,
            url,
            body: currentBody,
            get bodyUsed() {
                return bodyUsed;
            },
            json: bodyParser.json,
            text: bodyParser.text,
            formData: bodyParser.formData,
            arrayBuffer: bodyParser.arrayBuffer,
            blob: bodyParser.blob,
            clone,
        } as CustomResponse;
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
