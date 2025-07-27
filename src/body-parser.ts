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
    
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }
    } finally {
      reader.releaseLock();
    }
    
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
