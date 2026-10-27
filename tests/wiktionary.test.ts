import { expect, it, vi } from 'vitest';
import { WiktionaryClient } from '../src/wiktionary.js';
import { toDocumentInput } from '../src/evidence.js';
const userAgent = 'NamesTest/1 (https://example.org/contact)';
const html = '<div class="mw-parser-output"><div class="mw-heading mw-heading2"><h2 id="English">English</h2></div><h3 id="Etymology">Etymology</h3><p>From <a href="/wiki/Iohannes#Latin">Iohannes</a>.</p><h3 id="Descendants">Descendants</h3><ul><li>English: John<ul><li>Spanish: Juan</li></ul></li></ul><h2 id="French">French</h2><p>Different usage.</p></div>';
const response = () => new Response(JSON.stringify({ parse: { title: 'John', pageid: 100, revid: 123, text: html } }));
it('fetches rendered source with revision identity and exact language scope', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const page = await new WiktionaryClient({ userAgent, intervalMs: 0, fetch, now: () => new Date('2026-10-27T00:00:00Z') }).getPage('John', { language: 'English' });
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.hostname).toBe('en.wiktionary.org'); expect(url.searchParams.get('prop')).toBe('text|revid');
  expect(page.revision).toBe('123'); expect(page.locator).toBe('https://en.wiktionary.org/w/index.php?title=John&oldid=123');
  expect(page.data.markdown).toContain('https://en.wiktionary.org/wiki/Iohannes#Latin');
  expect(page.data.markdown).toContain('Spanish: Juan'); expect(page.data.markdown).not.toContain('Different usage');
  expect(page.data.markdown).toContain('CC BY-SA 4.0');
  const section = page.data.sections.find(x => x.title === 'Etymology')!;
  expect(page.data.markdown.slice(section.start, section.end)).toContain('From');
  const document = toDocumentInput(page);
  expect(document).toMatchObject({ format: 'markdown', retention: 'allowed', source: { revision: '123', public_reuse: 'unknown', retrieved_at: '2026-10-27T00:00:00.000Z' } });
  expect(document.source.id).toMatch(/^wiktionary:[a-f0-9]{64}$/);
});
it('uses oldid without page when a revision is requested and rejects mismatched revisions', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const client = new WiktionaryClient({ userAgent, intervalMs: 0, fetch });
  await client.getPage('John', { revision: 123 });
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.searchParams.get('oldid')).toBe('123'); expect(url.searchParams.has('page')).toBe(false);
  await expect(client.getPage('John', { revision: 124 })).rejects.toMatchObject({ code: 'invalid_response' });
});
it('reports missing pages/language and malformed envelopes distinctly', async () => {
  const client = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => response() });
  await expect(client.getPage('John', { language: 'Spanish' })).rejects.toMatchObject({ code: 'language_not_found' });
  const missing = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => new Response('{"error":{"code":"missingtitle","info":"private"}}') });
  await expect(missing.getPage('missing')).rejects.toMatchObject({ code: 'not_found' });
  const malformed = new WiktionaryClient({ userAgent, fetch: async () => new Response('{"parse":{"title":"John","text":"<p>x</p>"}}') });
  await expect(malformed.getPage('John')).rejects.toMatchObject({ code: 'invalid_response' });
});
it('keeps other editions explicit without asserting a verified text license', async () => {
  const page = await new WiktionaryClient({ userAgent, fetch: async () => response() }).getPage('John', { edition: 'fr' });
  expect(page.data.edition).toBe('fr'); expect(page.data.license).toBeUndefined();
  expect(toDocumentInput(page).source.public_reuse).toBe('unknown');
  expect(toDocumentInput(page).retention).toBe('metadata_only');
});
it('separates immutable documents by selected language and revision', async () => {
  const client = new WiktionaryClient({ userAgent, intervalMs: 0, fetch: async () => response() });
  const english = toDocumentInput(await client.getPage('John', { language: 'English' }));
  const french = toDocumentInput(await client.getPage('John', { language: 'French' }));
  expect(english.source.id).not.toBe(french.source.id);
  expect(toDocumentInput(await client.getPage('John', { language: 'English' })).content).toBe(english.content);
});
it('does not grant public clearance to external quotations under the general original-text license', async () => {
  const fetch = async () => new Response(JSON.stringify({ parse: { title: 'John', pageid: 1, revid: 2, text: '<h2>English</h2><p>Original definition</p><blockquote>External copyrighted quotation</blockquote>' } }));
  const page = await new WiktionaryClient({ userAgent, fetch }).getPage('John');
  const document = toDocumentInput(page);
  expect(document.source.public_reuse).toBe('unknown');
  expect(document.retention).toBe('allowed');
  expect(document.content).toContain('Original entry text');
  expect(document.content).toContain('External quotations may have separate terms');
  expect(document.content).toContain('External copyrighted quotation');
});
