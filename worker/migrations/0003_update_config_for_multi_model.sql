-- Update team config columns to support multi-model configuration
-- The existing red_config and blue_config columns store JSON that will now include:
-- {
--   spymaster: { type: 'human'|'ai', models: [{model, reasoningEffort?, customInstructions?}] },
--   guesser: { type: 'human'|'ai', models: [{model, reasoningEffort?, customInstructions?}] }
-- }
--
-- For backwards compatibility, the existing 'model' and 'reasoning' fields are kept
-- but the new 'models' array is the source of truth for multi-model configs.
--
-- No schema change needed - the existing TEXT columns can store the new JSON format.
-- This migration is a no-op but documents the schema evolution.

-- Add an index on winner for filtering by winning team
CREATE INDEX IF NOT EXISTS idx_game_history_winner ON game_history(winner);
