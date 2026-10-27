import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawnSync } from 'node:child_process';
import { createWiktionaryMcpServer } from '../src/index.js';
import { WiktionaryClient } from '../src/wiktionary.js';
import { WiktApiClient } from '../src/wiktapi.js';
import { SourceError } from '../src/transport.js';

const userAgent = 'McpTest/1 (https://example.org/contact)';
const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(resources.splice(0).map(resource => resource.close())); });
function fixture() {
  let now = 0;
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.hostname === 'api.wiktapi.dev') return new Response(JSON.stringify({ results: Array.from({ length: 60 }, (_, i) => ({ word: `John${i}`, lang_code: 'en', extra: 'unbounded provider fields' })) }));
    const title = url.searchParams.get('page') ?? 'John';
    const revision = Number(url.searchParams.get('oldid') ?? 123);
    const html = `<h2 id="English">English</h2><p>${title} ${'a'.repeat(134000)}</p>${Array.from({ length: 101 }, (_, i) => `<h3>Section${i}</h3><p>test</p>`).join('')}<h2>French</h2><p>French only</p>`;
    return new Response(JSON.stringify({ parse: { title, pageid: 10, revid: revision, text: html } }));
  };
  const options = { userAgent, intervalMs: 0, fetch, now: () => new Date(now) };
  const pageClient = new WiktionaryClient(options), searchClient = new WiktApiClient(options);
  return { pageClient, searchClient, now: () => now, advance: (ms: number) => { now += ms; }, requests };
}
async function setup(options = fixture()) {
  const server = createWiktionaryMcpServer(options);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(b); await client.connect(a);
  return { client, ...options };
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return { result, data: JSON.parse(first?.type === 'text' ? first.text : '') };
}
it('advertises only validated read-only tools', async () => {
  const { client } = await setup();
  const listed = await client.listTools();
  expect(listed.tools.map(tool => tool.name).sort()).toEqual(['get_page', 'search']);
  for (const tool of listed.tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  for (const args of [{ title: '' }, { title: 'John', limit: 8001 }, { title: 'John', offset: -1 }, { title: 'John', revision: 0 }, { title: 'John', edition: '../x' }]) {
    expect((await client.callTool({ name: 'get_page', arguments: args })).isError).toBe(true);
  }
  expect((await client.callTool({ name: 'search', arguments: { prefix: '' } })).isError).toBe(true);
});
it('returns bounded Markdown with identity, section truncation and stable cached observation', async () => {
  const { client, requests } = await setup();
  const a = (await call(client, 'get_page', { title: 'John', language: 'English' })).data;
  expect(a.markdown).toHaveLength(4000);
  expect(a).toMatchObject({ title: 'John', edition: 'en', page_id: 10, revision: 123, language: 'English', offset: 0, next_offset: 4000, offset_unit: 'utf16', retrieved_at: '1970-01-01T00:00:00.000Z', sections_total: 102, sections_truncated: true });
  expect(a.locator).toContain('oldid=123'); expect(a.total_units).toBeGreaterThan(134000); expect(a.sections).toHaveLength(100);
  const b = (await call(client, 'get_page', { title: 'John', language: 'English', offset: a.next_offset, limit: 8000 })).data;
  expect(b.markdown).toHaveLength(8000); expect(b.retrieved_at).toBe(a.retrieved_at); expect(requests).toHaveLength(1);
  const end = (await call(client, 'get_page', { title: 'John', language: 'English', offset: a.total_units - 3 })).data;
  expect(end.markdown).toHaveLength(3); expect(end.next_offset).toBeNull();
  const beyond = (await call(client, 'get_page', { title: 'John', language: 'English', offset: a.total_units + 1 })).data;
  expect(beyond.markdown).toBe(''); expect(beyond.next_offset).toBeNull();
});
it('separates page cache by edition, exact language and revision', async () => {
  const { client, requests } = await setup();
  await call(client, 'get_page', { title: 'John', language: 'English', revision: 123 });
  const french = (await call(client, 'get_page', { title: 'John', language: 'French', revision: 123 })).data;
  expect(french.markdown).toContain('French only'); expect(french.markdown).not.toContain('Section0');
  expect((await call(client, 'get_page', { title: 'John', language: 'French', revision: 124 })).data.revision).toBe(124);
  expect((await call(client, 'get_page', { title: 'John', edition: 'fr', language: 'French', revision: 124 })).data.edition).toBe('fr');
  expect(requests).toHaveLength(4);
});
it('expires observations after five minutes and evicts the least recently used of eight pages', async () => {
  const f = fixture(); const { client } = await setup(f);
  for (let i = 0; i < 8; i++) await call(client, 'get_page', { title: `Name${i}`, language: 'French' });
  await call(client, 'get_page', { title: 'Name0', language: 'French' });
  await call(client, 'get_page', { title: 'Name8', language: 'French' });
  await call(client, 'get_page', { title: 'Name0', language: 'French' });
  expect(f.requests).toHaveLength(9);
  await call(client, 'get_page', { title: 'Name1', language: 'French' }); expect(f.requests).toHaveLength(10);
  f.advance(300000);
  const refreshed = (await call(client, 'get_page', { title: 'Name1', language: 'French' })).data;
  expect(f.requests).toHaveLength(11); expect(refreshed.retrieved_at).toBe('1970-01-01T00:05:00.000Z');
});
it('bounds search to fifty projected provider results with explicit scope', async () => {
  const { client, requests } = await setup();
  const { data } = await call(client, 'search', { prefix: 'Joh', edition: 'en', languageCode: 'en' });
  expect(data.results).toHaveLength(50); expect(data.results[0]).toEqual({ word: 'John0', lang_code: 'en' });
  expect(data).toMatchObject({ edition: 'en', language_code: 'en', returned: 50, truncated: true });
  expect(requests[0]?.searchParams.get('lang')).toBe('en'); expect(requests[0]?.searchParams.get('q')).toBe('Joh');
});
it('returns typed source failures and redacts internal messages', async () => {
  const f = fixture();
  f.pageClient.getPage = async () => { throw new SourceError('not_found', 'secret upstream message'); };
  const { client } = await setup(f);
  const missing = await call(client, 'get_page', { title: 'Missing' });
  expect(missing.result.isError).toBe(true); expect(missing.data.error.code).toBe('not_found'); expect(JSON.stringify(missing)).not.toContain('secret');
  f.pageClient.getPage = async () => { throw new Error('secret database credential'); };
  const internal = await call(client, 'get_page', { title: 'Other' });
  expect(internal.data.error.code).toBe('internal_error'); expect(JSON.stringify(internal)).not.toContain('secret');
});
it('forwards MCP cancellation to the provider signal', async () => {
  const f = fixture(); let received: AbortSignal | undefined; let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  f.pageClient.getPage = async (_title, options) => {
    received = options?.signal; started();
    return await new Promise((_resolve, reject) => received?.addEventListener('abort', () => reject(new SourceError('aborted', 'cancelled')), { once: true }));
  };
  const { client } = await setup(f); const controller = new AbortController();
  const request = client.callTool({ name: 'get_page', arguments: { title: 'John' } }, { signal: controller.signal });
  await ready; controller.abort(); await expect(request).rejects.toThrow();
  await new Promise(resolve => setTimeout(resolve, 10)); expect(received?.aborted).toBe(true);
});
it('starts the built stdio entry with protocol-only stdout and fails configuration on stderr', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/mcp-stdio.js'], env: { WIKTIONARY_USER_AGENT: userAgent }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' }); resources.push(client);
  await client.connect(transport); expect((await client.listTools()).tools).toHaveLength(2);
  const bad = spawnSync(process.execPath, ['dist/mcp-stdio.js'], { env: { ...process.env, WIKTIONARY_USER_AGENT: '' }, encoding: 'utf8' });
  expect(bad.status).toBe(1); expect(bad.stdout).toBe(''); expect(bad.stderr).toContain('WIKTIONARY_USER_AGENT');
});
it('bounds oversized real provider section labels and explicitly discloses metadata truncation', async () => {
  const f = fixture();
  f.pageClient = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ parse: {
    title: 'John', pageid: 1, revid: 123, text: `<h2>${'a'.repeat(500000)}</h2>`,
  } })) });
  const { client } = await setup(f);
  const { result, data } = await call(client, 'get_page', { title: 'John', limit: 1 });
  expect(result.isError).not.toBe(true); expect(data.metadata_truncated).toBe(true);
  expect(data.sections[0].title).toHaveLength(256);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
});
it('rejects oversized real provider search identities without returning changed words', async () => {
  const f = fixture();
  f.searchClient = new WiktApiClient({ userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ results: [{ word: 'x'.repeat(1000000), lang_code: 'en' }] })) });
  const { client } = await setup(f);
  const { result, data } = await call(client, 'search', { prefix: 'x' });
  expect(result.isError).toBe(true); expect(data.error.code).toBe('response_too_large'); expect(data.results).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
});
it('bounds the aggregate serialized result including UTF-8 and nested JSON escaping', async () => {
  const f = fixture();
  f.pageClient = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ parse: {
    title: 'John', pageid: 1, revid: 123, text: Array.from({ length: 100 }, () => `<h2>${'名'.repeat(256)}</h2>`).join(''),
  } })) });
  const { client } = await setup(f);
  const { result, data } = await call(client, 'get_page', { title: 'John', limit: 1 });
  expect(result.isError).toBe(true); expect(data.error.code).toBe('response_too_large');
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
});
it('rejects oversized source identity metadata rather than altering canonical titles or locators', async () => {
  const f = fixture();
  const original = f.pageClient.getPage.bind(f.pageClient);
  f.pageClient.getPage = async (title, options) => ({ ...await original(title, options), locator: 'https://example.org/' + 'x'.repeat(70000) });
  const { client } = await setup(f);
  const { result, data } = await call(client, 'get_page', { title: 'John', language: 'French', limit: 1 });
  expect(result.isError).toBe(true); expect(data.error.code).toBe('response_too_large');
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
});
it('rejects canonical titles above 256 units without truncating their identity', async () => {
  const f = fixture();
  f.pageClient = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ parse: {
    title: 'a'.repeat(300), pageid: 1, revid: 123, text: '<p>evidence</p>',
  } })) });
  const { client } = await setup(f);
  const { result, data } = await call(client, 'get_page', { title: 'John', limit: 1 });
  expect(result.isError).toBe(true); expect(data.error.code).toBe('response_too_large'); expect(data.title).toBeUndefined();
});
