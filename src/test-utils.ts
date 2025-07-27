import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";

export { assertEquals, assertRejects };

// Mock test server
export async function createTestServer(port = 8080): Promise<{ server: Deno.HttpServer, url: string }> {
  const server = Deno.serve({
    port,
    hostname: "127.0.0.1",
  }, (req) => {
    const url = new URL(req.url);
    
    // Echo endpoint - returns request info as JSON
    if (url.pathname === "/echo") {
      return Response.json({
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
      });
    }
    
    // Text endpoint
    if (url.pathname === "/text") {
      return new Response("Hello, World!");
    }
    
    // JSON endpoint
    if (url.pathname === "/json") {
      return Response.json({ message: "Hello, JSON!" });
    }
    
    // Chunked endpoint
    if (url.pathname === "/chunked") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("chunk1"));
          controller.enqueue(encoder.encode("chunk2"));
          controller.enqueue(encoder.encode("chunk3"));
          controller.close();
        }
      });
      
      return new Response(stream, {
        headers: { "transfer-encoding": "chunked" }
      });
    }
    
    // Gzip endpoint
    if (url.pathname === "/gzip") {
      const text = "This is compressed content!";
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        }
      }).pipeThrough(new CompressionStream("gzip"));
      
      return new Response(stream, {
        headers: { "content-encoding": "gzip" }
      });
    }
    
    // Timeout endpoint (slow response)
    if (url.pathname === "/slow") {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(new Response("Finally!"));
        }, 2000);
      });
    }
    
    return new Response("Not Found", { status: 404 });
  });
  
  return {
    server,
    url: `http://127.0.0.1:${port}`
  };
}


