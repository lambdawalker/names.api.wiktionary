import { expect, it } from 'vitest';
import { renderPage } from '../src/markdown.js';
it('preserves nested descendants, tables and links while removing active/UI content', () => {
  const result = renderPage('<div class="mw-parser-output"><h2><span id="English" class="mw-headline">English</span><span class="mw-editsection">edit</span></h2><h3 id="Etymology_1">Etymology 1</h3><p>Hebrew <a href="/wiki/יוֹחָנָן">יוֹחָנָן</a></p><h3 id="Etymology_2">Etymology 2</h3><p><a href="javascript:bad()">bad link</a></p><div class="NavFrame" style="display:none"><ul><li>Latin<ul><li>Italian: Giovanni</li></ul></li></ul></div><table onclick="bad()"><tr><td>A</td><td>B</td></tr></table><script>evil()</script><style>bad{}</style><nav>navigation</nav><img src="bad"></div>', 'https://en.wiktionary.org/wiki/John', 'English');
  expect(result.markdown).toContain('Etymology 1'); expect(result.markdown).toContain('Etymology 2');
  expect(result.markdown).toContain('Italian: Giovanni'); expect(result.markdown).toContain('<td>A</td>');
  expect(result.markdown).toContain('https://en.wiktionary.org/wiki/');
  for (const unwanted of ['evil()', 'bad{}', 'javascript:', 'onclick', 'navigation', 'edit', '<img']) expect(result.markdown).not.toContain(unwanted);
  expect(result.sections.map(x => x.anchor)).toEqual(['English', 'Etymology_1', 'Etymology_2']);
  expect(result.markdown.slice(result.sections[1]!.start, result.sections[1]!.end)).not.toContain('Etymology 2');
});
it('keeps all languages unless explicitly scoped and respects NFC Unicode in headings', () => {
  const html = '<div class="mw-parser-output"><h2 id="Espanol">Español</h2><p>Juan 😀</p><h2 id="Italian">Italian</h2><p>Giovanni</p></div>';
  expect(renderPage(html, 'https://en.wiktionary.org/wiki/John').markdown).toContain('Giovanni');
  const scoped = renderPage(html, 'https://en.wiktionary.org/wiki/John', 'Español');
  expect(scoped.markdown).toContain('Juan 😀'); expect(scoped.markdown).not.toContain('Giovanni');
});
it('refuses empty evidence and bounds rendered Markdown by UTF-8 bytes', () => {
  expect(() => renderPage('<script>nothing</script>', 'https://en.wiktionary.org/wiki/John')).toThrow();
  expect(() => renderPage('<p>' + 'é'.repeat(524289) + '</p>', 'https://en.wiktionary.org/wiki/John')).toThrowError(expect.objectContaining({ code: 'document_too_large' }));
});
it('anchors sections to real headings rather than earlier mentions in prose', () => {
  const result = renderPage('<h2>English</h2><p>This mentions ### Etymology in prose.</p><h3>Etymology</h3><p>From Latin</p>', 'https://en.wiktionary.org/wiki/John');
  const section = result.sections.find(s => s.title === 'Etymology')!;
  expect(result.markdown.slice(section.start, section.end)).toBe('### Etymology\n\nFrom Latin\n');
  expect(section.start).toBe(result.markdown.indexOf('\n### Etymology\n') + 1);
});
it('preserves headings within HTML tables without treating them as Markdown section boundaries', () => {
  const result = renderPage('<h2>English</h2><table><tr><th><h3>Etymology</h3></th><td>Latin</td></tr></table><h3>Descendants</h3><p>Example</p>', 'https://en.wiktionary.org/wiki/John');
  expect(result.markdown).toContain('<h3>Etymology</h3>');
  expect(result.markdown).toContain('<td>Latin</td>');
  expect(result.sections.map(s => s.title)).toEqual(['English', 'Descendants']);
  expect(result.markdown.slice(result.sections[1]!.start)).toContain('### Descendants');
});
