import { TimeoutOptions } from './types.ts';

export function createAbortablePromise<T>(
    promise: Promise<T>,
    options: TimeoutOptions = {},
): Promise<T> {
    const { signal } = options;

    if (!signal) {
        return promise;
    }

    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            if (signal.reason instanceof Error) {
                reject(signal.reason);
            } else if (signal.reason) {
                reject(new Error(String(signal.reason)));
            } else {
                reject(
                    new DOMException(
                        'The operation was aborted.',
                        'AbortError',
                    ),
                );
            }
        };

        if (signal.aborted) {
            onAbort();
            return;
        }

        signal.addEventListener('abort', onAbort, { once: true });

        promise
            .then(resolve)
            .catch(reject)
            .finally(() => {
                signal.removeEventListener('abort', onAbort);
            });
    });
}
