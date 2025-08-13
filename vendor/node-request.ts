import request from 'npm:request';

export interface HttpZParam {
    name: string;
    value?: string;
}

export interface HttpZBodyParam {
    type?: 'inline' | 'attachment';
    contentType?: string;
    name: string;
    fileName?: string;
}

export interface HttpZBody {
    contentType: string;
    boundary: string;
    params: HttpZParam[] | HttpZBodyParam[];
    text: string;
}

export interface HttpZResponseModel {
    protocolVersion: string;
    statusCode: number;
    statusMessage?: string;
    headers?: Record<string, string>;
    cookies?: HttpZParam[];
    body: HttpZBody;
    headersSize: number;
    bodySize: number;
}

export const nodeRequest = async (
    url: string,
    init: RequestInit & { timeout?: number } = {},
): Promise<Response> => {
    return new Promise<Response>((resolve, reject) => {
        init.headers = init.headers ?? {};
        const headers = Object.fromEntries(
            new Headers(init.headers).entries(),
        );
        const onAbort = (ev: Event) => {
            req.abort();
            const reason = (ev.target as AbortSignal).reason;
            const error = reason instanceof Error
                ? reason
                : new DOMException(reason ?? 'AbortError', 'AbortError');
            reject(error);
        };
        const req = request(
            {
                method: init?.method || 'GET',
                url,
                followRedirect: !init?.redirect || init.redirect === 'follow',
                headers,
                timeout: init?.timeout,
            },
            function (
                error: Error & { code?: string },
                response: HttpZResponseModel,
                body: string,
            ) {
                init?.signal?.removeEventListener('abort', onAbort);
                if (error) {
                    if (error.code?.endsWith('TIMEDOUT')) {
                        return resolve(
                            new Response(null, {
                                status: 504,
                                statusText: 'Gateway Timeout',
                            }),
                        );
                    }
                    return reject(error);
                }
                resolve(
                    new Response(body, {
                        headers: response.headers,
                        status: response.statusCode,
                        statusText: response.statusMessage,
                    }),
                );
            },
        );
        init?.signal?.addEventListener('abort', onAbort);
    });
};
