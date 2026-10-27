import { z } from 'zod';
import { JsonTransport, SourceError } from './transport.js';
import { editionCode, endpoint, text, type ClientOptions, type LookupOptions, type SourceRecord } from './types.js';

const WordSchema = z.looseObject({ word: z.string(), edition: z.string(), entries: z.array(z.record(z.string(), z.unknown())) });
const SearchSchema = z.looseObject({ results: z.array(z.looseObject({ word: z.string(), lang_code: z.string(), lang: z.string().nullable().optional(), pos: z.string().nullable().optional() })) });
export type WordData = z.infer<typeof WordSchema>;
export type SearchData = z.infer<typeof SearchSchema>;

/** WiktAPI is a Kaikki-derived snapshot; its records need not contain etymology or language identity. */
export class WiktApiClient {
  private readonly transport: JsonTransport;
  private readonly base: URL;
  constructor(options: ClientOptions & { baseUrl?: string }) {
    this.base = endpoint(options.baseUrl ?? 'https://api.wiktapi.dev/');
    if (!this.base.pathname.endsWith('/')) this.base.pathname += '/';
    this.transport = new JsonTransport(options);
  }
  async getWord(word: string, options: LookupOptions = {}): Promise<SourceRecord<WordData>> {
    const url = this.url(`${editionCode(options.edition)}/word/${encodeURIComponent(text(word, 'word'))}`, options.languageCode);
    const result = await this.transport.get(url, options.signal);
    const parsed = WordSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.edition !== editionCode(options.edition)) throw new SourceError('invalid_response', 'Invalid WiktAPI word response');
    return { source: 'wiktapi', upstreamSource: 'Wiktionary via Kaikki', locator: url.href, retrievedAt: result.fetchedAt, cacheControl: result.cacheControl, data: parsed.data };
  }
  async search(prefix: string, options: LookupOptions = {}): Promise<SourceRecord<SearchData>> {
    const url = this.url(`${editionCode(options.edition)}/search`, options.languageCode);
    url.searchParams.set('q', text(prefix, 'prefix'));
    const result = await this.transport.get(url, options.signal);
    const parsed = SearchSchema.safeParse(result.data);
    if (!parsed.success) throw new SourceError('invalid_response', 'Invalid WiktAPI search response');
    return { source: 'wiktapi', upstreamSource: 'Wiktionary via Kaikki', locator: url.href, retrievedAt: result.fetchedAt, cacheControl: result.cacheControl, data: parsed.data };
  }
  private url(path: string, languageCode?: string): URL {
    const url = new URL(`v1/${path}`, this.base);
    if (languageCode !== undefined) url.searchParams.set('lang', text(languageCode, 'language code'));
    return url;
  }
}
