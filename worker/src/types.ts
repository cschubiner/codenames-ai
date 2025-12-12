/**
 * Type definitions for Codenames AI game state
 */

export type Team = 'red' | 'blue';
export type CardType = 'red' | 'blue' | 'neutral' | 'assassin';
export type RoleType = 'spymaster' | 'guesser';
export type PlayerType = 'human' | 'ai';

export interface RoleConfig {
  redSpymaster: PlayerType;
  redGuesser: PlayerType;
  blueSpymaster: PlayerType;
  blueGuesser: PlayerType;
}

export interface ModelConfig {
  redSpymaster: string;
  redGuesser: string;
  blueSpymaster: string;
  blueGuesser: string;
}

export interface Player {
  id: string;
  name: string;
  team: Team;
  role: RoleType;
  joinedAt: number;
}

export interface Clue {
  word: string;
  number: number;
  team: Team;
  intendedTargets?: string[];
}

export interface GuessResult {
  word: string;
  cardType: CardType;
  correct: boolean;
  turnEnded: boolean;
  gameOver: boolean;
  winner?: Team;
}

export interface GameState {
  // Room info
  roomCode: string;
  phase: 'setup' | 'playing' | 'finished';

  // Role configuration
  roleConfig: RoleConfig;
  modelConfig: ModelConfig;
  players: Player[];

  // Board state
  words: string[];
  key: CardType[];
  revealed: boolean[];

  // Game progress
  currentTeam: Team;
  currentClue: Clue | null;
  guessesRemaining: number;

  // Scores
  redRemaining: number;
  blueRemaining: number;

  // Game result
  winner: Team | null;

  // History
  clueHistory: Clue[];
  guessHistory: Array<{ word: string; cardType: CardType; team: Team }>;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

// API request/response types
export interface CreateGameRequest {
  hostName?: string;
}

export interface CreateGameResponse {
  roomCode: string;
  gameState: PublicGameState;
}

export interface ConfigureRolesRequest {
  roleConfig: RoleConfig;
  modelConfig?: ModelConfig;
}

export interface JoinGameRequest {
  playerName: string;
  team: Team;
  role: RoleType;
}

export interface SubmitClueRequest {
  word: string;
  number: number;
}

export interface SubmitGuessRequest {
  word: string;
}

export interface AIClueRequest {
  confirm?: boolean;
}

export interface AISuggestRequest {
  // No params needed
}

export interface AIPlayRequest {
  // No params needed
}

// Public game state (filtered based on viewer's role)
export interface PublicGameState {
  roomCode: string;
  phase: GameState['phase'];
  roleConfig: RoleConfig;
  modelConfig: ModelConfig;
  players: Player[];
  words: string[];
  revealed: boolean[];
  revealedTypes: (CardType | null)[]; // Only shows types for revealed cards
  key?: CardType[]; // Only included for spymasters
  currentTeam: Team;
  currentClue: Clue | null;
  guessesRemaining: number;
  redRemaining: number;
  blueRemaining: number;
  winner: Team | null;
  clueHistory: Clue[];
  guessHistory: Array<{ word: string; cardType: CardType; team: Team }>;
}

// AI-related types
export interface AIClueCandidate {
  clue: string;
  number: number;
  intendedTargets: string[];
  reasoning: string;
  riskAssessment: string;
}

export interface AIGuessSuggestion {
  word: string;
  confidence: number;
}

export interface AIGuessResponse {
  suggestions: AIGuessSuggestion[];
  reasoning: string;
  stopAfter: number;
}
