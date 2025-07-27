import { assertEquals, assertRejects } from "./test-utils.ts";
import { createAbortablePromise } from "./utils.ts";

Deno.test("Utility functions", async (t) => {
  await t.step("createAbortablePromise - normal resolution", async () => {
    const promise = Promise.resolve("success");
    const result = await createAbortablePromise(promise);
    assertEquals(result, "success");
  });
  
  await t.step("createAbortablePromise - timeout", async () => {
    const slowPromise = new Promise(resolve => setTimeout(resolve, 200));
    
    await assertRejects(
      () => createAbortablePromise(slowPromise, { timeout: 100 }),
      'The operation timed out.'
    );

    await slowPromise;
  });
  
  await t.step("createAbortablePromise - abort signal", async () => {
    const controller = new AbortController();
    const slowPromise = new Promise(resolve => setTimeout(resolve, 200));
    
    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);
    
    await assertRejects(
      () => createAbortablePromise(slowPromise, { signal: controller.signal }),
      Error
    );

    await slowPromise;
  });
});
