import type { ClientOptions } from './types.js';

export type ErrorCode = 'not_found' | 'http' | 'rate_limited' | 'timeout' | 'aborted' | 'invalid_response' | 'network' | 'response_too_large' | 'api_error' | 'language_not_found' | 'document_too_large';
export class SourceError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(message); this.name = 'SourceError';
  }
}
export interface JsonResult { data: unknown; fetchedAt: string; cacheControl?: string }

function aborted(): SourceError { return new SourceError('aborted', 'Source request cancelled'); }
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted();
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function retryAfter(header: string | null, now: number): number | undefined {
  if (!header) return;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000);
  const date = Date.parse(header); return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
async function readJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new SourceError('invalid_response', 'Empty source response');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new SourceError('response_too_large', 'Source response exceeds byte limit');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new SourceError('invalid_response', 'Source returned invalid JSON'); }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Serial per instance. Share an instance per provider when researching concurrently. */
export class JsonTransport {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStarted = 0;
  private readonly options: Required<ClientOptions>;
  constructor(options: ClientOptions) {
    if (!options.userAgent?.trim() || /[\r\n]/.test(options.userAgent)) throw new TypeError('An informative User-Agent is required');
    this.options = { fetch: globalThis.fetch, timeoutMs: 15000, intervalMs: 1000, retries: 2, maxResponseBytes: 8 * 1024 * 1024, now: () => new Date(), ...options };
    for (const [key, min, max] of [['timeoutMs', 1, 120000], ['intervalMs', 0, 60000], ['retries', 0, 5], ['maxResponseBytes', 1, 8 * 1024 * 1024]] as const) {
      const n = this.options[key]; if (!Number.isInteger(n) || n < min || n > max) throw new TypeError(`Invalid ${key}`);
    }
  }
  get(url: URL, signal?: AbortSignal): Promise<JsonResult> {
    const request = this.tail.then(() => this.run(url, signal));
    this.tail = request.catch(() => {});
    // Aborting a queued caller need not wait for the current request to complete.
    return signal ? raceAbort(request, signal) : request;
  }
  private async run(url: URL, signal?: AbortSignal): Promise<JsonResult> {
    const opts = this.options;
    for (let attempt = 0; ; attempt++) {
      await delay(Math.max(0, this.lastStarted + opts.intervalMs - Date.now()), signal);
      if (signal?.aborted) throw aborted();
      this.lastStarted = Date.now();
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), opts.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
      let wait: number | undefined; let failure: SourceError | undefined;
      try {
        const response = await raceAbort(opts.fetch(url, { method: 'GET', headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' }, signal: combined, redirect: 'error' }), combined);
        const retry = retryAfter(response.headers.get('Retry-After'), opts.now().getTime());
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          const transient = [429, 502, 503, 504].includes(response.status);
          failure = new SourceError(response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'http', `Source returned HTTP ${response.status}`, response.status, retry);
          if (transient) wait = retry ?? 1000 * 2 ** attempt;
        } else {
          const data = await readJson(response, opts.maxResponseBytes, combined);
          const envelope = data as { error?: { code?: string } } | null;
          if (envelope?.error && typeof envelope.error === 'object') {
            const code = envelope.error.code;
            failure = new SourceError(code === 'missingtitle' ? 'not_found' : ['maxlag', 'ratelimited'].includes(code ?? '') ? 'rate_limited' : 'api_error', `Source API error: ${typeof code === 'string' ? code.slice(0, 64) : 'unknown'}`, response.status, retry);
            if (['maxlag', 'ratelimited'].includes(code ?? '')) wait = retry ?? 1000 * 2 ** attempt;
          } else {
            return { data, fetchedAt: opts.now().toISOString(), ...(response.headers.get('Cache-Control') ? { cacheControl: response.headers.get('Cache-Control')! } : {}) };
          }
        }
      } catch (error) {
        if (signal?.aborted) throw aborted();
        if (timeout.signal.aborted) throw new SourceError('timeout', 'Source request timed out');
        if (error instanceof SourceError) throw error;
        throw new SourceError('network', 'Source request failed');
      } finally { clearTimeout(timer); }
      if (!failure) throw new SourceError('invalid_response', 'Source request failed');
      if (wait === undefined || wait > 60000 || attempt >= opts.retries) throw failure;
      await delay(wait, signal);
    }
  }
}
