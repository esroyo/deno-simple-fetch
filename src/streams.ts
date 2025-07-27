import { TimeoutOptions } from './types.ts';

export function createTimeoutStream(
  stream: ReadableStream<Uint8Array>, 
  options: TimeoutOptions = {}
): ReadableStream<Uint8Array> {
  if (!options.timeout && !options.signal) {
    return stream;
  }

  const signals: AbortSignal[] = [];
  
  if (options.timeout && options.timeout > 0) {
    signals.push(AbortSignal.timeout(options.timeout));
  }
  
  if (options.signal) {
    signals.push(options.signal);
  }
  
  if (signals.length === 0) {
    return stream;
  }
  
  const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  
  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      
      const onAbort = () => {
        reader.cancel(combinedSignal.reason || new DOMException('The operation timed out.', 'TimeoutError'));
        controller.error(combinedSignal.reason || new DOMException('The operation timed out.', 'TimeoutError'));
      };
      
      if (combinedSignal.aborted) {
        onAbort();
        return;
      }
      
      combinedSignal.addEventListener('abort', onAbort, { once: true });
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        combinedSignal.removeEventListener('abort', onAbort);
        reader.releaseLock();
      }
    }
  });
}

// Chunked encoding using TransformStream
export function createChunkedEncodingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  
  return new TransformStream({
    transform(chunk, controller) {
      const chunkSize = chunk.length.toString(16);
      controller.enqueue(encoder.encode(`${chunkSize}\r\n`));
      controller.enqueue(chunk);
      controller.enqueue(encoder.encode('\r\n'));
    },
    
    flush(controller) {
      controller.enqueue(encoder.encode('0\r\n\r\n'));
    }
  });
}

// Chunked decoding using TransformStream
export function createChunkedDecodingStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);
  let state: 'size' | 'data' | 'trailer' = 'size';
  let chunkSize = 0;
  let chunkBytesRead = 0;
  
  function appendToBuffer(newData: Uint8Array) {
    const combined = new Uint8Array(buffer.length + newData.length);
    combined.set(buffer);
    combined.set(newData, buffer.length);
    buffer = combined;
  }
  
  function readLine(): string | null {
    const crlfIndex = findCRLF(buffer);
    if (crlfIndex === -1) return null;
    
    const line = decoder.decode(buffer.slice(0, crlfIndex));
    buffer = buffer.slice(crlfIndex + 2);
    return line;
  }
  
  function findCRLF(data: Uint8Array): number {
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i] === 0x0D && data[i + 1] === 0x0A) {
        return i;
      }
    }
    return -1;
  }
  
  return new TransformStream({
    transform(chunk, controller) {
      appendToBuffer(chunk);
      
      while (buffer.length > 0) {
        if (state === 'size') {
          const sizeLine = readLine();
          if (sizeLine === null) break;
          
          chunkSize = parseInt(sizeLine, 16);
          if (chunkSize === 0) {
            state = 'trailer';
            continue;
          }
          
          state = 'data';
          chunkBytesRead = 0;
        } else if (state === 'data') {
          const bytesNeeded = chunkSize - chunkBytesRead;
          const bytesAvailable = Math.min(bytesNeeded, buffer.length);
          
          if (bytesAvailable > 0) {
            controller.enqueue(buffer.slice(0, bytesAvailable));
            buffer = buffer.slice(bytesAvailable);
            chunkBytesRead += bytesAvailable;
          }
          
          if (chunkBytesRead === chunkSize) {
            // Skip trailing CRLF
            if (buffer.length >= 2 && buffer[0] === 0x0D && buffer[1] === 0x0A) {
              buffer = buffer.slice(2);
            }
            state = 'size';
          } else {
            break;
          }
        } else if (state === 'trailer') {
          const trailerLine = readLine();
          if (trailerLine === null) break;
          if (trailerLine === '') {
            controller.terminate();
            return;
          }
        }
      }
    }
  });
}

// Compression utilities
export function createCompressionStream(format: CompressionFormat = 'gzip'): CompressionStream {
  return new CompressionStream(format);
}

export function createDecompressionStream(format: CompressionFormat = 'gzip'): DecompressionStream {
  return new DecompressionStream(format);
}

// Connection to ReadableStream
export function connectionToReadableStream(conn: Deno.Conn): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const buffer = new Uint8Array(8192);
      
      try {
        while (true) {
          const bytesRead = await conn.read(buffer);
          if (bytesRead === null) {
            controller.close();
            break;
          }
          controller.enqueue(buffer.slice(0, bytesRead));
        }
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

