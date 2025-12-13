-- Game history table for completed games
CREATE TABLE IF NOT EXISTS game_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,

  -- Winner and final scores
  winner TEXT NOT NULL, -- 'red' or 'blue'
  red_final_score INTEGER NOT NULL, -- cards remaining (0 = won)
  blue_final_score INTEGER NOT NULL,

  -- Game settings
  assassin_behavior TEXT NOT NULL DEFAULT 'instant_loss',

  -- Team configurations (JSON)
  red_config TEXT NOT NULL, -- JSON: {spymaster: {type, model, reasoning}, guesser: {type, model, reasoning}}
  blue_config TEXT NOT NULL,

  -- Player names (JSON arrays)
  red_players TEXT NOT NULL, -- JSON array of player names
  blue_players TEXT NOT NULL,

  -- Game stats
  total_turns INTEGER NOT NULL,
  red_turns INTEGER NOT NULL,
  blue_turns INTEGER NOT NULL,

  -- Clue stats (JSON)
  red_clue_stats TEXT NOT NULL, -- JSON: {count, avgNumber, stdNumber, clues: [{word, number}]}
  blue_clue_stats TEXT NOT NULL,

  -- How game ended
  end_reason TEXT NOT NULL, -- 'all_found', 'assassin', 'opponent_found_all'

  -- Timestamps
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,

  -- Full clue history for reference (JSON)
  clue_history TEXT NOT NULL,

  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Index for querying recent games
CREATE INDEX IF NOT EXISTS idx_game_history_finished_at ON game_history(finished_at DESC);
