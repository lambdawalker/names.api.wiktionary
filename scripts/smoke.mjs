import assert from 'node:assert/strict';
import { WiktionaryClient, WiktApiClient, toDocumentInput } from '../dist/index.js';

const userAgent = process.env.WIKTIONARY_USER_AGENT;
assert(userAgent, 'Set WIKTIONARY_USER_AGENT before the live smoke');
const page = await new WiktionaryClient({ userAgent }).getPage('John', { language: 'English' });
const etymology = page.data.sections.find(section => section.title.startsWith('Etymology'));
assert(etymology, 'John must have an etymology section');
assert.match(page.data.markdown.slice(etymology.start, etymology.end), /Hebrew/);
assert(page.data.sections.some(section => section.title === 'Descendants'));
assert(page.revision);
assert.equal(toDocumentInput(page).format, 'markdown');
const word = await new WiktApiClient({ userAgent }).getWord('John', { languageCode: 'en' });
assert(word.data.entries.length > 0);
console.log(JSON.stringify({ title: page.data.title, revision: page.revision, markdownBytes: Buffer.byteLength(page.data.markdown), sections: page.data.sections.length, structuredEntries: word.data.entries.length, hasEtymology: true }));
