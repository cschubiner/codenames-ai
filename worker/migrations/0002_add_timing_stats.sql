-- Add timing statistics columns
ALTER TABLE game_history ADD COLUMN timing_stats TEXT NOT NULL DEFAULT '{}';
-- JSON: {red: {spymasterMs, guesserMs}, blue: {spymasterMs, guesserMs}}
