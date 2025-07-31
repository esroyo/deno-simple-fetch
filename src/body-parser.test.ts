import { assertEquals } from './test-utils.ts';
import { createBodyParser } from './body-parser.ts';

Deno.test('Body Parser', async (t) => {
    await t.step('parse JSON', async () => {
        const data = { message: 'hello', number: 42 };
        const jsonString = JSON.stringify(data);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(jsonString));
                controller.close();
            },
        });

        const parser = createBodyParser(
            stream,
            'application/json',
        );

        const result = await parser.json();
        assertEquals(result, data);
    });

    await t.step('parse text', async () => {
        const text = 'Hello, world!';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(text));
                controller.close();
            },
        });

        const parser = createBodyParser(
            stream,
            'text/plain',
        );

        const result = await parser.text();
        assertEquals(result, text);
    });

    await t.step('parse URL-encoded form', async () => {
        const formData = 'name=John&age=30&city=New+York';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(formData));
                controller.close();
            },
        });

        const parser = createBodyParser(
            stream,
            'application/x-www-form-urlencoded',
        );

        const result = await parser.formData();
        assertEquals(result.get('name'), 'John');
        assertEquals(result.get('age'), '30');
        assertEquals(result.get('city'), 'New York');
    });

    await t.step('arrayBuffer', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const expectedArrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
        );

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            },
        });

        const parser = createBodyParser(
            stream,
            'application/octet-stream',
        );

        const result = await parser.arrayBuffer();
        assertEquals(result, expectedArrayBuffer);
    });
});
