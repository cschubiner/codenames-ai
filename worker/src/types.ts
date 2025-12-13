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

// Legacy single-model config (for backwards compatibility)
export interface ModelConfig {
  redSpymaster: string;
  redGuesser: string;
  blueSpymaster: string;
  blueGuesser: string;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

// Single model entry with its settings
export interface ModelEntry {
  model: string;
  reasoningEffort?: ReasoningEffort;
  customInstructions?: string;
}

// Multi-model config: each role can have multiple model entries
export interface MultiModelConfig {
  redSpymaster: ModelEntry[];
  redGuesser: ModelEntry[];
  blueSpymaster: ModelEntry[];
  blueGuesser: ModelEntry[];
}

// Assassin behavior modes
export type AssassinBehavior = 'instant_loss' | 'reveal_opponent' | 'add_own_cards';

// Turn timer options (in seconds, null = no timer)
export type TurnTimerSetting = 60 | 120 | 180 | 240 | null;

// Legacy configs (kept for backwards compatibility during migration)
export interface ReasoningEffortConfig {
  redSpymaster?: ReasoningEffort;
  redGuesser?: ReasoningEffort;
  blueSpymaster?: ReasoningEffort;
  blueGuesser?: ReasoningEffort;
}

export interface CustomInstructionsConfig {
  redSpymaster?: string;
  redGuesser?: string;
  blueSpymaster?: string;
  blueGuesser?: string;
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
  spymasterReasoning?: string;
  riskAssessment?: string;
  guesses?: Array<{ word: string; cardType: CardType; aiReasoning?: string }>;
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

  // Settings
  allowHumanAIHelp: boolean;
  showAIReasoning: boolean;
  showSpymasterReasoning: boolean;
  giveAIPastTurnInfo: boolean; // Give AI past turn history for better strategy
  assassinBehavior: AssassinBehavior;
  turnTimer: TurnTimerSetting;

  // Simulation settings for AI Spymaster
  simulationCount: number; // 0 = off, 2-9 = number of candidates to evaluate
  simulationModel: string; // Model to use for simulating guesser responses
  showSimulationDetails: boolean; // Show all candidates and scores in admin view
  lastSimulationResults: ClueSimulationResult[] | null; // Results from last simulation

  // Role configuration
  roleConfig: RoleConfig;
  modelConfig: ModelConfig; // Legacy - kept for backwards compatibility
  reasoningEffortConfig: ReasoningEffortConfig; // Legacy
  customInstructionsConfig: CustomInstructionsConfig; // Legacy
  multiModelConfig: MultiModelConfig; // New: multiple models per role with individual settings
  players: Player[];

  // Board state
  words: string[];
  key: CardType[];
  revealed: boolean[];

  // Game progress
  currentTeam: Team;
  currentClue: Clue | null;
  guessesRemaining: number;
  turnPhase: 'clue' | 'guess'; // Whether we're waiting for clue or guesses

  // Scores
  redRemaining: number;
  blueRemaining: number;

  // Game result
  winner: Team | null;

  // History
  clueHistory: Clue[];
  guessHistory: Array<{ word: string; cardType: CardType; team: Team }>;

  // Timing tracking
  phaseStartTime: number | null; // When current phase (clue/guess) started
  turnStartTime: number | null; // When current team's turn started (for turn timer)
  timing: {
    red: { spymasterMs: number; guesserMs: number };
    blue: { spymasterMs: number; guesserMs: number };
  };

  // Pause state
  isPaused: boolean;
  pausedAt: number | null; // Timestamp when paused
  pausedPhaseElapsed: number | null; // Elapsed ms in current phase when paused
  pausedTurnElapsed: number | null; // Elapsed ms in current turn when paused

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
  reasoningEffortConfig?: ReasoningEffortConfig;
  customInstructionsConfig?: CustomInstructionsConfig;
  allowHumanAIHelp?: boolean;
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AISuggestRequest {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AIPlayRequest {}

// Public game state (filtered based on viewer's role)
export interface PublicGameState {
  roomCode: string;
  phase: GameState['phase'];
  allowHumanAIHelp: boolean;
  showAIReasoning: boolean;
  showSpymasterReasoning: boolean;
  giveAIPastTurnInfo: boolean;
  assassinBehavior: AssassinBehavior;
  turnTimer: TurnTimerSetting;
  simulationCount: number;
  simulationModel: string;
  showSimulationDetails: boolean;
  lastSimulationResults?: ClueSimulationResult[]; // Only included when showSimulationDetails is true
  roleConfig: RoleConfig;
  modelConfig: ModelConfig;
  reasoningEffortConfig: ReasoningEffortConfig;
  customInstructionsConfig: CustomInstructionsConfig;
  multiModelConfig: MultiModelConfig;
  players: Player[];
  words: string[];
  revealed: boolean[];
  revealedTypes: (CardType | null)[]; // Only shows types for revealed cards
  key?: CardType[]; // Only included for spymasters
  currentTeam: Team;
  currentClue: Clue | null;
  guessesRemaining: number;
  turnPhase: 'clue' | 'guess';
  redRemaining: number;
  blueRemaining: number;
  winner: Team | null;
  clueHistory: Clue[];
  guessHistory: Array<{ word: string; cardType: CardType; team: Team }>;
  // Timing info
  phaseStartTime: number | null;
  turnStartTime: number | null; // When the current team's turn started (for turn timer)
  timing: {
    red: { spymasterMs: number; guesserMs: number };
    blue: { spymasterMs: number; guesserMs: number };
  };
  // Pause state
  isPaused: boolean;
  pausedAt: number | null;
  // Timestamps
  createdAt: number;
  updatedAt: number;
}

// AI-related types
export interface AIClueCandidate {
  clue: string;
  number: number;
  intendedTargets: string[];
  reasoning: string;
  riskAssessment: string;
  generatedByModel?: string; // Track which model generated this candidate
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

// Simulation types for AI Spymaster clue evaluation
export interface ClueSimulationResult {
  candidate: AIClueCandidate;
  simulatedGuesses: AIGuessSuggestion[];
  guesserReasoning: string;
  simulationGuesserModel?: string; // Track which model simulated the guesses
  guessResults: Array<{
    word: string;
    cardType: CardType;
    points: number;
  }>;
  outstandingCount: number;
  opponentEndPenalty: number;
  totalScore: number;
}

export interface SimulationEvaluationResult {
  winner: ClueSimulationResult;
  allResults: ClueSimulationResult[];
}
