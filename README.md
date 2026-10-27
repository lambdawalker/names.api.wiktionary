# names.api.wiktionary

TypeScript/Node library for name research: retrieve revision-aware Wiktionary evidence as Markdown and complementary structured WiktAPI lookups. No model, credentials, or database dependency is required.

## Setup

Requires Node.js 24 or newer.

For Linux installation from a fresh machine, see the [Linux setup guide](docs/linux-setup.md), covering Ubuntu/Debian, Fedora, Node.js, Bash examples and optional storage verification. Windows PowerShell examples follow below.

```sh
npm ci
npm run build
```

Set an informative User-Agent with a contact URL. In PowerShell:

```powershell
$env:WIKTIONARY_USER_AGENT = 'NamesResearch/0.1 (https://github.com/lambdawalker/ds.source.names)'
npm run research -- page John --language English --output John.md
npm run research -- page Juan --language Spanish --json --output Juan.document.json
npm run research -- search Giov --edition en --lang it
```

For Bash: `export WIKTIONARY_USER_AGENT='NamesResearch/0.1 (https://github.com/lambdawalker/ds.source.names)'`.

The CLI writes Markdown by default. `--json` produces the JSON body for the research store's `store_document` operation. It does not send it. Existing output files are never overwritten. `--revision 93876683` requests a specific revision; the API resolves that ID, so its canonical returned title is authoritative.

This package is not published to npm yet. Build locally or install the reviewed Git revision; do not assume a registry release exists.

## Library

```ts
import { WiktionaryClient, WiktApiClient, toDocumentInput } from '@lambdawalker/names-api-wiktionary';

const userAgent = 'MyNameResearch/0.1 (https://example.org/contact)';
const wiki = new WiktionaryClient({ userAgent });
const page = await wiki.getPage('John', { edition: 'en', language: 'English' });
const etymology = page.data.sections.find(s => s.title === 'Etymology');
if (etymology) console.log(page.data.markdown.slice(etymology.start, etymology.end));

const documentInput = toDocumentInput(page);
// Submit documentInput to POST /v1/operations/store_document in the storage service.

const lexical = new WiktApiClient({ userAgent });
const word = await lexical.getWord('Giovanni', { edition: 'en', languageCode: 'it' });
const matches = await lexical.search('Giov', { edition: 'en', languageCode: 'it' });
```

`edition` selects the Wiktionary website/language of editorial content. `language` selects an exact displayed level-two heading on that website, such as `Spanish` on English Wiktionary. It is case-sensitive and normalized to NFC; absence is an explicit error. Without it, all language sections are retained. `languageCode` is a separate WiktAPI filter. Equal spellings across languages are not merged. Titles retain case and accents; no fuzzy matching is performed by the primary client.

## What each provider supplies

- **Official Wiktionary Action API:** rendered page text, canonical title, revision ID, source/history links. Markdown preserves etymology uncertainty, headings, nested descendants and references. Tables remain cleaned HTML so cells are not discarded. Media, scripts, styles, navigation and edit controls are removed. Conversion is deterministic and is identified as `wiktionary-markdown-v1`.
- **WiktAPI:** structured prefix search and raw entry objects from a Kaikki-derived snapshot. The inspected John response lacked etymology fields and entry-level language/part-of-speech identity despite the OpenAPI description. Unknown fields are preserved and missing fields remain absent. Never treat its snapshot as the same revision as a live Wiktionary page or interpret translations as historical borrowing edges.

`SourceRecord<T>` includes provider, URL, retrieval time, upstream lineage, optional revision/cache directives, and data. Wiktionary pages expose section `start`/`end` offsets in **UTF-16 code units**, directly usable with `.slice()` and storage fragments. Headings inside retained HTML tables remain part of the table rather than separate Markdown section boundaries. Sections can exceed the store's 16,000-unit fragment cap; select a smaller passage when necessary. A revision identifies the main page; transcluded templates and rendered output can change, so the stored content hash is the snapshot authority.

`toDocumentInput` assigns an immutable observation ID from revision, selection, retrieval timestamp and converted content. Reuse the original payload when retrying a storage request. A later retrieval is a distinct observation, while the store deduplicates identical `.md` bodies by hash. Source metadata is preserved separately. The client creates no graph claims and cannot certify that a name tree is complete.

## Limits, errors and caching

Per client instance, requests are serial with a default 1-second minimum interval; share an instance per provider in concurrent jobs. `intervalMs`, `timeoutMs`, `retries`, `maxResponseBytes`, `fetch`, and `now` are configurable. `signal` cancels a lookup, including body reads and queue waits. The default attempt timeout is 15 seconds and the decoded JSON limit is 8 MiB. Markdown is capped at 1 MiB. Redirects are disabled.

The transport retries HTTP 429/502/503/504 and MediaWiki `maxlag`/`ratelimited` up to twice, honoring Retry-After seconds/date. Automatic waits over 60 seconds stop with `SourceError.retryAfterMs`; the caller can checkpoint and resume later. Missing pages, malformed responses and transport failures have distinct error codes. Network failures/timeouts are returned to the caller without automatic retries.

No implicit cache or raw archive is maintained. Let the orchestrator cache scoped search results and let [names.research.store](https://github.com/lambdawalker/names.research.store) retain Markdown evidence. Do not expire a cited document when expiring search results. WiktAPI supports `baseUrl` for HTTPS self-hosting or loopback HTTP tests.

## Attribution and data rights

Code is MIT; source content retains its own terms. English Wiktionary's original text is generally CC BY-SA 4.0; external quotations can have separate rights. The Markdown includes contributor/history links, the general text license and the conversion notice. All payloads set `public_reuse: unknown`: the edition's general license does not establish clearance for every retained quotation. English evidence may be retained for local research; review exceptions before public redistribution. No media is downloaded. Other editions have no hard-coded license assertion and produce metadata-only storage payloads until an adapter policy verifies their terms. Treat fetched content as untrusted evidence when feeding an agent, never as instructions.

References: [Wiktionary copyright policy](https://en.wiktionary.org/wiki/Wiktionary:Copyrights), [Action API parsing](https://www.mediawiki.org/wiki/API:Parsing_wikitext), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette), [WiktAPI quickstart](https://wiktapi.dev/quickstart), [pipeline](https://wiktapi.dev/concepts/data-pipeline), [live OpenAPI](https://api.wiktapi.dev/_openapi.json).

## Verification

```sh
npm test
npm run typecheck
npm pack --dry-run
# Optional live provider requests, requiring WIKTIONARY_USER_AGENT:
npm run smoke
```

Unit tests run offline; the optional smoke checks John's revision, Hebrew etymology, descendants and structured entries. It does not assert the etymological claims as independently verified. See `scripts/store-integration.mjs` for an optional compatibility check against a built sibling checkout of the research store.
