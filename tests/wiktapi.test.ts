import { it, expect, vi } from 'vitest';
import { WiktApiClient } from '../src/wiktapi.js';
const userAgent = 'NamesTest/1 (https://example.org/contact)';
it('preserves sparse real-world entries and all additional fields without inventing identity', async () => {
  const entry = { senses: [{ glosses: ['A male given name'] }], sounds: [], translations: [], forms: [], future_field: { x: 1 } };
  const fetch = vi.fn(async () => new Response(JSON.stringify({ word: 'John', edition: 'en', entries: [entry] })));
  const record = await new WiktApiClient({ userAgent, intervalMs: 0, fetch }).getWord('John', { languageCode: 'en' });
  expect(record.data.entries[0]).toEqual(entry);
  expect(record.data.entries[0]).not.toHaveProperty('lang_code');
  expect(record.revision).toBeUndefined();
  expect(record.locator).toBe('https://api.wiktapi.dev/v1/en/word/John?lang=en');
});
it('encodes titles as a single path segment and separates edition from language', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"word":"A/B ?#é","edition":"fr","entries":[]}'));
  const client = new WiktApiClient({ userAgent, intervalMs: 0, fetch });
  await client.getWord('A/B ?#é', { edition: 'fr', languageCode: 'es' });
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.wiktapi.dev/v1/fr/word/A%2FB%20%3F%23%C3%A9?lang=es');
});
it('returns prefix matches including distinct case spellings and fails invalid shapes', async () => {
  const matches = [{ word: 'John', lang_code: 'en', lang: 'English', pos: 'name' }, { word: 'john', lang_code: 'en', lang: null, pos: null }];
  const client = new WiktApiClient({ userAgent, intervalMs: 0, fetch: async () => new Response(JSON.stringify({ results: matches })) });
  expect((await client.search('Joh')).data.results).toEqual(matches);
  const bad = new WiktApiClient({ userAgent, intervalMs: 0, fetch: async () => new Response('{"entries":"bad"}') });
  await expect(bad.getWord('John')).rejects.toMatchObject({ code: 'invalid_response' });
});
it('rejects hostile editions and insecure remote base URLs before fetching', async () => {
  expect(() => new WiktApiClient({ userAgent, baseUrl: 'http://example.org' })).toThrow();
  const fetch = vi.fn(); const client = new WiktApiClient({ userAgent, fetch });
  await expect(client.getWord('John', { edition: '../en' })).rejects.toThrow();
  await expect(client.getWord('')).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
