/** Bound upstream waits. Writes allow longer-running AI generation and uploads.
 * Never retry transport failures: a write may already have committed in Django.
 */
export function backendFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const timeout = AbortSignal.timeout(method === "GET" || method === "HEAD" ? 30_000 : 180_000);
  return fetch(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}
