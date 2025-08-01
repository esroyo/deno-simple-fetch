export function createBodyParser(
    stream: ReadableStream<Uint8Array>,
    contentType: string,
): {
    json(): Promise<any>;
    text(): Promise<string>;
    formData(): Promise<FormData>;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob>;
    bodyUsed: boolean;
} {
    let bodyUsed = false;

    function assertNotUsed() {
        if (bodyUsed) {
            throw new TypeError('body stream already read');
        }
        bodyUsed = true;
    }

    async function getArrayBuffer(): Promise<ArrayBuffer> {
        assertNotUsed();

        let totalLength = 0;
        const chunks: Uint8Array[] = await Array.fromAsync(stream, (chunk) => {
            totalLength += chunk.length;
            return chunk;
        });

        const arrayBuffer = new ArrayBuffer(totalLength);
        const view = new Uint8Array(arrayBuffer);

        let offset = 0;
        for (const chunk of chunks) {
            view.set(chunk, offset);
            offset += chunk.length;
        }

        return arrayBuffer;
    }

    return {
        get bodyUsed(): boolean {
            return bodyUsed;
        },

        async json(): Promise<any> {
            const buffer = await getArrayBuffer();
            const text = new TextDecoder().decode(buffer);
            return JSON.parse(text);
        },

        async text(): Promise<string> {
            const buffer = await getArrayBuffer();
            return new TextDecoder().decode(buffer);
        },

        async formData(): Promise<FormData> {
            if (contentType.includes('multipart/form-data')) {
                throw new Error(
                    'Multipart form data parsing requires additional implementation',
                );
            } else if (
                contentType.includes('application/x-www-form-urlencoded')
            ) {
                const text = await this.text();
                const formData = new FormData();
                const params = new URLSearchParams(text);
                for (const [key, value] of params) {
                    formData.append(key, value);
                }
                return formData;
            } else {
                throw new Error('Unsupported content type for form data');
            }
        },

        async blob(): Promise<Blob> {
            const buffer = await getArrayBuffer();
            return new Blob([buffer], {
                type: contentType || 'application/octet-stream',
            });
        },

        async arrayBuffer(): Promise<ArrayBuffer> {
            return getArrayBuffer();
        },
    };
}
