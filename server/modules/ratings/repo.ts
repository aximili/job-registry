// All SQL for the rating_cache table.

import { Rating } from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';

export function createRatingsRepo(db: Db) {
  const getStmt = db.prepare('SELECT rating_json FROM rating_cache WHERE ad_key = ? AND profile_hash = ?');
  const putStmt = db.prepare(
    `INSERT INTO rating_cache (ad_key, profile_hash, rating_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (ad_key, profile_hash) DO UPDATE SET rating_json = excluded.rating_json, created_at = excluded.created_at`,
  );
  return {
    get(adKey: string, profileHash: string): Rating | null {
      const row = getStmt.get(adKey, profileHash) as { rating_json: string } | undefined;
      if (!row) return null;
      // A row that no longer fits the schema counts as "not cached".
      const parsed = Rating.safeParse(JSON.parse(row.rating_json));
      return parsed.success ? parsed.data : null;
    },
    put(adKey: string, profileHash: string, rating: Rating, at: string): void {
      putStmt.run(adKey, profileHash, JSON.stringify(rating), at);
    },
  };
}

export type RatingsRepo = ReturnType<typeof createRatingsRepo>;
