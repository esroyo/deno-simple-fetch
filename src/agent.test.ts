import { assertEquals, assertRejects } from "./test-utils.ts";
import { createAgent } from "./agent.ts";
import { createTestServer } from "./test-utils.ts";

Deno.test("HTTP Agent", async (t) => {
  const { server, url } = await createTestServer(8081);
  
  try {
    await t.step("basic GET request", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/text",
        method: "GET"
      });
      
      assertEquals(response.status, 200);
      const text = await response.text();
      assertEquals(text, "Hello, World!");
    });
    
    await t.step("JSON response", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/json",
        method: "GET"
      });
      
      assertEquals(response.status, 200);
      const json = await response.json();
      assertEquals(json.message, "Hello, JSON!");
    });
    
    await t.step("POST request with body", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/echo",
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        body: JSON.stringify({ test: "data" })
      });
      
      assertEquals(response.status, 200);
      const echo = await response.json();
      assertEquals(echo.method, "POST");
    });
    
    await t.step("custom headers", async () => {
      const agent = createAgent(url);
      const response = await agent.send({
        path: "/echo",
        method: "GET",
        headers: new Headers({ "x-custom-header": "test-value" })
      });
      
      const echo = await response.json();
      assertEquals(echo.headers["x-custom-header"], "test-value");
    });
    
    await t.step("timeout handling", async () => {
      const agent = createAgent(url, { timeout: 100 });
      
      await assertRejects(
        () => agent.send({
          path: "/slow",
          method: "GET"
        }),
        Error
      );
    });
    
  } finally {
    await server.shutdown();
  }
});

