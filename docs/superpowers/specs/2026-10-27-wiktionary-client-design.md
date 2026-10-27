# Wiktionary source client

The approved next step is a reusable TypeScript source client that supplies citable evidence to names.research.store. It must preserve language boundaries and source uncertainty without inventing historical graph edges.

## Approaches and decision

WiktAPI alone is convenient for structured lookups but its actual John response omits etymology, word language and part of speech inside entry objects, despite stronger wording in its OpenAPI documentation. Direct Kaikki bulk ingestion preserves more fields but requires maintaining a dump. Use the official MediaWiki Action API as the primary etymology document source; offer a separate WiktAPI structured client for lookup/search. This is an implementation choice within the requested adapter scope, not a new graph architecture.

## Interface and boundaries

- Node >=24, ESM TypeScript, native fetch with injectable transport/clock. No LLM, vault, database drivers, or implicit storage writes.
- WiktionaryClient.getPage(title, { edition?, language?, revision?, signal? }) returns a SourceRecord with page identity/revision, deterministic Markdown, optional selected language heading and section offsets. Edition defaults to en; language means an exact displayed level-two heading, not an ISO language code. No guessed translation of headings. Fetch the whole page once; select the language locally. Missing language fails explicitly.
- WiktApiClient.getWord(word, { edition?, languageCode?, signal? }) and search(prefix, options) preserve validated raw objects and unknown fields. Missing identities remain absent. No assertion that the dump shares the live page revision or that WiktAPI supplies etymology.
- toDocumentInput(page) produces a structural store_document payload, format markdown, retention allowed for the verified English edition text policy and metadata_only for other editions. It includes immutable source ID derived from edition, revision, selected heading, retrieval timestamp and content hash; retrieved_at and complete source metadata travel with the payload. Retries reuse the original payload; a later retrieval is a separate observation, while Markdown body hashes still deduplicate. No graph claim is implied.
- Primary English edition original text license: CC BY-SA 4.0 with copyright policy link and contributor/history attribution. All editions set public reuse unknown because external quotations may have separate rights. English local research retention is allowed; other editions use metadata-only retention until verified. No media downloaded, images removed. Markdown conversion is a derivative, not exact source reproduction.

## Evidence preservation

Keep headings, readable source text, links, list nesting (including descendants), tables as HTML where Markdown would lose cells, and source references. Resolve relative links against the edition origin. Remove scripts/styles/forms/edit controls/navigation and media. Drop unsafe URI schemes. Never hide etymology/descendants or generic collapsed div content. Stable deterministic conversion, no LLM rewriting. Section offsets use UTF-16 units, matching storage fragments. Offsets describe the resulting Markdown, not the HTML. Research content is untrusted model input.

## Transport

Require an informative caller User-Agent. Serial requests per client with 1 second default interval. Timeout 15 seconds per attempt including body reads; caller cancellation. Bound decoded JSON response to 8 MiB and Markdown document to 1 MiB. Default two retries for 429/502/503/504 and MediaWiki maxlag/ratelimited; honor Retry-After (seconds or date), refuse automatic waits over 60 seconds and expose retryAfterMs. Other failures never silently become empty results. Typed errors, no response-body logging. No background/global cache; cache directives exposed to caller. HTTPS except loopback test/self-host endpoints. Disable redirects.

## Deliverables and checks

Library, CLI (page to .md/stdout or JSON store payload), offline unit/HTTP tests, opt-in live smoke and CI. A local integration test submits an actual generated payload to the existing store implementation. John pilot tests etymology, precise revision, language scoping and attribution, without claiming a complete family tree. No source keys are needed for these public reads; encrypted vault work remains in the orchestrator.

## Verified provider references

- https://wiktapi.dev/quickstart
- https://wiktapi.dev/concepts/data-pipeline
- https://api.wiktapi.dev/_openapi.json
- https://www.mediawiki.org/wiki/API:Parsing_wikitext
- https://www.mediawiki.org/wiki/API:Etiquette
- https://en.wiktionary.org/wiki/Wiktionary:Copyrights

Live inspection on 2026-10-27: WiktAPI John/en returned two entries without etymology_text/word/lang/pos; official action=parse returned title John, pageid 135785, revid 93876683, and rendered etymology HTML.
