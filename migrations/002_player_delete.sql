-- ให้ลบผู้เล่นได้ (DELETE /api/players/me)
-- ผลแข่งของผู้เล่นที่ถูกลบหายไปด้วย (CASCADE) ส่วนแมตช์ที่เขาชนะ winner_id กลายเป็น NULL
ALTER TABLE match_players DROP CONSTRAINT IF EXISTS match_players_player_id_fkey;
ALTER TABLE match_players
  ADD CONSTRAINT match_players_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_winner_id_fkey;
ALTER TABLE matches
  ADD CONSTRAINT matches_winner_id_fkey
  FOREIGN KEY (winner_id) REFERENCES players(id) ON DELETE SET NULL;
