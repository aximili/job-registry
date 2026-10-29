// All SQL for the rating_cache and card_rating_cache tables.

import type { z } from 'zod';
import { CardRating, Rating } from '../../../shared/contracts/index.ts';
import type { Db } from '../../core/db/db.ts';

// A row that no longer fits the schema counts as "not cached".
function fromJson<S extends z.ZodType>(schema: S, json: string): z.infer<S> | null {
  const parsed = schema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

export function createRatingsRepo(db: Db) {
  const getStmt = db.prepare('SELECT rating_json FROM rating_cache WHERE ad_key = ? AND profile_hash = ?');
  const putStmt = db.prepare(
    `INSERT INTO rating_cache (ad_key, profile_hash, rating_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (ad_key, profile_hash) DO UPDATE SET rating_json = excluded.rating_json, created_at = excluded.created_at`,
  );
  // Every full rating of one link: its ad_key starts with exactly "<link>#".
  // Not LIKE, because a link can hold % and _.
  const fullStmt = db.prepare(
    `SELECT rating_json FROM rating_cache
     WHERE profile_hash = ? AND substr(ad_key, 1, length(?)) = ?
     ORDER BY created_at DESC`,
  );
  const getCardStmt = db.prepare('SELECT rating_json FROM card_rating_cache WHERE card_key = ? AND profile_hash = ?');
  const putCardStmt = db.prepare(
    `INSERT INTO card_rating_cache (card_key, profile_hash, rating_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (card_key, profile_hash) DO UPDATE SET rating_json = excluded.rating_json, created_at = excluded.created_at`,
  );
  return {
    get(adKey: string, profileHash: string): Rating | null {
      const row = getStmt.get(adKey, profileHash) as { rating_json: string } | undefined;
      return row ? fromJson(Rating, row.rating_json) : null;
    },
    put(adKey: string, profileHash: string, rating: Rating, at: string): void {
      putStmt.run(adKey, profileHash, JSON.stringify(rating), at);
    },
    // The newest full rating of a job you opened, for this version of your profile.
    latestFull(canonicalUrl: string, profileHash: string): Rating | null {
      const prefix = `${canonicalUrl}#`;
      for (const row of fullStmt.all(profileHash, prefix, prefix) as { rating_json: string }[]) {
        const rating = fromJson(Rating, row.rating_json);
        if (rating) return rating;
      }
      return null;
    },
    getCard(cardKey: string, profileHash: string): CardRating | null {
      const row = getCardStmt.get(cardKey, profileHash) as { rating_json: string } | undefined;
      return row ? fromJson(CardRating, row.rating_json) : null;
    },
    putCard(cardKey: string, profileHash: string, rating: CardRating, at: string): void {
      putCardStmt.run(cardKey, profileHash, JSON.stringify(rating), at);
    },
  };
}

export type RatingsRepo = ReturnType<typeof createRatingsRepo>;
