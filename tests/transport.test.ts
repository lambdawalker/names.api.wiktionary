import { describe, it, expect, vi } from 'vitest';
import { JsonTransport, SourceError } from '../src/transport.js';

const userAgent = 'NamesTest/1 (https://example.org/contact)';
const options = { userAgent, intervalMs: 0 };
describe('bounded transport', () => {
  it('sends identification, disables redirects, and exposes cache metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"ok":true}', { headers: { 'Cache-Control': 'max-age=60' } }));
    const result = await new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'));
    expect(result.data).toEqual({ ok: true });
    expect(result.cacheControl).toBe('max-age=60');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { 'User-Agent': userAgent } });
  });
  it('retries transient errors but never retries a missing page', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{}'));
    await new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'));
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockResolvedValue(new Response('', { status: 404 }));
    await expect(new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'))).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('exposes long Retry-After without sleeping or retrying', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'))).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 120000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries MediaWiki maxlag even with HTTP 200', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":{"code":"maxlag"}}', { headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{"parse":{}}'));
    await new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed JSON and decoded oversized bodies', async () => {
    for (const [body, code] of [['nope', 'invalid_response'], ['123456789', 'response_too_large']] as const) {
      await expect(new JsonTransport({ ...options, maxResponseBytes: 8, fetch: async () => new Response(body) }).get(new URL('https://example.org'))).rejects.toMatchObject({ code });
    }
  });
  it('times out stalled body reads and cancels their stream', async () => {
    const cancel = vi.fn();
    const fetch = async () => new Response(new ReadableStream({ cancel }));
    await expect(new JsonTransport({ ...options, timeoutMs: 25, fetch }).get(new URL('https://example.org'))).rejects.toMatchObject({ code: 'timeout' });
    expect(cancel).toHaveBeenCalled();
  });
  it('honors abort before requests and during body reads', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => new Response(new ReadableStream()));
    const request = new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'), controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(request).rejects.toMatchObject({ code: 'aborted' });
    await expect(new JsonTransport({ ...options, fetch }).get(new URL('https://example.org'), controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent calls even after a failure', async () => {
    let active = 0, peak = 0;
    const fetch = vi.fn(async () => {
      active++; peak = Math.max(active, peak);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return new Response(fetch.mock.calls.length === 1 ? 'invalid' : '{}');
    });
    const transport = new JsonTransport({ ...options, fetch });
    const result = await Promise.allSettled([transport.get(new URL('https://example.org')), transport.get(new URL('https://example.org'))]);
    expect(result.map(x => x.status)).toEqual(['rejected', 'fulfilled']); expect(peak).toBe(1);
  });
  it('validates config and endpoint safety', () => {
    expect(() => new JsonTransport({ userAgent: '' })).toThrow();
    expect(() => new JsonTransport({ ...options, retries: -1 })).toThrow();
    expect(SourceError).toBeTypeOf('function');
  });
});
