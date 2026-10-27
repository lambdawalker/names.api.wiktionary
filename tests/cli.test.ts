import { expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
function harness() {
  const output: string[] = [], errors: string[] = [];
  const write = vi.fn(async (_path: string, _body: string) => {});
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ parse: { title: 'John', pageid: 1, revid: 12, text: '<h2 id="English">English</h2><h3 id="Etymology">Etymology</h3><p>From Hebrew.</p>' } })));
  return { output, errors, write, fetch, io: { stdout: (s: string) => { output.push(s); }, stderr: (s: string) => { errors.push(s); }, writeFile: write, fetch, env: { WIKTIONARY_USER_AGENT: 'NamesTest/1 (https://example.org/contact)' } } };
}
it('prints Markdown or a store payload and supports output files', async () => {
  const h = harness();
  expect(await runCli(['page', 'John', '--language', 'English'], h.io)).toBe(0);
  expect(h.output.join('')).toContain('From Hebrew.');
  h.output.length = 0;
  expect(await runCli(['page', 'John', '--json', '--output', 'John.json'], h.io)).toBe(0);
  expect(h.output).toEqual([]);
  expect(h.write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(h.write.mock.calls[0]![1])).toMatchObject({ format: 'markdown', source: { revision: '12' } });
});
it('validates arguments and requires identification before any network request', async () => {
  for (const args of [[], ['bad', 'John'], ['page', 'John', '--revision', 'abc'], ['page', 'John', '--surprise'], ['page', 'John', 'extra'], ['search', 'John', '--language', 'English']]) {
    const h = harness(); expect(await runCli(args, h.io)).toBe(1); expect(h.fetch).not.toHaveBeenCalled(); expect(h.errors.length).toBe(1);
  }
  const h = harness();
  expect(await runCli(['page', 'John'], { ...h.io, env: {} })).toBe(1);
  expect(h.errors.join('')).toContain('WIKTIONARY_USER_AGENT'); expect(h.fetch).not.toHaveBeenCalled();
});
it('prints help without credentials and reports source failures without raw body leaks', async () => {
  const h = harness(); expect(await runCli(['--help'], { ...h.io, env: {} })).toBe(0);
  expect(h.output.join('')).toContain('page TITLE');
  expect(await runCli(['page', 'John'], { ...h.io, fetch: async () => new Response('secret upstream detail', { status: 403 }) })).toBe(1);
  expect(h.errors.join('')).toContain('HTTP 403'); expect(h.errors.join('')).not.toContain('secret');
});
