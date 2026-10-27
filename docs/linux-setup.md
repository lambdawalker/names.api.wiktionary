# Linux setup

These instructions cover the Wiktionary source client on Ubuntu/Debian and Fedora, using Bash. The client runs on Linux with Node.js 24 or newer. It does not require a GPU, Docker, database, LLM, or API key for public Wiktionary/WiktAPI reads.

## 1. Install prerequisites

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

Fedora:

```bash
sudo dnf install -y git curl ca-certificates
```

If Node.js 24+ is already installed, skip to step 2. Otherwise, install it for your user with [nvm](https://github.com/nvm-sh/nvm#installing-and-updating). The following installer version is pinned; consult the official instructions when updating it.

```bash
curl -fsSLo /tmp/names-nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh
bash /tmp/names-nvm-install.sh
```

Open a new terminal so your shell loads nvm, then run:

```bash
nvm install 24
nvm use 24
node --version
npm --version
```

`node --version` should print `v24.x.x` (or use an already installed newer version). Do not run this project's npm commands with sudo. If `nvm` is not found, follow the profile-loading instructions in the official nvm README; Zsh users should reload their Zsh profile instead of Bash's.

## 2. Clone and build

```bash
git clone https://github.com/lambdawalker/names.api.wiktionary.git
cd names.api.wiktionary
npm ci
npm run build
node dist/cli.js --help
```

`npm ci` installs the locked dependencies and runs the build lifecycle. The explicit build command is also useful after editing the source. These steps use `main`; no feature-branch checkout is required.

## 3. Identify the caller and run a lookup

Set the User-Agent in the current shell. Replace the example with your application's name and a real contact URL:

```bash
export WIKTIONARY_USER_AGENT='NamesResearch/0.1 (https://github.com/lambdawalker/ds.source.names)'
mkdir -p output
npm run research -- page John --language English --output output/John.md
npm run research -- page Juan --language Spanish --json --output output/Juan.document.json
npm run research -- search Giov --edition en --lang it
```

The first command writes attributed Markdown. The second writes a JSON `store_document` payload for the storage service; it does not connect to a database. The last prints structured search results.

On English Wiktionary, `--language Spanish` selects the Spanish heading; `--edition es` instead selects the Spanish Wiktionary website, whose headings may differ. Search uses `--lang it` for the content language code.

Output files are created exclusively. Running the same command twice with the same output path fails instead of overwriting existing evidence; choose a new filename for another retrieval. To view the first result:

```bash
less output/John.md
```

The exported variable lasts for this shell session. To keep it for future Bash sessions, add the same `export WIKTIONARY_USER_AGENT=...` line to `~/.bashrc`, then open a new terminal. The CLI does not automatically load `.env` files.

## 4. Verify the installation

```bash
npm test
npm run typecheck
npm pack --dry-run
npm run smoke
```

The test suite is offline. The smoke command uses the exported User-Agent and makes live requests to Wiktionary and WiktAPI; it checks John's revision, etymology, descendants and structured entries. Network access and provider availability are required for that command.

## Optional: check the storage integration

The client itself needs no storage service. To exercise real SQLite storage and its HTTP API, first clone and build [names.research.store](https://github.com/lambdawalker/names.research.store) as a sibling directory. Starting in the client directory:

```bash
git clone https://github.com/lambdawalker/names.research.store.git ../names.research.store
npm ci --prefix ../names.research.store
npm run build --prefix ../names.research.store
STORE_CHECKOUT="$(realpath ../names.research.store)" npm run store:integration
```

This check creates a temporary SQLite store, starts an authenticated HTTP server on loopback with a temporary token, stores synthetic evidence, verifies deduplication and fragment retrieval after restart, and cleans up. It does not require Neo4j or an already running service. For a persistent database deployment, follow the storage repository's own setup instructions.

## Troubleshooting

| Symptom | Action |
|---|---|
| Unsupported Node version, or `node:sqlite` unavailable in the optional integration | Run `nvm use 24`, then `node --version` to confirm the active executable. |
| `Set WIKTIONARY_USER_AGENT` | Run the export command in the same terminal that launches the CLI. |
| `EEXIST` while writing output | Choose another output path; the existing file is preserved. |
| `language_not_found` | Use the exact displayed language heading for that edition, or omit `--language` to retain all sections. |
| HTTP 429 or `rate_limited` | Wait for the reported retry interval; reuse a client instance so concurrent jobs share its request pacing. |
| Network failures behind a proxy | Configure your normal `HTTPS_PROXY`/`HTTP_PROXY` variables; on Node 24, launch with `NODE_USE_ENV_PROXY=1 npm run smoke` to enable environment proxy support. |

For detailed data contracts, limits and licensing behavior, see the [README](../README.md).
