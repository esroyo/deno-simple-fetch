import { assertEquals } from './test-utils.ts';
import { ConnectionClosedError, UnexpectedEofError } from './errors.ts';

Deno.test('Error Classes', async (t) => {
    await t.step('UnexpectedEofError', async () => {
        const error = new UnexpectedEofError();
        assertEquals(error.name, 'UnexpectedEofError');
        assertEquals(error.message, 'unexpected eof');

        const customError = new UnexpectedEofError('custom message');
        assertEquals(customError.message, 'custom message');
    });

    await t.step('ConnectionClosedError', async () => {
        const error = new ConnectionClosedError();
        assertEquals(error.name, 'ConnectionClosedError');
        assertEquals(error.message, 'connection closed');

        const customError = new ConnectionClosedError('custom message');
        assertEquals(customError.message, 'custom message');
    });

    await t.step('error inheritance', async () => {
        const eofError = new UnexpectedEofError();
        const connError = new ConnectionClosedError();

        assertEquals(eofError instanceof Error, true);
        assertEquals(connError instanceof Error, true);
        assertEquals(eofError instanceof UnexpectedEofError, true);
        assertEquals(connError instanceof ConnectionClosedError, true);
    });
});
