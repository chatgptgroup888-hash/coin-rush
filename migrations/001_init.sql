-- Players
CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  rating        INT         NOT NULL DEFAULT 1000,
  games_played  INT         NOT NULL DEFAULT 0,
  wins          INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Finished matches
CREATE TABLE IF NOT EXISTS matches (
  id         UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL,
  winner_id  UUID REFERENCES players(id)
);

-- Per-player result of each match
CREATE TABLE IF NOT EXISTS match_players (
  match_id      UUID REFERENCES matches(id) ON DELETE CASCADE,
  player_id     UUID REFERENCES players(id),
  score         INT NOT NULL,
  rating_before INT NOT NULL,
  rating_after  INT NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_ended_at ON matches(ended_at DESC);
