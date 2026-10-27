import { load } from 'cheerio';
import TurndownService from 'turndown';
import { SourceError } from './transport.js';

export interface MarkdownSection { title: string; anchor?: string; level: number; start: number; end: number }
export interface RenderedPage { markdown: string; sections: MarkdownSection[] }
export const MAX_MARKDOWN_BYTES = 1024 * 1024;

/** Deterministic derivative of rendered source; never an LLM summary. Offsets are UTF-16. */
export function renderPage(html: string, baseUrl: string, language?: string): RenderedPage {
  const $ = load(html);
  $('script,style,nav,form,iframe,object,embed,svg,img,audio,video,source,track,button,input,.mw-editsection,.toc,.catlinks,.interproject-box,.NavToggle').remove();
  let root = $('.mw-parser-output').first();
  if (!root.length) root = $('body');
  if (language !== undefined) {
    const selected: typeof root[] = []; let collecting = false; let found = false;
    root.children().each((_i, element) => {
      const child = $(element); const heading = child.is('h2') ? child : child.children('h2').first();
      if (heading.length) {
        collecting = heading.text().trim().normalize('NFC') === language.normalize('NFC');
        found ||= collecting;
      }
      if (collecting) selected.push(child);
    });
    if (!found) throw new SourceError('language_not_found', 'Requested language heading is absent from this page');
    const wrapper = $('<div></div>'); for (const child of selected) wrapper.append(child.clone()); root.html(wrapper.html() ?? '');
  }
  root.find('a').each((_i, element) => {
    const node = $(element); const href = node.attr('href');
    if (!href) return;
    try {
      const absolute = new URL(href, baseUrl);
      if (['http:', 'https:'].includes(absolute.protocol)) node.attr('href', absolute.href);
      else node.removeAttr('href');
    } catch { node.removeAttr('href'); }
  });
  // Retained table HTML must not carry active attributes or unsafe links.
  root.find('*').each((_i, element) => {
    const node = $(element);
    for (const attr of Object.keys(element.attribs)) {
      if (!['href', 'id', 'lang', 'colspan', 'rowspan'].includes(attr)) node.removeAttr(attr);
    }
  });
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  td.keep(['table']);
  // Unique markers attach positions to actual heading nodes. A heading-like
  // phrase in preceding prose must never become a source-fragment boundary.
  let markerPrefix = 'NAMESRESEARCHHEADING';
  while (root.text().includes(markerPrefix) || (root.html() ?? '').includes(markerPrefix)) markerPrefix += 'X';
  const headings = root.find('h1,h2,h3,h4,h5,h6').toArray()
    .filter(element => $(element).parents('table').length === 0)
    .map((element, index) => {
      $(element).attr('data-research-heading', String(index));
      return { title: $(element).text().trim(), anchor: $(element).attr('id') ?? $(element).find('[id]').first().attr('id'), level: Number(element.tagName.slice(1)) };
    });
  td.addRule('sourceHeading', {
    filter: node => /^H[1-6]$/.test(node.nodeName) && node.hasAttribute('data-research-heading'),
    replacement: (content, node) => {
      const element = node as HTMLElement;
      return `\n\n${markerPrefix}${element.getAttribute('data-research-heading')}END${'#'.repeat(Number(element.nodeName.slice(1)))} ${content}\n\n`;
    },
  });
  let markdown = td.turndown(root.html() ?? '').replace(/\r\n?/g, '\n').trim() + '\n';
  if (!markdown.trim()) throw new SourceError('invalid_response', 'Source contains no readable evidence');
  const sections: MarkdownSection[] = headings.map((heading, index) => {
    const marker = `${markerPrefix}${index}END`;
    const start = markdown.indexOf(marker);
    if (start < 0) throw new SourceError('invalid_response', 'Could not locate a converted source heading');
    markdown = markdown.slice(0, start) + markdown.slice(start + marker.length);
    return { title: heading.title, anchor: heading.anchor, level: heading.level, start, end: markdown.length };
  });
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new SourceError('document_too_large', 'Markdown evidence exceeds 1 MiB');
  sections.forEach((section, index) => {
    const next = sections.slice(index + 1).find(candidate => candidate.level <= section.level);
    section.end = next?.start ?? markdown.length;
  });
  return { markdown, sections };
}
