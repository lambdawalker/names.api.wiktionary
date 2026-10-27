#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WiktionaryClient } from './wiktionary.js';
import { WiktApiClient } from './wiktapi.js';
import { toDocumentInput } from './evidence.js';
import { SourceError } from './transport.js';

const HELP = `Usage:
  names-wiktionary page TITLE [--edition en] [--language English] [--revision ID] [--json] [--output FILE]
  names-wiktionary search PREFIX [--edition en] [--lang en] [--output FILE]
  names-wiktionary --help

Set WIKTIONARY_USER_AGENT to an informative application/contact string.
Page output is Markdown; --json emits a store_document input (no database writes).
--language selects an exact displayed heading; --lang is a WiktAPI language code.
Output files are created exclusively; existing files are never overwritten.
`;
interface CliIO {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: Record<string, string | undefined>;
  writeFile?: (path: string, body: string) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}
export async function runCli(args: string[], io: CliIO = {}): Promise<number> {
  const stdout = io.stdout ?? (text => { process.stdout.write(text); });
  const stderr = io.stderr ?? (text => { process.stderr.write(text); });
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      edition: { type: 'string' }, language: { type: 'string' }, lang: { type: 'string' }, revision: { type: 'string' },
      json: { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) { stdout(HELP); return 0; }
    const [command, title] = positionals;
    if (positionals.length !== 2 || !['page', 'search'].includes(command ?? '') || !title) throw new TypeError('Expected page TITLE or search PREFIX; use --help');
    if (command === 'page' && values.lang !== undefined) throw new TypeError('Use --language for the exact Wiktionary language heading');
    if (command === 'search' && (values.language !== undefined || values.revision !== undefined || values.json)) throw new TypeError('Search accepts --lang; --language, --revision, and --json are page-only');
    if (values.revision !== undefined && (!/^\d+$/.test(values.revision) || !Number.isSafeInteger(Number(values.revision)) || Number(values.revision) < 1)) throw new TypeError('Revision must be a positive integer');
    const userAgent = (io.env ?? process.env).WIKTIONARY_USER_AGENT;
    if (!userAgent?.trim()) throw new TypeError('Set WIKTIONARY_USER_AGENT, for example NamesResearch/0.1 (https://github.com/YOUR_ACCOUNT/YOUR_REPO)');
    const options = { userAgent, ...(io.fetch ? { fetch: io.fetch } : {}) };
    let output: string;
    if (command === 'page') {
      const page = await new WiktionaryClient(options).getPage(title, { edition: values.edition, language: values.language, revision: values.revision ? Number(values.revision) : undefined, signal: io.signal });
      output = values.json ? JSON.stringify(toDocumentInput(page), null, 2) + '\n' : page.data.markdown;
    } else {
      output = JSON.stringify(await new WiktApiClient(options).search(title, { edition: values.edition, languageCode: values.lang, signal: io.signal }), null, 2) + '\n';
    }
    if (values.output) await (io.writeFile ?? ((path, body) => writeFile(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })))(values.output, output);
    else stdout(output);
    return 0;
  } catch (error) {
    const message = error instanceof SourceError ? `${error.code}: ${error.message}${error.retryAfterMs !== undefined ? ` (retry after ${error.retryAfterMs} ms)` : ''}` : error instanceof Error ? error.message : 'Command failed';
    stderr(`ERROR: ${message}\n`); return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
}
