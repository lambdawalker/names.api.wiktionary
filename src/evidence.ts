import { createHash } from 'node:crypto';
import type { PageData } from './wiktionary.js';
import type { SourceRecord } from './types.js';

/** Structural store_document input, requiring no dependency on the storage implementation. */
export function toDocumentInput(record: SourceRecord<PageData>) {
  const hash = createHash('sha256').update(JSON.stringify([
    record.locator, record.retrievedAt, record.data.edition, record.data.revision,
    record.data.language ?? null, record.data.converter, record.data.markdown,
  ])).digest('hex');
  return {
    source: {
      id: `wiktionary:${hash}`, provider: 'wiktionary', upstream_source: 'Wiktionary contributors',
      url: record.locator, retrieved_at: record.retrievedAt, revision: record.revision,
      ...(record.data.license ? { license: record.data.license } : {}),
      // General edition terms do not clear every retained external quotation.
      public_reuse: 'unknown' as const,
    },
    locator: record.locator, content: record.data.markdown, format: 'markdown' as const,
    retention: record.data.license ? 'allowed' as const : 'metadata_only' as const,
  };
}
