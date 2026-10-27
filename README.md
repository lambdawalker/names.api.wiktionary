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

The library clients maintain no implicit cache or raw archive. The optional MCP adapter caches up to eight page observations in memory for five minutes, as described below. Let the orchestrator cache scoped search results and let [names.research.store](https://github.com/lambdawalker/names.research.store) retain Markdown evidence. Do not expire a cited document when expiring search results. WiktAPI supports `baseUrl` for HTTPS self-hosting or loopback HTTP tests.

## Read-only MCP adapter

The exported `createWiktionaryMcpServer(options)` builds an official `@modelcontextprotocol/server` 2.4.0 server. The stdio entry exposes only `get_page` and `search`, with Zod input validation and read-only annotations. It has no HTTP listener, storage operations, or database credentials. An orchestrator can continue importing `WiktionaryClient` directly; MCP is available for other agent harnesses.

Build once, then start on Linux/Bash:

```sh
npm ci
npm run build
export WIKTIONARY_USER_AGENT='NamesResearch/0.1 (https://example.org/contact)'
npm run mcp --silent
# Or run Node directly, which avoids npm output on the protocol stream:
node /absolute/path/names.api.wiktionary/dist/mcp-stdio.js
```

On Windows PowerShell:

```powershell
npm ci
npm run build
$env:WIKTIONARY_USER_AGENT = 'NamesResearch/0.1 (https://example.org/contact)'
node C:\src\names.api.wiktionary\dist\mcp-stdio.js
```

After installing the package from a reviewed checkout, `names-wiktionary-mcp` is the equivalent bin. The process uses stdin/stdout exclusively for MCP; startup failures go to stderr. `npm run mcp` is useful locally, while a harness should invoke Node directly or the installed bin.

For an MCP harness that accepts `mcpServers` JSON, use absolute paths and replace the contact URL:

```json
{
  "mcpServers": {
    "wiktionary": {
      "command": "node",
      "args": ["/absolute/path/names.api.wiktionary/dist/mcp-stdio.js"],
      "env": {
        "WIKTIONARY_USER_AGENT": "NamesResearch/0.1 (https://example.org/contact)"
      }
    }
  }
}
```

On Windows the JSON argument can be `"C:\\src\\names.api.wiktionary\\dist\\mcp-stdio.js"` and `command` can be the absolute path to `node.exe` when Node is absent from the harness's PATH. The host controls where this JSON belongs; stdio requires a host that can launch local processes.

For Codex CLI's `config.toml`, the equivalent local stdio configuration is:

```toml
[mcp_servers.wiktionary]
command = "node"
args = ["/absolute/path/names.api.wiktionary/dist/mcp-stdio.js"]

[mcp_servers.wiktionary.env]
WIKTIONARY_USER_AGENT = "NamesResearch/0.1 (https://example.org/contact)"
```

Tool inputs and outputs:

| Tool | Input | Result |
| --- | --- | --- |
| `get_page` | `title`, `edition` (default `en`), optional exact `language` heading, optional positive integer `revision`, `offset` (default `0`), `limit` (default `4000`, maximum `8000`) | JSON text containing a bounded `markdown` slice, canonical `title`, `edition`, `page_id`, `revision`, `language`, `locator`, `retrieved_at`, attribution/license, `total_units`, `next_offset` (`null` at the end), and section descriptors. |
| `search` | `prefix`, `edition` (default `en`), optional `languageCode` | JSON text with at most 50 WiktAPI results, source/locator/retrieval metadata, explicit scope, `returned`, and `truncated`. Only `word`, `lang_code`, `lang`, and `pos` fields are projected. |

`get_page` offsets and section `start`/`end` positions use UTF-16 code units (`offset_unit: "utf16"`), matching the library's `.slice()` convention. Section descriptors cover the whole selected Markdown and are capped at 100; `sections_total` and `sections_truncated` disclose omissions. Section display titles are capped at 256 UTF-16 units, with `metadata_truncated: true` when shortened. Canonical page titles over 256 units are rejected instead of changing their identity; source locators and fragment anchors are never shortened. The complete serialized tool result (including metadata, UTF-8 bytes, and JSON escaping) is capped at 64 KiB. Oversized page metadata, aggregate results, or search records produce a safe `response_too_large` error; search word identities are never silently truncated. Offset past the end returns empty Markdown and `next_offset: null`. It never returns the entire page automatically; follow `next_offset` explicitly.

Each server instance keeps an LRU of at most eight pages for five minutes, keyed by requested title, edition, exact language heading and requested revision. Chunk reads reuse the original `retrieved_at`; cache reads refresh recency but do not extend expiry. Repeat the same selection and revision argument across chunks. For durable work, start with an explicit revision; changing from an omitted revision to an explicit one creates a separate cache entry. After eviction or expiry, compare `retrieved_at` and restart collection if it changed: rendered templates can change even at the same page revision. No page observations are written to disk.

Provider failures return `isError: true` and JSON `{ "error": { "code": "not_found", "message": "..." } }` with safe static messages. Other source codes match `SourceError`; unexpected exceptions use `internal_error`. Invalid arguments use the SDK's validation error result. Raw upstream/internal exception messages are never returned. MCP request cancellation is forwarded to the client `signal`.

To share transport instances or inject offline providers:

```ts
import { createWiktionaryMcpServer, WiktionaryClient, WiktApiClient } from '@lambdawalker/names-api-wiktionary';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const clientOptions = { userAgent: 'NamesResearch/0.1 (https://example.org/contact)' };
const server = createWiktionaryMcpServer({
  pageClient: new WiktionaryClient(clientOptions),
  searchClient: new WiktApiClient(clientOptions),
});
await server.connect(new StdioServerTransport());
```

`WiktionaryMcpOptions` accepts `pageClient?: Pick<WiktionaryClient, 'getPage'>`, `searchClient?: Pick<WiktApiClient, 'search'>`, `clientOptions?: ClientOptions` (required when either provider is absent), and `now?: () => number` (millisecond cache clock, default `performance.now`). Passing `{ clientOptions }` creates both providers. The factory returns `McpServer`, so an embedding host owns its transport and lifecycle. Search is not cached; it remains a separate provider snapshot from live page evidence.

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

## Managed local API and in-memory credentials

This project ships `config.default.yaml` (loopback port **4319**) and `npm run serve`. In managed mode, the orchestrator launches the service with a per-boot control credential, checks its boot identity and sends the provider credential to authenticated `POST /v1/credentials`. Keys are held in memory; none belong in YAML. `{"token":null}` clears the credential. Public providers do not need a provider token.

`GET /v1/tools` lists tool definitions; `POST /v1/tools/TOOL_NAME` invokes the existing validated MCP tool. Both require the per-boot control credential. `GET /health` returns non-secret identity/readiness information. `npm run mcp:remote` is a stdio bridge to the local API, using `NAMES_SERVICE_URL` and `NAMES_CONTROL_TOKEN` in the supervising host's memory. The original standalone `npm run mcp` remains available for compatibility.

Use the orchestrator vault/fleet setup to avoid managing plaintext provider-key files. The managed port registry overrides the standalone default port at launch. Credentials/caches are discarded on rotation or process exit; slow requests crossing credential rotation are refused. Browser origins are rejected and listeners bind only to IPv4 loopback. See [the orchestrator setup](https://github.com/lambdawalker/ds.names.orchestrator/blob/main/docs/local-services.md).
