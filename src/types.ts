export interface TimeoutOptions {
    timeout?: number;
    signal?: AbortSignal;
}

export interface SendOptions {
    path: string;
    method: string;
    headers?: Headers;
    body?: string | Uint8Array | ReadableStream;
}

export interface ResponseWithExtras {
    proto: string;
    status: number;
    statusText: string;
    headers: Headers;
    body: ReadableStream<Uint8Array>;
    ok: boolean;
    bodyUsed: boolean;
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    conn?: Deno.Conn;
}

export interface Agent {
    [Symbol.dispose](): void;
    close(): void;
    hostname: string;
    port: number;
    send(options: SendOptions): Promise<ResponseWithExtras>;
    readonly conn: Deno.Conn | undefined;
}

// Enhanced types that match fetch API more closely
export interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit;
    signal?: AbortSignal;
    // Non-standard but useful extension
    timeout?: number;
}

export type BodyInit =
    | string
    | Uint8Array
    | ReadableStream
    | FormData
    | URLSearchParams;
export type HeadersInit = Headers | Record<string, string> | [string, string][];

export interface Response {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly ok: boolean;
    readonly url: string;
    readonly body: ReadableStream<Uint8Array>;
    readonly bodyUsed: boolean;

    // Body methods
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    clone(): Response;
}