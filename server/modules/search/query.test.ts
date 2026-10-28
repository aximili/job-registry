import { describe, expect, it } from 'vitest';
import { openDb } from '../../core/db/db.ts';
import { buildFtsQuery } from './query.ts';

describe('buildFtsQuery', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO search_index (kind, ref_id, title, people, notes, ad) VALUES ('job', 1, 'AT&T C++ node.js', '', '', '')").run();

  it.each(['C++', 'AT&T', 'node.js', '"senior', '-', '(', '*', '   ', 'NEAR(', 'a OR b', 'title:x', '^start'])(
    'never produces invalid FTS syntax: %s',
    (q) => {
      const fts = buildFtsQuery(q);
      if (fts !== null) {
        expect(() => db.prepare('SELECT * FROM search_index WHERE search_index MATCH ?').all(fts)).not.toThrow();
      }
    },
  );

  it('turns words into prefix searches that must all match', () => {
    expect(buildFtsQuery('Senior  Eng')).toBe('"senior"* "eng"*');
    expect(buildFtsQuery('AT&T')).toBe('"at"* "t"*');
    expect(buildFtsQuery('---')).toBeNull();
  });

  it('finds AT&T, C++ and node.js by their letters', () => {
    for (const q of ['AT&T', 'C++', 'node.js']) {
      expect(db.prepare('SELECT ref_id FROM search_index WHERE search_index MATCH ?').all(buildFtsQuery(q))).toHaveLength(1);
    }
  });
});
