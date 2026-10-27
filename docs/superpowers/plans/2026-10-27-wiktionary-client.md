# Wiktionary Client Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** Fetch revision-aware Wiktionary Markdown evidence and complementary structured WiktAPI lookups.

**Architecture:** Native fetch transport shared by two independent clients. Deterministic evidence renderer and structural store payload adapter; no database or agent dependency.

**Tech Stack:** Node >=24, TypeScript, Zod, Cheerio, Turndown, Vitest.

**Spec:** ../specs/2026-10-27-wiktionary-client-design.md

## Global Constraints

- Node >=24, ESM; no LLM, vault or database drivers.
- Source title spelling/case preserved, NFC normalization only; edition and content language distinct.
- 15-second attempt timeout, max 8 MiB decoded JSON, max 1 MiB Markdown; two retries; max automatic retry wait 60 seconds.
- Immutable revision-aware evidence, no invented origin, adaptation, borrowing, or license claim.

## Review Focus

- Malformed/partial responses fail explicitly rather than masquerading as missing names.
- Caller aborts and timeouts during streamed body reads terminate the whole attempt.
- Rate limiting and Retry-After cannot trigger tight loops or unbounded waits.
- HTML cleanup preserves evidence links, nested descendants and multiple etymologies.
- Same spelling in two language sections cannot silently mix; offsets identify exact converted passages.

### Task 1: Transport and structured client

**Files:** src/types.ts, src/transport.ts, src/wiktapi.ts, tests/transport.test.ts, tests/wiktapi.test.ts.
**Interfaces:** SourceRecord<T>, ClientOptions; JsonTransport.get(url, signal?) returns data, fetchedAt, cacheControl; WiktApiClient.getWord/search return SourceRecord with raw structured data.

- [x] Write tests for URL encoding, edition/language distinction, actual sparse entry response, preservation of optional fields, bad schema, 404, retry/Retry-After, abort/body limits and timeout.
- [x] Run npm test; verify missing implementation failures.
- [x] Implement bounded serial transport and structured client; run tests and typecheck; commit.

### Task 2: Revision-aware Markdown evidence

**Files:** src/markdown.ts, src/wiktionary.ts, src/evidence.ts, src/index.ts, tests/evidence.test.ts, tests/wiktionary.test.ts.
**Interfaces:** WiktionaryClient.getPage; renderPage(html, baseUrl, language?) returns markdown+sections; toDocumentInput(SourceRecord<PageData>) returns store document input.

- [x] Write tests covering revision parameters and API error envelopes, Unicode, exact language selection, modern/legacy h2 wrappers, nested lists/tables, link safety, source identity and content bounds.
- [x] Run tests and watch them fail before implementing.
- [x] Implement rendering and page client with immutable provenance; verify tests/typecheck; commit.

### Task 3: CLI and integration

**Files:** src/cli.ts, tests/cli.test.ts, scripts/smoke.mjs, README.md, .github/workflows/ci.yml.
**Interfaces:** CLI page TITLE --edition en --language English [--revision ID] [--json] [--output FILE]; search PREFIX --edition en --lang en. User-Agent via WIKTIONARY_USER_AGENT required.

- [x] Test CLI parsing/output/error behavior offline; run RED before implementation.
- [x] Implement CLI and documented setup; build/test/typecheck/npm pack --dry-run.
- [x] Run live John smoke sequentially; submit generated payload to local real storage implementation; record results, no new claims.
- [x] Review complete branch, fix important findings with regression tests, publish feature PR and check CI.
