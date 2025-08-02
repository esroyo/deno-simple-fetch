export interface TimeoutOptions {
    signal?: AbortSignal;
}

export interface SendOptions {
    url: string;
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
    readonly lastUsed: number;
}

// Agent pool configuration
export interface AgentPoolOptions {
    maxAgents?: number;
    idleTimeout?: number;
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
