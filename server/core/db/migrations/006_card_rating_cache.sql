-- Quick ratings of job cards in a search list, cached per card and per
-- version of your profile, so the same card isn't rated twice. card_key is
-- the card's canonical link, "#", and 16 hex of a SHA-256 of what the card
-- shows (title, company, location and text). Owned by the ratings module.
CREATE TABLE card_rating_cache (
  card_key TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  rating_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (card_key, profile_hash)
);
