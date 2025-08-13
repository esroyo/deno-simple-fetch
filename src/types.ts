export interface TimeoutOptions {
    signal?: AbortSignal;
}

export interface SendOptions {
    url: URL;
    method: string;
    headers?: Headers;
    body?: string | Uint8Array | ReadableStream;
    signal?: AbortSignal;
}

// Single-connection agent (simple, blocking)
export interface Agent {
    [Symbol.dispose](): void;
    close(): void;
    hostname: string;
    port: number;
    send(options: SendOptions): Promise<Response>;
    whenIdle(): Promise<void>;
    readonly isIdle: boolean;
}

// Agent pool configuration
export interface AgentPoolOptions {
    /**
     * Sets the maximum number of idle connections per host allowed in the pool.
     */
    poolMaxIdlePerHost?: number;
    /**
     * Sets the maximum number of connections per host allowed in the pool.
     * Default to no limits.
     */
    poolMaxPerHost?: number;
    /**
     * Set an optional timeout for idle sockets being kept-alive.
     * Set to false to disable the timeout. Defaults to 30s.
     */
    poolIdleTimeout?: number | false;
}

// Agent pool interface (handles concurrency)
export interface AgentPool {
    [Symbol.asyncDispose](): Promise<void>;
    close(): Promise<void>;
    hostname: string;
    port: number;
    send(options: SendOptions): Promise<Response>;
}

// Standard fetch API types
export interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit;
    signal?: AbortSignal;
}

export type BodyInit =
    | string
    | Uint8Array
    | ReadableStream
    | FormData
    | URLSearchParams;
export type HeadersInit = Headers | Record<string, string> | [string, string][];
