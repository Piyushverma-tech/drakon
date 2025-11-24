/**
 * runInWorker
 * A tiny helper to offload a pure function to a Web Worker using a Blob.
 * Limitations:
 * - The function must be serializable (no closure over local scope or module imports).
 * - Avoid passing complex class instances; prefer plain objects or transferable ArrayBuffers.
 */
export function runInWorker<T, A extends unknown[]>(
  fn: (...args: A) => T,
  args: A
): Promise<T> {
  return new Promise((resolve, reject) => {
    // Serialize function and args
    const fnStr = fn.toString();
    const payload = { fn: fnStr, args };

    const blob = new Blob(
      [
        `self.onmessage = async (e) => {
         try {
           const { fn, args } = e.data;
           // eslint-disable-next-line no-eval
           const userFn = eval('(' + fn + ')');
           const result = await userFn(...args);
           self.postMessage({ ok: true, result });
         } catch (err) {
           self.postMessage({ ok: false, error: (err && err.message) || String(err) });
         }
       };`,
      ],
      { type: 'application/javascript' }
    );

    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = (ev) => {
      const data = ev.data as { ok: boolean; result?: T; error?: string };
      if (data.ok) resolve(data.result as T);
      else reject(new Error(data.error));
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    worker.onerror = (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    worker.postMessage(payload);
  });
}
