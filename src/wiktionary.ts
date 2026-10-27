import { z } from 'zod';
import { JsonTransport, SourceError } from './transport.js';
import { renderPage, MAX_MARKDOWN_BYTES, type MarkdownSection } from './markdown.js';
import { editionCode, text, type ClientOptions, type SourceRecord } from './types.js';

const ParseSchema = z.object({ parse: z.object({ title: z.string().min(1), pageid: z.number().int().positive(), revid: z.number().int().positive(), text: z.string().min(1) }) });
export interface PageOptions { edition?: string; language?: string; revision?: number; signal?: AbortSignal }
export interface PageData {
  title: string; edition: string; pageId: number; revision: number; language?: string;
  markdown: string; sections: MarkdownSection[];
  license?: { name: string; url: string };
  attribution: string; converter: 'wiktionary-markdown-v1';
}

export class WiktionaryClient {
  private readonly transport: JsonTransport;
  constructor(options: ClientOptions) { this.transport = new JsonTransport(options); }
  async getPage(title: string, options: PageOptions = {}): Promise<SourceRecord<PageData>> {
    const pageTitle = text(title, 'title'); const edition = editionCode(options.edition);
    const language = options.language === undefined ? undefined : text(options.language, 'language heading');
    if (options.revision !== undefined && (!Number.isSafeInteger(options.revision) || options.revision < 1)) throw new TypeError('Invalid revision');
    const origin = `https://${edition}.wiktionary.org`;
    const url = new URL('/w/api.php', origin);
    url.search = new URLSearchParams({ action: 'parse', prop: 'text|revid', format: 'json', formatversion: '2', maxlag: '5', ...(options.revision ? { oldid: String(options.revision) } : { page: pageTitle, redirects: '1' }) }).toString();
    const result = await this.transport.get(url, options.signal);
    const parsed = ParseSchema.safeParse(result.data);
    if (!parsed.success) throw new SourceError('invalid_response', 'Invalid Wiktionary page response');
    const page = parsed.data.parse;
    if (options.revision && page.revid !== options.revision) throw new SourceError('invalid_response', 'Source returned a different revision');
    const locator = new URL('/w/index.php', origin);
    locator.search = new URLSearchParams({ title: page.title, oldid: String(page.revid) }).toString();
    const rendered = renderPage(page.text, locator.href, language);
    const license = edition === 'en' ? { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } : undefined;
    const history = new URL('/w/index.php', origin);
    history.search = new URLSearchParams({ title: page.title, action: 'history' }).toString();
    const attribution = `Source: [Wiktionary contributors](<${locator.href}>), revision ${page.revid}; [contributor history](<${history.href}>).`;
    const prefix = `# ${page.title.replace(/[\r\n]/g, ' ')}\n\n${attribution}\n\n${license ? `Original entry text: [${license.name}](${license.url}). External quotations may have separate terms; review before redistribution.` : 'Text license: consult this edition’s copyright policy before redistribution.'} Markdown conversion; media omitted.\n\n`;
    const markdown = prefix + rendered.markdown;
    if (Buffer.byteLength(markdown) > MAX_MARKDOWN_BYTES) throw new SourceError('document_too_large', 'Markdown evidence exceeds 1 MiB');
    return {
      source: 'wiktionary', upstreamSource: 'Wiktionary contributors', locator: locator.href,
      retrievedAt: result.fetchedAt, revision: String(page.revid), cacheControl: result.cacheControl,
      data: { title: page.title, edition, pageId: page.pageid, revision: page.revid, language, markdown,
        sections: rendered.sections.map(section => ({ ...section, start: section.start + prefix.length, end: section.end + prefix.length })),
        license, attribution, converter: 'wiktionary-markdown-v1' },
    };
  }
}
