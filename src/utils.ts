import { TimeoutOptions } from "./types.ts";

export function createAbortablePromise<T>(
  promise: Promise<T>, 
  options: TimeoutOptions = {}
): Promise<T> {
  const { timeout, signal } = options;
  
  if (!timeout && !signal) {
    return promise;
  }
  
  const signals: AbortSignal[] = [];
  
  if (timeout && timeout > 0) {
    signals.push(AbortSignal.timeout(timeout));
  }
  
  if (signal) {
    signals.push(signal);
  }
  
  if (signals.length === 0) {
    return promise;
  }
  
  const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      if (combinedSignal.reason instanceof Error) {
        reject(combinedSignal.reason);
      } else if (combinedSignal.reason) {
        reject(new Error(String(combinedSignal.reason)));
      } else {
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      }
    };
    
    if (combinedSignal.aborted) {
      onAbort();
      return;
    }
    
    combinedSignal.addEventListener('abort', onAbort, { once: true });
    
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        combinedSignal.removeEventListener('abort', onAbort);
      });
  });
}
