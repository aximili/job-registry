-- Match ratings, cached per ad and per version of your profile, so the same
-- ad isn't rated twice. ad_key is the ad's canonical link, or "text:" plus a
-- SHA-256 of the ad text for a pasted ad. Owned by the ratings module.
CREATE TABLE rating_cache (
  ad_key TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  rating_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ad_key, profile_hash)
);
