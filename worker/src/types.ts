export type Team = "RED" | "BLUE";
export type CardType = Team | "NEUTRAL" | "ASSASSIN";

export type PlayerRole = "GUESSER" | "SPYMASTER" | "CONTROLLER" | "SPECTATOR";

export interface SpymasterConfig {
  provider: "openai_responses";
  model: string;
  prompt_id: string;
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  candidates_per_turn: number;
  generation_mode: "k_calls" | "single_call_array";
}

export interface GuesserConfig {
  provider: "openai_responses";
  model: string;
  prompt_id: string;
  temperature: number;
  top_p: number;
  max_output_tokens: number;
}

export type AggregateMode = "mean" | "p10" | "mean_minus_lambda_std";

export interface SelectionConfig {
  eval_samples_per_candidate: number;
  eval_temperature: number;
  eval_top_p: number;
  aggregate: AggregateMode;
  lambda_std?: number; // used for mean_minus_lambda_std
}

export interface AgentConfig {
  name: string;
  spymaster: SpymasterConfig;
  guesser: GuesserConfig;
  selection: SelectionConfig;
}

export interface Player {
  id: string;
  token: string;
  name: string;
  team: Team | "SPECTATOR";
  role: PlayerRole;
  joined_at: number;
}

export interface ClueState {
  status: "pending" | "ready";
  team: Team;
  clue?: string;
  number?: number;
  generated_at?: number;
  // for debugging
  picked_index?: number;
}

export interface GameStateInternal {
  room_id: string;
  created_at: number;

  // Config references
  red_agent: string;  // id = filename without .json
  blue_agent: string;

  // Game
  board_words: string[];   // len=25, UPPERCASE
  key: CardType[];         // len=25 (secret)
  revealed: boolean[];     // len=25
  starting_team: Team;
  turn: Team;
  clue: ClueState;
  guesses_made_this_turn: number;
  max_guesses_this_turn: number;

  ended: boolean;
  winner?: Team;

  players: Player[];

  // Simple event log for UI
  history: GameEvent[];
  version: number;
}

export type GameEvent =
  | { t: "room_created"; at: number; by?: string }
  | { t: "player_joined"; at: number; player_id: string; name: string; team: string; role?: PlayerRole | string }
  | { t: "clue_ready"; at: number; team: Team; clue: string; number: number }
  | { t: "guess"; at: number; team: Team; word: string; result: CardType; by: string }
  | { t: "stop"; at: number; team: Team; by: string }
  | { t: "turn_end"; at: number; next_team: Team; reason: string }
  | { t: "game_end"; at: number; winner: Team; reason: string }
  | { t: "reset"; at: number; by?: string };

export interface GameStatePublic {
  room_id: string;
  created_at: number;

  red_agent: string;
  blue_agent: string;

  board_words: string[];
  revealed: boolean[];

  starting_team: Team;
  turn: Team;
  clue: ClueState;
  guesses_made_this_turn: number;
  max_guesses_this_turn: number;

  ended: boolean;
  winner?: Team;

  players: Array<Pick<Player, "id" | "name" | "team" | "role" | "joined_at">>;
  history: GameEvent[];
  version: number;
}

export interface PresetInfo {
  id: string;
  name: string;
  spymaster_model: string;
  guesser_model: string;
  spymaster_prompt_id: string;
  guesser_prompt_id: string;
  candidates_per_turn: number;
  eval_samples_per_candidate: number;
}
