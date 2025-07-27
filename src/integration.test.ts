import { assertEquals } from "./test-utils.ts";
import { createAgent } from "./agent.ts";
import { createTestServer } from "./test-utils.ts";

Deno.test("Integration tests", async (t) => {
  const { server, url } = await createTestServer(8082);
  
  try {
    await t.step("gzip decompression", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/gzip",
        method: "GET"
      });
      
      assertEquals(response.status, 200);
      const text = await response.text();
      assertEquals(text, "This is compressed content!");
    });
    
    await t.step("chunked transfer encoding", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/chunked",
        method: "GET"
      });
      
      assertEquals(response.status, 200);
      const text = await response.text();
      assertEquals(text, "chunk1chunk2chunk3");
    });
    
    await t.step("connection reuse", async () => {
      const agent = createAgent(url);
      
      // First request
      const response1 = await agent.send({
        path: "/text",
        method: "GET"
      });
      assertEquals(response1.status, 200);
      
      // Second request on same connection
      const response2 = await agent.send({
        path: "/json",
        method: "GET"
      });
      assertEquals(response2.status, 200);
      
      // Verify same connection was used
      assertEquals(agent.conn, response1.conn);
      assertEquals(agent.conn, response2.conn);
    });
    
  } finally {
    await server.shutdown();
  }
});
