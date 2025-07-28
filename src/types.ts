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
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<Uint8Array>;
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
