export function createBodyParser(
  stream: ReadableStream<Uint8Array>, 
  contentType: string
): {
  json(): Promise<any>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  arrayBuffer(): Promise<Uint8Array>;
} {
  let cachedArrayBuffer: Uint8Array | undefined;
  
  async function getArrayBuffer(): Promise<Uint8Array> {
    if (cachedArrayBuffer) {
      return cachedArrayBuffer;
    }
    
    let totalLength = 0;
    const chunks: Uint8Array[] = await Array.fromAsync(stream, (chunk) => {
        totalLength += chunk.length;
        return chunk;
    });

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return cachedArrayBuffer = result;
  }
  
  return {
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
        throw new Error("Multipart form data parsing requires additional implementation");
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await this.text();
        const formData = new FormData();
        const params = new URLSearchParams(text);
        for (const [key, value] of params) {
          formData.append(key, value);
        }
        return formData;
      } else {
        throw new Error("Unsupported content type for form data");
      }
    },
    
    async arrayBuffer(): Promise<Uint8Array> {
      return await getArrayBuffer();
    }
  };
}
