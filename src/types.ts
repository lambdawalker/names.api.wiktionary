/** Structural match for the research store's source boundary; not a verified claim. */
export interface SourceRecord<T> {
  source: string;
  locator: string;
  retrievedAt: string;
  revision?: string;
  upstreamSource?: string;
  cacheControl?: string;
  data: T;
}
export interface ClientOptions {
  userAgent: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  intervalMs?: number;
  retries?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}
export interface LookupOptions {
  edition?: string;
  languageCode?: string;
  signal?: AbortSignal;
}
export function text(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`Invalid ${label}`);
  return value.normalize('NFC');
}
export function editionCode(value = 'en'): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw new TypeError('Invalid edition');
  return value;
}
export function endpoint(value: string): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.hash || url.search) throw new TypeError('Endpoint must use HTTPS (or loopback HTTP) without credentials, query, or fragment');
  return url;
}
