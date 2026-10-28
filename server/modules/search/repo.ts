// All SQL for the search_index full-text table.
// rowid = ref_id * 2 for jobs and ref_id * 2 + 1 for contacts, so one entry
// can be replaced quickly.

import type { Db } from '../../core/db/db.ts';

export type IndexKind = 'job' | 'contact';
export type IndexDoc = { title: string; people: string; notes: string; ad: string };
export type IndexMatch = { kind: IndexKind; refId: number; rank: number };

const START = '\u0001';
const END = '\u0002';
const rowid = (kind: IndexKind, refId: number): number => refId * 2 + (kind === 'contact' ? 1 : 0);

export function createSearchRepo(db: Db) {
  const remove = db.prepare('DELETE FROM search_index WHERE rowid = ?');
  const insert = db.prepare(
    'INSERT INTO search_index (rowid, kind, ref_id, title, people, notes, ad) VALUES (@rowid, @kind, @refId, @title, @people, @notes, @ad)',
  );
  // Weights: kind and ref_id 0, title 10, people 5, notes 2, ad 1.
  const matches = db.prepare(`
    SELECT kind, ref_id AS refId, bm25(search_index, 0, 0, 10, 5, 2, 1) AS rank
    FROM search_index WHERE search_index MATCH @query ORDER BY rank LIMIT @limit`);
  // Snippets come from people, notes or ad: the title is already on screen.
  const snippets = db.prepare(`
    SELECT rowid AS id,
      snippet(search_index, 3, @start, @end, '…', 10) AS s_people,
      snippet(search_index, 4, @start, @end, '…', 10) AS s_notes,
      snippet(search_index, 5, @start, @end, '…', 10) AS s_ad
    FROM search_index
    WHERE search_index MATCH @query AND rowid IN (SELECT value FROM json_each(@ids))`);

  return {
    upsert(kind: IndexKind, refId: number, doc: IndexDoc): void {
      db.transaction(() => {
        remove.run(rowid(kind, refId));
        insert.run({ rowid: rowid(kind, refId), kind, refId, ...doc });
      })();
    },

    remove(kind: IndexKind, refId: number): void {
      remove.run(rowid(kind, refId));
    },

    clear(): void {
      db.exec('DELETE FROM search_index');
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    // Every match with its rank, but no snippets: cheap, so nothing is cut off
    // before the "open jobs first" sort.
    matches(fts: string, limit: number): IndexMatch[] {
      return matches.all({ query: fts, limit }) as IndexMatch[];
    },

    // Snippets for just the results that will be shown.
    snippets(fts: string, items: { kind: IndexKind; refId: number }[]): Map<string, string | null> {
      const rows = snippets.all({
        query: fts,
        start: START,
        end: END,
        ids: JSON.stringify(items.map((i) => rowid(i.kind, i.refId))),
      }) as { id: number; s_people: string | null; s_notes: string | null; s_ad: string | null }[];
      const result = new Map<string, string | null>();
      for (const row of rows) {
        const kind: IndexKind = row.id % 2 === 1 ? 'contact' : 'job';
        const refId = Math.floor(row.id / 2);
        result.set(`${kind}:${refId}`, [row.s_people, row.s_notes, row.s_ad].find((s) => s?.includes(START)) ?? null);
      }
      return result;
    },
  };
}

export type SearchRepo = ReturnType<typeof createSearchRepo>;
