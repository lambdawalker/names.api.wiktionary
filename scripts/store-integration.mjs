// Optional real SQLite + authenticated HTTP compatibility check; no Neo4j needed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WiktionaryClient, toDocumentInput } from '../dist/index.js';

assert(process.env.STORE_CHECKOUT, 'Set STORE_CHECKOUT to a built names.research.store checkout');
const { Store, createApi } = await import(pathToFileURL(resolve(process.env.STORE_CHECKOUT, 'dist/index.js')).href);
const html = '<div class="mw-parser-output"><h2 id="English">English</h2><h3 id="Etymology">Etymology</h3><p>Synthetic test passage with Unicode: יוֹחָנָן 😀.</p><h3 id="Descendants">Descendants</h3><ul><li>Example A<ul><li>Example B</li></ul></li></ul></div>';
const body = process.env.WIKTIONARY_PARSE_FIXTURE ? await readFile(process.env.WIKTIONARY_PARSE_FIXTURE, 'utf8') : JSON.stringify({ parse: { title: 'John', pageid: 1, revid: 1, text: html } });
const page = await new WiktionaryClient({ userAgent: 'NamesStoreCompatibility/0.1 (https://github.com/lambdawalker/names.api.wiktionary)', fetch: async () => new Response(body) }).getPage('John', { language: 'English' });
const directory = await mkdtemp(join(tmpdir(), 'names-wiktionary-store-'));
let store = new Store(directory);
const token = randomBytes(32).toString('hex');
const api = createApi(store, token);
try {
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${api.address().port}`;
  const call = async (operation, input) => {
    const response = await fetch(`${origin}/v1/operations/${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const input = toDocumentInput(page);
  const first = await call('store_document', input);
  const duplicate = await call('store_document', input);
  assert.equal(first.document_id, duplicate.document_id);
  // New retrieval metadata must remain admissible and share the same .md body.
  const observation = toDocumentInput({ ...page, retrievedAt: new Date(Date.parse(page.retrievedAt) + 1000).toISOString() });
  const second = await call('store_document', observation);
  assert.notEqual(first.document_id, second.document_id);
  assert.equal((await readdir(join(directory, 'documents'))).length, 1);
  const section = page.data.sections.find(s => s.title.startsWith('Etymology'));
  assert(section);
  const end = Math.min(section.end, section.start + 15000);
  const fragment = await call('create_fragment', { document_id: first.document_id, start: section.start, end });
  assert.equal(fragment.text, page.data.markdown.slice(section.start, end));
  const receipt = await call('record_finding', { idempotency_key: 'wiktionary-integration', evidence: [{ id: 'example-evidence', source_id: input.source.id, locator: page.locator, document_id: first.document_id, fragment_id: fragment.fragment_id, supporting_text: fragment.text }] });
  assert.equal(receipt.projection, 'pending');
  await new Promise((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  store.close(); store = new Store(directory);
  assert.equal(store.getFragment(fragment.fragment_id).text, fragment.text);
  console.log(JSON.stringify({ compatible: true, revision: page.revision, markdownBytes: Buffer.byteLength(page.data.markdown), deduplicatedBodies: 1, fragmentSurvivedRestart: true }));
} finally {
  if (api.listening) await new Promise(resolve => api.close(resolve));
  store.close(); await rm(directory, { recursive: true, force: true });
}
