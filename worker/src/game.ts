/**
 * GameRoom Durable Object - manages game state for a single room
 */

import {
  GameState,
  PublicGameState,
  Team,
  CardType,
  RoleType,
  Player,
  Clue,
  RoleConfig,
  ModelConfig,
  ReasoningEffortConfig,
  CustomInstructionsConfig,
  MultiModelConfig,
  ModelEntry,
  AssassinBehavior,
  TurnTimerSetting,
  GuessResult,
  AIClueCandidate,
  AIGuessResponse,
} from './types';
import {
  generateAIClue,
  generateAIGuesses,
  requiresBackgroundMode,
  startBackgroundClue,
  pollBackgroundRequest,
  evaluateClueWithSimulation,
} from './ai';

// Word list (subset for the worker - full list loaded from shared/)
import wordlist from '../../shared/wordlist.json';

interface Env {
  OPENAI_API_KEY?: string;
  GAME_HISTORY?: D1Database;
}

export class GameRoom {
  private state: DurableObjectState;
  private env: Env;
  private gameState: GameState | null = null;
  private pendingAIClue: AIClueCandidate | null = null;
  private pendingAIClueTeam: Team | null = null;
  private pendingAIClueLoaded = false;

  // Debounce/lock AI endpoints per room (prevents thundering herd from multiple clients)
  private aiClueTask: Promise<AIClueCandidate> | null = null;
  private aiSuggestTask: Promise<AIGuessResponse> | null = null;
  private aiSuggestSig: string | null = null;
  private aiSuggestCache: AIGuessResponse | null = null;
  private aiSuggestCacheSig: string | null = null;
  private aiSuggestCacheAt = 0;
  private aiPlayInFlight = false;

  // Background mode state (for long-running models like gpt-5.2-pro)
  private pendingBackgroundClueId: string | null = null;
  private pendingBackgroundClueTeam: Team | null = null;
  private pendingBackgroundGuessId: string | null = null;
  private pendingBackgroundGuessTeam: Team | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Load state if not loaded
      if (!this.gameState) {
        this.gameState = await this.state.storage.get('gameState') || null;
        if (this.gameState) {
          this.gameState = this.normalizeGameState(this.gameState);
        }
      }

      // Route requests
      if (method === 'POST' && path === '/create') {
        return this.handleCreate(request);
      }

      if (!this.gameState) {
        return jsonResponse({ error: 'Game not found' }, 404);
      }

      if (method === 'GET' && path === '/state') {
        return this.handleGetState(request);
      }

      if (method === 'POST' && path === '/configure') {
        return this.handleConfigure(request);
      }

      if (method === 'POST' && path === '/join') {
        return this.handleJoin(request);
      }

      if (method === 'POST' && path === '/start') {
        return this.handleStart();
      }

      if (method === 'POST' && path === '/clue') {
        return this.handleClue(request);
      }

      if (method === 'POST' && path === '/guess') {
        return this.handleGuess(request);
      }

      if (method === 'POST' && path === '/end-turn') {
        return this.handleEndTurn();
      }

      if (method === 'POST' && path === '/kick') {
        return this.handleKick(request);
      }

      if (method === 'POST' && path === '/ai-clue') {
        return this.handleAIClue(request);
      }

      if (method === 'POST' && path === '/ai-suggest') {
        return this.handleAISuggest(request);
      }

      if (method === 'POST' && path === '/ai-play') {
        return this.handleAIPlay();
      }

      if (method === 'POST' && path === '/toggle-ai-reasoning') {
        return this.handleToggleAIReasoning(request);
      }

      if (method === 'POST' && path === '/toggle-spymaster-reasoning') {
        return this.handleToggleSpymasterReasoning(request);
      }

      if (method === 'POST' && path === '/set-assassin-behavior') {
        return this.handleSetAssassinBehavior(request);
      }

      if (method === 'POST' && path === '/set-turn-timer') {
        return this.handleSetTurnTimer(request);
      }

      if (method === 'POST' && path === '/pause') {
        return this.handlePause();
      }

      if (method === 'POST' && path === '/resume') {
        return this.handleResume();
      }

      if (method === 'POST' && path === '/toggle-simulation-details') {
        return this.handleToggleSimulationDetails(request);
      }

      if (method === 'GET' && path === '/replay-settings') {
        return this.handleGetReplaySettings();
      }

      if (method === 'POST' && path === '/replay') {
        return this.handleReplay();
      }

      // Background mode endpoints for long-running AI models
      if (method === 'GET' && path === '/ai-clue-status') {
        return this.handleAIClueStatus();
      }

      if (method === 'GET' && path === '/ai-guess-status') {
        return this.handleAIGuessStatus();
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Error handling request:', error);
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private normalizeGameState(gs: any): GameState {
    const roleConfigDefaults: RoleConfig = {
      redSpymaster: 'human',
      redGuesser: 'human',
      blueSpymaster: 'human',
      blueGuesser: 'human',
    };

    const modelConfigDefaults: ModelConfig = {
      redSpymaster: 'gpt-4o',
      redGuesser: 'gpt-4o-mini',
      blueSpymaster: 'gpt-4o',
      blueGuesser: 'gpt-4o-mini',
    };

    if (typeof gs.allowHumanAIHelp !== 'boolean') gs.allowHumanAIHelp = false;
    if (typeof gs.showAIReasoning !== 'boolean') gs.showAIReasoning = true;
    if (typeof gs.showSpymasterReasoning !== 'boolean') gs.showSpymasterReasoning = false;
    if (typeof gs.giveAIPastTurnInfo !== 'boolean') gs.giveAIPastTurnInfo = false;
    if (typeof gs.isPaused !== 'boolean') gs.isPaused = false;
    if (typeof gs.pausedAt !== 'number') gs.pausedAt = null;
    if (typeof gs.pausedPhaseElapsed !== 'number') gs.pausedPhaseElapsed = null;
    if (typeof gs.pausedTurnElapsed !== 'number') gs.pausedTurnElapsed = null;
    if (!gs.assassinBehavior || !['instant_loss', 'reveal_opponent', 'add_own_cards'].includes(gs.assassinBehavior)) {
      gs.assassinBehavior = 'instant_loss';
    }
    if (!('turnTimer' in gs) || ![60, 120, 180, 240, null].includes(gs.turnTimer)) {
      gs.turnTimer = null;
    }
    // Simulation settings
    if (typeof gs.simulationCount !== 'number' || gs.simulationCount < 0 || gs.simulationCount > 9 || gs.simulationCount === 1) {
      gs.simulationCount = 0;
    }
    if (typeof gs.simulationModel !== 'string' || !gs.simulationModel) {
      gs.simulationModel = 'gpt-4o';
    }
    if (typeof gs.showSimulationDetails !== 'boolean') gs.showSimulationDetails = false;
    if (!gs.lastSimulationResults) gs.lastSimulationResults = null;

    if (!gs.roleConfig) gs.roleConfig = { ...roleConfigDefaults };
    for (const key of Object.keys(roleConfigDefaults) as Array<keyof RoleConfig>) {
      if (gs.roleConfig[key] !== 'human' && gs.roleConfig[key] !== 'ai') {
        gs.roleConfig[key] = roleConfigDefaults[key];
      }
    }

    if (!gs.modelConfig) gs.modelConfig = { ...modelConfigDefaults };
    for (const key of Object.keys(modelConfigDefaults) as Array<keyof ModelConfig>) {
      if (typeof gs.modelConfig[key] !== 'string' || !gs.modelConfig[key]) {
        gs.modelConfig[key] = modelConfigDefaults[key];
      }
    }

    if (!gs.reasoningEffortConfig || typeof gs.reasoningEffortConfig !== 'object') gs.reasoningEffortConfig = {};
    if (!gs.customInstructionsConfig || typeof gs.customInstructionsConfig !== 'object') gs.customInstructionsConfig = {};

    // Multi-model config: migrate from legacy single-model config if needed
    if (!gs.multiModelConfig || typeof gs.multiModelConfig !== 'object') {
      gs.multiModelConfig = {
        redSpymaster: [],
        redGuesser: [],
        blueSpymaster: [],
        blueGuesser: [],
      };
    }
    // Ensure each role has at least one model entry (migrate from legacy if empty)
    for (const key of ['redSpymaster', 'redGuesser', 'blueSpymaster', 'blueGuesser'] as const) {
      if (!Array.isArray(gs.multiModelConfig[key]) || gs.multiModelConfig[key].length === 0) {
        // Migrate from legacy config
        const legacyModel = gs.modelConfig?.[key] || modelConfigDefaults[key];
        const legacyEffort = gs.reasoningEffortConfig?.[key];
        const legacyInstructions = gs.customInstructionsConfig?.[key];
        gs.multiModelConfig[key] = [{
          model: legacyModel,
          reasoningEffort: legacyEffort,
          customInstructions: legacyInstructions,
        }];
      }
    }

    if (!Array.isArray(gs.players)) gs.players = [];
    if (!Array.isArray(gs.clueHistory)) gs.clueHistory = [];
    if (!Array.isArray(gs.guessHistory)) gs.guessHistory = [];

    // Timing fields
    if (!gs.turnPhase) gs.turnPhase = gs.currentClue ? 'guess' : 'clue';
    if (typeof gs.phaseStartTime !== 'number') gs.phaseStartTime = null;
    if (typeof gs.turnStartTime !== 'number') gs.turnStartTime = null;
    if (!gs.timing) {
      gs.timing = {
        red: { spymasterMs: 0, guesserMs: 0 },
        blue: { spymasterMs: 0, guesserMs: 0 },
      };
    }

    return gs as GameState;
  }

  private async handleCreate(request: Request): Promise<Response> {
    const body = await request.json() as { roomCode: string; hostName?: string };
    const roomCode = body.roomCode;

    // Generate board
    const words = this.generateBoard();
    const key = this.generateKey('red'); // RED always starts

    this.gameState = {
      roomCode,
      phase: 'setup',
      allowHumanAIHelp: false,
      showAIReasoning: true,
      showSpymasterReasoning: false,
      giveAIPastTurnInfo: false,
      assassinBehavior: 'instant_loss',
      turnTimer: null,
      simulationCount: 0,
      simulationModel: 'gpt-4o',
      showSimulationDetails: false,
      lastSimulationResults: null,
      roleConfig: {
        redSpymaster: 'human',
        redGuesser: 'human',
        blueSpymaster: 'human',
        blueGuesser: 'human',
      },
      modelConfig: {
        redSpymaster: 'gpt-4o',
        redGuesser: 'gpt-4o-mini',
        blueSpymaster: 'gpt-4o',
        blueGuesser: 'gpt-4o-mini',
      },
      reasoningEffortConfig: {},
      customInstructionsConfig: {},
      multiModelConfig: {
        redSpymaster: [{ model: 'gpt-4o' }],
        redGuesser: [{ model: 'gpt-4o-mini' }],
        blueSpymaster: [{ model: 'gpt-4o' }],
        blueGuesser: [{ model: 'gpt-4o-mini' }],
      },
      players: [],
      words,
      key,
      revealed: new Array(25).fill(false),
      currentTeam: 'red',
      currentClue: null,
      guessesRemaining: 0,
      turnPhase: 'clue',
      redRemaining: 9,
      blueRemaining: 8,
      winner: null,
      clueHistory: [],
      guessHistory: [],
      phaseStartTime: null,
      turnStartTime: null,
      timing: {
        red: { spymasterMs: 0, guesserMs: 0 },
        blue: { spymasterMs: 0, guesserMs: 0 },
      },
      isPaused: false,
      pausedAt: null,
      pausedPhaseElapsed: null,
      pausedTurnElapsed: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveState();

    return jsonResponse({
      roomCode,
      gameState: this.getPublicState(),
    });
  }

  private handleGetState(request: Request): Response {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') as RoleType | null;
    // team parameter reserved for future use (filtering by team)
    void url.searchParams.get('team');

    const isSpymaster = role === 'spymaster';
    return jsonResponse({
      gameState: this.getPublicState(isSpymaster),
    });
  }

  private async handleConfigure(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'setup') {
      return jsonResponse({ error: 'Can only configure during setup' }, 400);
    }

    const body = await request.json() as {
      roleConfig: RoleConfig;
      modelConfig?: ModelConfig;
      reasoningEffortConfig?: ReasoningEffortConfig;
      customInstructionsConfig?: CustomInstructionsConfig;
      multiModelConfig?: MultiModelConfig;
      allowHumanAIHelp?: boolean;
      giveAIPastTurnInfo?: boolean;
      simulationCount?: number;
      simulationModel?: string;
    };
    this.gameState!.roleConfig = body.roleConfig;
    if (body.modelConfig) {
      this.gameState!.modelConfig = body.modelConfig;
    }
    if (body.reasoningEffortConfig) {
      this.gameState!.reasoningEffortConfig = body.reasoningEffortConfig;
    }
    if (body.customInstructionsConfig) {
      this.gameState!.customInstructionsConfig = body.customInstructionsConfig;
    }
    // Multi-model config
    if (body.multiModelConfig) {
      // Validate and update multi-model config
      for (const key of ['redSpymaster', 'redGuesser', 'blueSpymaster', 'blueGuesser'] as const) {
        if (Array.isArray(body.multiModelConfig[key]) && body.multiModelConfig[key].length > 0) {
          this.gameState!.multiModelConfig[key] = body.multiModelConfig[key];
          // Also update legacy modelConfig with first model for backwards compatibility
          this.gameState!.modelConfig[key] = body.multiModelConfig[key][0].model;
          // Update legacy reasoningEffortConfig
          if (body.multiModelConfig[key][0].reasoningEffort) {
            this.gameState!.reasoningEffortConfig[key] = body.multiModelConfig[key][0].reasoningEffort;
          } else {
            delete this.gameState!.reasoningEffortConfig[key];
          }
          // Update legacy customInstructionsConfig
          if (body.multiModelConfig[key][0].customInstructions) {
            this.gameState!.customInstructionsConfig[key] = body.multiModelConfig[key][0].customInstructions;
          } else {
            delete this.gameState!.customInstructionsConfig[key];
          }
        }
      }
    }
    if (typeof body.allowHumanAIHelp === 'boolean') {
      this.gameState!.allowHumanAIHelp = body.allowHumanAIHelp;
    }
    if (typeof body.giveAIPastTurnInfo === 'boolean') {
      this.gameState!.giveAIPastTurnInfo = body.giveAIPastTurnInfo;
    }
    // Simulation settings
    if (typeof body.simulationCount === 'number' && body.simulationCount >= 0 && body.simulationCount <= 9 && body.simulationCount !== 1) {
      this.gameState!.simulationCount = body.simulationCount;
    }
    if (typeof body.simulationModel === 'string' && body.simulationModel) {
      this.gameState!.simulationModel = body.simulationModel;
    }
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleJoin(request: Request): Promise<Response> {
    const body = await request.json() as {
      playerName: string;
      team: Team;
      role: RoleType;
      playerId?: string;
    };

    // Check if role is available
    const roleKey = `${body.team}${body.role.charAt(0).toUpperCase()}${body.role.slice(1)}` as keyof RoleConfig;
    if (this.gameState!.roleConfig[roleKey] !== 'human') {
      return jsonResponse({ error: 'This role is assigned to AI' }, 400);
    }

    // Check if role is already taken
    const existingPlayer = this.gameState!.players.find(
      p => p.team === body.team && p.role === body.role
    );
    if (existingPlayer) {
      return jsonResponse({ error: 'Role already taken' }, 400);
    }

    const player: Player = {
      id: body.playerId || crypto.randomUUID(),
      name: body.playerName,
      team: body.team,
      role: body.role,
      joinedAt: Date.now(),
    };

    this.gameState!.players.push(player);
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({
      player,
      gameState: this.getPublicState(body.role === 'spymaster'),
    });
  }

  private async handleStart(): Promise<Response> {
    if (this.gameState!.phase !== 'setup') {
      return jsonResponse({ error: 'Game already started' }, 400);
    }

    // Check all human roles are filled
    const config = this.gameState!.roleConfig;
    const players = this.gameState!.players;

    const humanRoles: Array<{ team: Team; role: RoleType }> = [];
    if (config.redSpymaster === 'human') humanRoles.push({ team: 'red', role: 'spymaster' });
    if (config.redGuesser === 'human') humanRoles.push({ team: 'red', role: 'guesser' });
    if (config.blueSpymaster === 'human') humanRoles.push({ team: 'blue', role: 'spymaster' });
    if (config.blueGuesser === 'human') humanRoles.push({ team: 'blue', role: 'guesser' });

    for (const hr of humanRoles) {
      if (!players.find(p => p.team === hr.team && p.role === hr.role)) {
        return jsonResponse({
          error: `Waiting for ${hr.team} ${hr.role} to join`,
        }, 400);
      }
    }

    this.gameState!.phase = 'playing';
    this.gameState!.turnPhase = 'clue';
    this.gameState!.phaseStartTime = Date.now(); // Start timing for first spymaster
    this.gameState!.turnStartTime = Date.now(); // Start turn timer for first turn
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  // Helper to record elapsed time for the current phase
  private recordPhaseTime(): void {
    if (!this.gameState!.phaseStartTime) return;

    const elapsed = Date.now() - this.gameState!.phaseStartTime;
    const team = this.gameState!.currentTeam;

    if (this.gameState!.turnPhase === 'clue') {
      this.gameState!.timing[team].spymasterMs += elapsed;
    } else {
      this.gameState!.timing[team].guesserMs += elapsed;
    }

    this.gameState!.phaseStartTime = null;
  }

  // Helper to start timing a new phase
  private startPhaseTimer(): void {
    this.gameState!.phaseStartTime = Date.now();
  }

  private async handleClue(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    if (this.gameState!.currentClue) {
      return jsonResponse({ error: 'Clue already given this turn' }, 400);
    }

    const body = await request.json() as { word: string; number: number };

    // Validate clue
    const clueUpper = body.word.toUpperCase();
    if (this.gameState!.words.some(w => w.toUpperCase() === clueUpper)) {
      return jsonResponse({ error: 'Clue word is on the board' }, 400);
    }

    if (!Number.isInteger(body.number)) {
      return jsonResponse({ error: 'Number must be an integer' }, 400);
    }

    if (body.number < 0 || body.number > 9) {
      return jsonResponse({ error: 'Number must be 0-9' }, 400);
    }

    const clue: Clue = {
      word: body.word,
      number: body.number,
      team: this.gameState!.currentTeam,
      guesses: [],
    };

    // Record spymaster time and switch to guess phase
    this.recordPhaseTime();
    this.gameState!.turnPhase = 'guess';
    this.startPhaseTimer();

    this.gameState!.currentClue = clue;
    this.gameState!.guessesRemaining = body.number + 1;
    this.gameState!.clueHistory.push(clue);
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleGuess(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    if (!this.gameState!.currentClue) {
      return jsonResponse({ error: 'No clue given yet' }, 400);
    }

    if (this.gameState!.guessesRemaining <= 0) {
      return jsonResponse({ error: 'No guesses remaining' }, 400);
    }

    const body = await request.json() as { word: string };
    const wordUpper = body.word.toUpperCase();

    // Find word index
    const wordIndex = this.gameState!.words.findIndex(
      w => w.toUpperCase() === wordUpper
    );

    if (wordIndex === -1) {
      return jsonResponse({ error: 'Word not on board' }, 400);
    }

    if (this.gameState!.revealed[wordIndex]) {
      return jsonResponse({ error: 'Word already revealed' }, 400);
    }

    // Reveal the card
    this.gameState!.revealed[wordIndex] = true;
    const cardType = this.gameState!.key[wordIndex];
    const currentTeam = this.gameState!.currentTeam;

    // Update remaining counts
    if (cardType === 'red') this.gameState!.redRemaining--;
    if (cardType === 'blue') this.gameState!.blueRemaining--;

    // Record guess
    this.gameState!.guessHistory.push({
      word: body.word,
      cardType,
      team: currentTeam,
    });
    // Attach guess to the current clue in history (for UI display)
    const lastClue = this.gameState!.clueHistory[this.gameState!.clueHistory.length - 1];
    if (
      lastClue &&
      this.gameState!.currentClue &&
      lastClue.team === this.gameState!.currentClue.team &&
      lastClue.word === this.gameState!.currentClue.word &&
      lastClue.number === this.gameState!.currentClue.number
    ) {
      (lastClue.guesses ??= []).push({ word: body.word, cardType });
    }

    // Determine result
    const correct = cardType === currentTeam;
    let turnEnded = false;
    let gameOver = false;
    let winner: Team | null = null;

    if (cardType === 'assassin') {
      const behavior = this.gameState!.assassinBehavior;
      if (behavior === 'instant_loss') {
        // Default: guessing team loses instantly
        gameOver = true;
        winner = currentTeam === 'red' ? 'blue' : 'red';
        turnEnded = true;
      } else if (behavior === 'reveal_opponent') {
        // Reveal 2 random opponent cards for free
        const opponentTeam = currentTeam === 'red' ? 'blue' : 'red';
        this.revealRandomCards(opponentTeam, 2);
        turnEnded = true;
      } else if (behavior === 'add_own_cards') {
        // Convert 2 neutral cards to the guessing team's cards
        this.convertNeutralToTeam(currentTeam, 2);
        turnEnded = true;
      }
    }

    // Check for win conditions after potential assassin effects
    if (!gameOver && this.gameState!.redRemaining === 0) {
      gameOver = true;
      winner = 'red';
      turnEnded = true;
    } else if (!gameOver && this.gameState!.blueRemaining === 0) {
      gameOver = true;
      winner = 'blue';
      turnEnded = true;
    } else if (!gameOver && !turnEnded && !correct) {
      turnEnded = true;
    } else if (!gameOver && !turnEnded) {
      this.gameState!.guessesRemaining--;
      if (this.gameState!.guessesRemaining <= 0) {
        turnEnded = true;
      }
    }

    if (gameOver) {
      // Record final guesser time before game ends
      this.recordPhaseTime();

      this.gameState!.phase = 'finished';
      this.gameState!.winner = winner;

      // Determine end reason and save to history
      let endReason: 'all_found' | 'assassin' | 'opponent_found_all';
      if (cardType === 'assassin' && this.gameState!.assassinBehavior === 'instant_loss') {
        endReason = 'assassin';
      } else if (winner === currentTeam) {
        endReason = 'all_found';
      } else {
        endReason = 'opponent_found_all';
      }
      // Fire and forget - don't block the response
      this.saveCompletedGame(endReason).catch(console.error);
    }

    if (turnEnded && !gameOver) {
      this.endTurn();
    }

    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    const result: GuessResult = {
      word: body.word,
      cardType,
      correct,
      turnEnded,
      gameOver,
      winner: winner || undefined,
    };

    return jsonResponse({
      result,
      gameState: this.getPublicState(),
    });
  }

  private async handleEndTurn(): Promise<Response> {
    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    this.endTurn();
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleKick(request: Request): Promise<Response> {
    const body = await request.json() as { team: Team; role: RoleType };
    const team = body?.team;
    const role = body?.role;

    if ((team !== 'red' && team !== 'blue') || (role !== 'spymaster' && role !== 'guesser')) {
      return jsonResponse({ error: 'Invalid team/role' }, 400);
    }

    const beforeCount = this.gameState!.players.length;
    this.gameState!.players = this.gameState!.players.filter(p => !(p.team === team && p.role === role));

    if (this.gameState!.players.length !== beforeCount) {
      this.gameState!.updatedAt = Date.now();
      await this.saveState();
    }

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleToggleAIReasoning(request: Request): Promise<Response> {
    const body = await request.json() as { showAIReasoning: boolean };

    if (typeof body.showAIReasoning !== 'boolean') {
      return jsonResponse({ error: 'showAIReasoning must be a boolean' }, 400);
    }

    this.gameState!.showAIReasoning = body.showAIReasoning;
    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleToggleSpymasterReasoning(request: Request): Promise<Response> {
    const body = await request.json() as { showSpymasterReasoning: boolean };

    if (typeof body.showSpymasterReasoning !== 'boolean') {
      return jsonResponse({ error: 'showSpymasterReasoning must be a boolean' }, 400);
    }

    this.gameState!.showSpymasterReasoning = body.showSpymasterReasoning;
    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleSetAssassinBehavior(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'setup') {
      return jsonResponse({ error: 'Can only change assassin behavior during setup' }, 400);
    }

    const body = await request.json() as { assassinBehavior: AssassinBehavior };

    if (!['instant_loss', 'reveal_opponent', 'add_own_cards'].includes(body.assassinBehavior)) {
      return jsonResponse({ error: 'Invalid assassin behavior' }, 400);
    }

    this.gameState!.assassinBehavior = body.assassinBehavior;
    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleSetTurnTimer(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'setup') {
      return jsonResponse({ error: 'Can only change turn timer during setup' }, 400);
    }

    const body = await request.json() as { turnTimer: TurnTimerSetting };

    if (![60, 120, 180, 240, null].includes(body.turnTimer)) {
      return jsonResponse({ error: 'Invalid turn timer value' }, 400);
    }

    this.gameState!.turnTimer = body.turnTimer;
    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handlePause(): Promise<Response> {
    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Can only pause during gameplay' }, 400);
    }

    if (this.gameState!.isPaused) {
      return jsonResponse({ error: 'Game is already paused' }, 400);
    }

    const now = Date.now();

    // Calculate elapsed time in current phase and turn before pausing
    const phaseElapsed = this.gameState!.phaseStartTime
      ? now - this.gameState!.phaseStartTime
      : 0;
    const turnElapsed = this.gameState!.turnStartTime
      ? now - this.gameState!.turnStartTime
      : 0;

    this.gameState!.isPaused = true;
    this.gameState!.pausedAt = now;
    this.gameState!.pausedPhaseElapsed = phaseElapsed;
    this.gameState!.pausedTurnElapsed = turnElapsed;
    this.gameState!.updatedAt = now;

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleResume(): Promise<Response> {
    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Can only resume during gameplay' }, 400);
    }

    if (!this.gameState!.isPaused) {
      return jsonResponse({ error: 'Game is not paused' }, 400);
    }

    const now = Date.now();

    // Restore start times so elapsed calculation continues correctly
    // The new start time = now - (elapsed time when paused)
    if (this.gameState!.pausedPhaseElapsed !== null) {
      this.gameState!.phaseStartTime = now - this.gameState!.pausedPhaseElapsed;
    }
    if (this.gameState!.pausedTurnElapsed !== null) {
      this.gameState!.turnStartTime = now - this.gameState!.pausedTurnElapsed;
    }

    this.gameState!.isPaused = false;
    this.gameState!.pausedAt = null;
    this.gameState!.pausedPhaseElapsed = null;
    this.gameState!.pausedTurnElapsed = null;
    this.gameState!.updatedAt = now;

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleToggleSimulationDetails(request: Request): Promise<Response> {
    const body = await request.json() as { showSimulationDetails: boolean };

    if (typeof body.showSimulationDetails !== 'boolean') {
      return jsonResponse({ error: 'showSimulationDetails must be a boolean' }, 400);
    }

    this.gameState!.showSimulationDetails = body.showSimulationDetails;
    this.gameState!.updatedAt = Date.now();
    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private handleGetReplaySettings(): Response {
    // Return the current game settings for creating a replay game
    const gs = this.gameState!;
    return jsonResponse({
      settings: {
        roleConfig: gs.roleConfig,
        modelConfig: gs.modelConfig,
        reasoningEffortConfig: gs.reasoningEffortConfig,
        customInstructionsConfig: gs.customInstructionsConfig,
        multiModelConfig: gs.multiModelConfig,
        allowHumanAIHelp: gs.allowHumanAIHelp,
        giveAIPastTurnInfo: gs.giveAIPastTurnInfo,
        assassinBehavior: gs.assassinBehavior,
        turnTimer: gs.turnTimer,
        simulationCount: gs.simulationCount,
        simulationModel: gs.simulationModel,
      },
      players: gs.players,
    });
  }

  private async handleReplay(): Promise<Response> {
    const gs = this.gameState!;

    if (!gs.winner && gs.phase !== 'finished') {
      return jsonResponse({ error: 'Can only replay after the game is finished' }, 400);
    }

    // Reset any in-flight AI state so the next game can start cleanly.
    this.pendingAIClue = null;
    this.pendingAIClueTeam = null;
    this.pendingAIClueLoaded = true;
    this.aiClueTask = null;
    this.aiSuggestTask = null;
    this.aiSuggestSig = null;
    this.aiSuggestCache = null;
    this.aiSuggestCacheSig = null;
    this.aiSuggestCacheAt = 0;
    this.aiPlayInFlight = false;
    this.pendingBackgroundClueId = null;
    this.pendingBackgroundClueTeam = null;
    this.pendingBackgroundGuessId = null;
    this.pendingBackgroundGuessTeam = null;
    await this.state.storage.delete('pendingAIClue');

    const now = Date.now();

    // Generate a fresh board but keep lobby settings and seats.
    const words = this.generateBoard();
    const key = this.generateKey('red'); // RED always starts

    gs.phase = 'playing';
    gs.isPaused = false;
    gs.pausedAt = null;
    gs.pausedPhaseElapsed = null;
    gs.pausedTurnElapsed = null;

    gs.words = words;
    gs.key = key;
    gs.revealed = new Array(25).fill(false);

    gs.currentTeam = 'red';
    gs.currentClue = null;
    gs.guessesRemaining = 0;
    gs.turnPhase = 'clue';
    gs.redRemaining = 9;
    gs.blueRemaining = 8;
    gs.winner = null;
    gs.clueHistory = [];
    gs.guessHistory = [];
    gs.lastSimulationResults = null;

    gs.phaseStartTime = now;
    gs.turnStartTime = now;
    gs.timing = {
      red: { spymasterMs: 0, guesserMs: 0 },
      blue: { spymasterMs: 0, guesserMs: 0 },
    };

    gs.createdAt = now;
    gs.updatedAt = now;

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
  }

  private async handleAIClue(request: Request): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }
    const apiKey = this.env.OPENAI_API_KEY;

    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    if (this.gameState!.currentClue) {
      return jsonResponse({ error: 'Clue already given this turn' }, 400);
    }

    const body = await request.json().catch(() => ({})) as { confirm?: boolean };
    const team = this.gameState!.currentTeam;
    const spymasterKey = `${team}Spymaster` as keyof RoleConfig;
    if (this.gameState!.roleConfig[spymasterKey] === 'human' && !this.gameState!.allowHumanAIHelp) {
      return jsonResponse({ error: 'AI help is disabled for human roles' }, 403);
    }

    // Load any pending clue from storage once per instance.
    if (!this.pendingAIClueLoaded) {
      const stored = await this.state.storage.get('pendingAIClue') as { clue: AIClueCandidate; team: Team } | null;
      if (stored?.clue && stored?.team) {
        this.pendingAIClue = stored.clue;
        this.pendingAIClueTeam = stored.team;
      }
      this.pendingAIClueLoaded = true;
    }

    // Debounce: if we already have a pending clue for this team/turn, return it instead of regenerating.
    if (!body.confirm && this.pendingAIClue && this.pendingAIClueTeam === team) {
      return jsonResponse({
        clue: this.pendingAIClue,
        message: 'AI generated a clue. Call with confirm=true to submit it.',
        gameState: this.getPublicState(),
      });
    }

    // If confirming a pending clue, do not generate a new one.
    if (body.confirm) {
      if (!this.pendingAIClue) {
        return jsonResponse({ error: 'No pending AI clue to confirm' }, 409);
      }

      if (this.pendingAIClueTeam && this.pendingAIClueTeam !== team) {
        // Turn advanced while the clue was pending; discard to avoid applying to wrong team.
        this.pendingAIClue = null;
        this.pendingAIClueTeam = null;
        this.pendingAIClueLoaded = true;
        await this.state.storage.delete('pendingAIClue');
        return jsonResponse({ error: 'Pending AI clue is stale (turn advanced)' }, 409);
      }

      const clue: Clue = {
        word: this.pendingAIClue.clue,
        number: this.pendingAIClue.number,
        team,
        intendedTargets: this.pendingAIClue.intendedTargets,
        spymasterReasoning: this.pendingAIClue.reasoning,
        riskAssessment: this.pendingAIClue.riskAssessment,
        guesses: [],
      };

      // Record spymaster time and switch to guess phase
      this.recordPhaseTime();
      this.gameState!.turnPhase = 'guess';
      this.startPhaseTimer();

      this.gameState!.currentClue = clue;
      this.gameState!.guessesRemaining = clue.number + 1;
      this.gameState!.clueHistory.push(clue);
      this.gameState!.updatedAt = Date.now();

      const confirmedClue = this.pendingAIClue;
      this.pendingAIClue = null;
      this.pendingAIClueTeam = null;
      this.pendingAIClueLoaded = true;
      await this.state.storage.delete('pendingAIClue');

      await this.saveState();

      return jsonResponse({
        confirmed: true,
        clue: confirmedClue,
        gameState: this.getPublicState(),
      });
    }

    // Get the configured models for this team's spymaster
    const modelKey = `${team}Spymaster` as keyof MultiModelConfig;
    const modelEntries = this.gameState!.multiModelConfig[modelKey];

    // Helper to pick a random model entry
    const pickRandomModelEntry = (): ModelEntry => {
      return modelEntries[Math.floor(Math.random() * modelEntries.length)];
    };

    // For background mode check, use first model (or we could check all)
    const firstEntry = modelEntries[0];
    const model = firstEntry.model;
    const reasoningEffort = firstEntry.reasoningEffort;
    const customInstructions = firstEntry.customInstructions;

    // Check if model requires background mode (for long-running requests)
    if (requiresBackgroundMode(model)) {
      // Check if we already have a pending background request
      if (this.pendingBackgroundClueId && this.pendingBackgroundClueTeam === team) {
        return jsonResponse({
          status: 'pending',
          backgroundId: this.pendingBackgroundClueId,
          message: 'AI clue generation in progress. Poll /ai-clue-status for updates.',
          gameState: this.getPublicState(),
        });
      }

      // Start a new background request
      try {
        const responseId = await startBackgroundClue(
          apiKey,
          this.gameState!,
          team,
          model,
          reasoningEffort,
          customInstructions
        );

        this.pendingBackgroundClueId = responseId;
        this.pendingBackgroundClueTeam = team;

        return jsonResponse({
          status: 'started',
          backgroundId: responseId,
          message: 'AI clue generation started. Poll /ai-clue-status for updates.',
          gameState: this.getPublicState(),
        });
      } catch (error) {
        return jsonResponse({ error: String(error) }, 500);
      }
    }

    // Check if simulation is enabled
    const simulationCount = this.gameState!.simulationCount;

    // Generate a new AI clue (synchronous path for fast models)
    try {
      if (simulationCount > 0) {
        // Simulation mode: generate multiple candidates and evaluate them
        if (!this.aiClueTask) {
          this.aiClueTask = (async () => {
            const simulationResult = await evaluateClueWithSimulation(
              apiKey,
              this.gameState!,
              team,
              simulationCount,
              modelEntries, // Pass all model entries - random selection happens inside
              this.gameState!.simulationModel
            );

            // Store simulation results for display if showSimulationDetails is enabled
            this.gameState!.lastSimulationResults = simulationResult.allResults;
            await this.saveState();

            const aiClue = simulationResult.winner.candidate;
            this.pendingAIClue = aiClue;
            this.pendingAIClueTeam = team;
            this.pendingAIClueLoaded = true;
            await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

            return aiClue;
          })().finally(() => {
            this.aiClueTask = null;
          });
        }

        const aiClue = await this.aiClueTask;

        this.pendingAIClue = aiClue;
        this.pendingAIClueTeam = team;
        this.pendingAIClueLoaded = true;
        await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

        return jsonResponse({
          clue: aiClue,
          simulationResults: this.gameState!.showSimulationDetails ? this.gameState!.lastSimulationResults : undefined,
          message: `AI evaluated ${simulationCount} clue candidates and selected the best. Call with confirm=true to submit it.`,
          gameState: this.getPublicState(),
        });
      } else {
        // Standard mode: generate a single clue (randomly select from model entries)
        if (!this.aiClueTask) {
          this.aiClueTask = (async () => {
            // Pick a random model entry for single clue generation
            const selectedEntry = pickRandomModelEntry();
            const aiClue = await generateAIClue(
              apiKey,
              this.gameState!,
              team,
              selectedEntry.model,
              selectedEntry.reasoningEffort,
              selectedEntry.customInstructions
            );

            this.pendingAIClue = aiClue;
            this.pendingAIClueTeam = team;
            this.pendingAIClueLoaded = true;
            await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

            return aiClue;
          })().finally(() => {
            this.aiClueTask = null;
          });
        }

        const aiClue = await this.aiClueTask;

        this.pendingAIClue = aiClue;
        this.pendingAIClueTeam = team;
        this.pendingAIClueLoaded = true;
        await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

        return jsonResponse({
          clue: aiClue,
          message: 'AI generated a clue. Call with confirm=true to submit it.',
          gameState: this.getPublicState(),
        });
      }
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleAIClueStatus(): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }
    const apiKey = this.env.OPENAI_API_KEY;

    if (!this.pendingBackgroundClueId) {
      return jsonResponse({ status: 'none', message: 'No pending background clue request' });
    }

    const team = this.pendingBackgroundClueTeam;

    // Check if the turn has changed
    if (team && team !== this.gameState!.currentTeam) {
      this.pendingBackgroundClueId = null;
      this.pendingBackgroundClueTeam = null;
      return jsonResponse({ status: 'cancelled', message: 'Turn advanced, request cancelled' });
    }

    try {
      const result = await pollBackgroundRequest(apiKey, this.pendingBackgroundClueId);

      if (result.status === 'completed' && result.result) {
        const aiClue = result.result as AIClueCandidate;
        this.pendingAIClue = aiClue;
        this.pendingAIClueTeam = team;
        this.pendingAIClueLoaded = true;
        await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

        // Clear background request state
        this.pendingBackgroundClueId = null;
        this.pendingBackgroundClueTeam = null;

        return jsonResponse({
          status: 'completed',
          clue: aiClue,
          message: 'AI generated a clue. Call /ai-clue with confirm=true to submit it.',
          gameState: this.getPublicState(),
        });
      }

      if (result.status === 'failed') {
        this.pendingBackgroundClueId = null;
        this.pendingBackgroundClueTeam = null;
        return jsonResponse({ status: 'failed', error: result.error });
      }

      return jsonResponse({
        status: result.status,
        message: 'AI clue generation in progress...',
        gameState: this.getPublicState(),
      });
    } catch (error) {
      this.pendingBackgroundClueId = null;
      this.pendingBackgroundClueTeam = null;
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleAIGuessStatus(): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }
    const apiKey = this.env.OPENAI_API_KEY;

    if (!this.pendingBackgroundGuessId) {
      return jsonResponse({ status: 'none', message: 'No pending background guess request' });
    }

    const team = this.pendingBackgroundGuessTeam;

    // Check if the turn has changed
    if (team && team !== this.gameState!.currentTeam) {
      this.pendingBackgroundGuessId = null;
      this.pendingBackgroundGuessTeam = null;
      return jsonResponse({ status: 'cancelled', message: 'Turn advanced, request cancelled' });
    }

    try {
      const result = await pollBackgroundRequest(apiKey, this.pendingBackgroundGuessId);

      if (result.status === 'completed' && result.result) {
        const suggestions = result.result as AIGuessResponse;

        // Clear background request state
        this.pendingBackgroundGuessId = null;
        this.pendingBackgroundGuessTeam = null;

        return jsonResponse({
          status: 'completed',
          suggestions: suggestions.suggestions,
          reasoning: suggestions.reasoning,
          stopAfter: suggestions.stopAfter,
          gameState: this.getPublicState(),
        });
      }

      if (result.status === 'failed') {
        this.pendingBackgroundGuessId = null;
        this.pendingBackgroundGuessTeam = null;
        return jsonResponse({ status: 'failed', error: result.error });
      }

      return jsonResponse({
        status: result.status,
        message: 'AI guess generation in progress...',
        gameState: this.getPublicState(),
      });
    } catch (error) {
      this.pendingBackgroundGuessId = null;
      this.pendingBackgroundGuessTeam = null;
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleAISuggest(_request: Request): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }
    const apiKey = this.env.OPENAI_API_KEY;

    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    if (!this.gameState!.currentClue) {
      return jsonResponse({ error: 'No clue given yet' }, 400);
    }

    const clue = this.gameState!.currentClue;
    const guesserKey = `${clue.team}Guesser` as keyof RoleConfig;
    if (this.gameState!.roleConfig[guesserKey] === 'human' && !this.gameState!.allowHumanAIHelp) {
      return jsonResponse({ error: 'AI help is disabled for human roles' }, 403);
    }

    try {
      const suggestSig = `${clue.team}|${clue.word}|${clue.number}|${this.gameState!.guessHistory.length}`;
      const now = Date.now();

      if (this.aiSuggestCache && this.aiSuggestCacheSig === suggestSig && now - this.aiSuggestCacheAt < 10000) {
        return jsonResponse({
          suggestions: this.aiSuggestCache.suggestions,
          reasoning: this.aiSuggestCache.reasoning,
          stopAfter: this.aiSuggestCache.stopAfter,
          gameState: this.getPublicState(),
        });
      }

      if (this.aiSuggestTask && this.aiSuggestSig === suggestSig) {
        const cached = await this.aiSuggestTask;
        return jsonResponse({
          suggestions: cached.suggestions,
          reasoning: cached.reasoning,
          stopAfter: cached.stopAfter,
          gameState: this.getPublicState(),
        });
      }

      if (this.aiSuggestTask) {
        return jsonResponse({ error: 'AI suggest already in progress' }, 409);
      }

      // Get the configured model entries for this team's guesser
      const guesserModelKey = `${clue.team}Guesser` as keyof MultiModelConfig;
      const guesserModelEntries = this.gameState!.multiModelConfig[guesserModelKey];

      this.aiSuggestSig = suggestSig;
      this.aiSuggestTask = (async () => {
        // Pick a random model entry for guess suggestions
        const selectedEntry = guesserModelEntries[Math.floor(Math.random() * guesserModelEntries.length)];
        const suggestions = await generateAIGuesses(
          apiKey,
          this.gameState!,
          clue.word,
          clue.number,
          clue.team,
          selectedEntry.model,
          selectedEntry.reasoningEffort,
          selectedEntry.customInstructions
        );
        this.aiSuggestCache = suggestions;
        this.aiSuggestCacheSig = suggestSig;
        this.aiSuggestCacheAt = Date.now();
        return suggestions;
      })().finally(() => {
        this.aiSuggestTask = null;
        this.aiSuggestSig = null;
      });

      const suggestions = await this.aiSuggestTask;

      return jsonResponse({
        suggestions: suggestions.suggestions,
        reasoning: suggestions.reasoning,
        stopAfter: suggestions.stopAfter,
        gameState: this.getPublicState(),
      });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleAIPlay(): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }
    const apiKey = this.env.OPENAI_API_KEY;

    if (this.gameState!.phase !== 'playing') {
      return jsonResponse({ error: 'Game not in progress' }, 400);
    }

    if (!this.gameState!.currentClue) {
      return jsonResponse({ error: 'No clue given yet' }, 400);
    }

    if (this.gameState!.guessesRemaining <= 0) {
      return jsonResponse({ error: 'No guesses remaining' }, 400);
    }

    const expectedTeam = this.gameState!.currentTeam;
    const expectedClue = this.gameState!.currentClue;
    const expectedClueSig = `${expectedClue.team}|${expectedClue.word}|${expectedClue.number}`;
    const guesserKey = `${expectedClue.team}Guesser` as keyof RoleConfig;
    if (this.gameState!.roleConfig[guesserKey] === 'human' && !this.gameState!.allowHumanAIHelp) {
      return jsonResponse({ error: 'AI help is disabled for human roles' }, 403);
    }

    try {
      if (this.aiPlayInFlight) {
        return jsonResponse({ error: 'AI play already in progress' }, 409);
      }
      this.aiPlayInFlight = true;

      // Get the configured model entries for this team's guesser
      const playGuesserModelKey = `${expectedClue.team}Guesser` as keyof MultiModelConfig;
      const playGuesserModelEntries = this.gameState!.multiModelConfig[playGuesserModelKey];

      // Pick a random model entry for AI play
      const selectedEntry = playGuesserModelEntries[Math.floor(Math.random() * playGuesserModelEntries.length)];

      // Get AI suggestions
      const suggestions = await generateAIGuesses(
        apiKey,
        this.gameState!,
        expectedClue.word,
        expectedClue.number,
        expectedClue.team,
        selectedEntry.model,
        selectedEntry.reasoningEffort,
        selectedEntry.customInstructions
      );

      // If the turn advanced while we were waiting on OpenAI, don't apply a stale guess.
      const currentClue = this.gameState!.currentClue;
      const currentClueSig = currentClue ? `${currentClue.team}|${currentClue.word}|${currentClue.number}` : null;
      if (
        this.gameState!.phase !== 'playing' ||
        !currentClue ||
        this.gameState!.currentTeam !== expectedTeam ||
        currentClueSig !== expectedClueSig ||
        this.gameState!.guessesRemaining <= 0
      ) {
        return jsonResponse({ error: 'AI guess is stale (turn advanced)' }, 409);
      }

      if (suggestions.suggestions.length === 0) {
        return jsonResponse({ error: 'AI could not generate a guess' }, 500);
      }

      const currentTeam = this.gameState!.currentTeam;
      const rankedWords: string[] = [];
      const seen = new Set<string>();

      for (const suggestion of suggestions.suggestions) {
        const wordUpper = suggestion.word.toUpperCase();
        if (seen.has(wordUpper)) continue;
        const idx = this.gameState!.words.findIndex(w => w.toUpperCase() === wordUpper);
        if (idx === -1) continue;
        if (this.gameState!.revealed[idx]) continue;
        seen.add(wordUpper);
        rankedWords.push(this.gameState!.words[idx]);
      }

      // stopAfter = 0 means pass turn immediately (no guesses)
      // stopAfter > 0 means make that many guesses
      const rawStopAfter = Number.isInteger(suggestions.stopAfter) ? suggestions.stopAfter : 1;
      const guessCount = rawStopAfter === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              rawStopAfter,
              this.gameState!.guessesRemaining,
              rankedWords.length
            )
          );

      if (guessCount === 0) {
        this.endTurn();
        this.gameState!.updatedAt = Date.now();
        await this.saveState();

        return jsonResponse({
          plan: { reasoning: suggestions.reasoning, rankedWords, guessCount },
          guesses: [],
          result: {
            word: '',
            cardType: 'neutral' as CardType,
            correct: false,
            turnEnded: true,
            gameOver: false,
          },
          reasoning: suggestions.reasoning,
          gameState: this.getPublicState(),
        });
      }

      const guessResults: GuessResult[] = [];
      let turnEnded = false;
      let gameOver = false;
      let winner: Team | null = null;

      for (let i = 0; i < guessCount; i++) {
        if (this.gameState!.phase !== 'playing' || !this.gameState!.currentClue) break;
        if (this.gameState!.guessesRemaining <= 0) break;
        if (turnEnded || gameOver) break;

        const word = rankedWords[i];
        const wordUpper = word.toUpperCase();
        const wordIndex = this.gameState!.words.findIndex(w => w.toUpperCase() === wordUpper);
        if (wordIndex === -1) continue;
        if (this.gameState!.revealed[wordIndex]) continue;

        // Reveal the card
        this.gameState!.revealed[wordIndex] = true;
        const cardType = this.gameState!.key[wordIndex];

        if (cardType === 'red') this.gameState!.redRemaining--;
        if (cardType === 'blue') this.gameState!.blueRemaining--;

        this.gameState!.guessHistory.push({
          word,
          cardType,
          team: currentTeam,
        });

        const lastClue = this.gameState!.clueHistory[this.gameState!.clueHistory.length - 1];
        if (
          lastClue &&
          this.gameState!.currentClue &&
          lastClue.team === this.gameState!.currentClue.team &&
          lastClue.word === this.gameState!.currentClue.word &&
          lastClue.number === this.gameState!.currentClue.number
        ) {
          (lastClue.guesses ??= []).push({ word, cardType, aiReasoning: suggestions.reasoning });
        }

        const correct = cardType === currentTeam;

        let guessTurnEnded = false;
        let guessGameOver = false;
        let guessWinner: Team | null = null;

        if (cardType === 'assassin') {
          const behavior = this.gameState!.assassinBehavior;
          if (behavior === 'instant_loss') {
            guessGameOver = true;
            guessWinner = currentTeam === 'red' ? 'blue' : 'red';
            guessTurnEnded = true;
          } else if (behavior === 'reveal_opponent') {
            const opponentTeam = currentTeam === 'red' ? 'blue' : 'red';
            this.revealRandomCards(opponentTeam, 2);
            guessTurnEnded = true;
          } else if (behavior === 'add_own_cards') {
            this.convertNeutralToTeam(currentTeam, 2);
            guessTurnEnded = true;
          }
        }

        // Check win conditions after potential assassin effects
        if (!guessGameOver && this.gameState!.redRemaining === 0) {
          guessGameOver = true;
          guessWinner = 'red';
          guessTurnEnded = true;
        } else if (!guessGameOver && this.gameState!.blueRemaining === 0) {
          guessGameOver = true;
          guessWinner = 'blue';
          guessTurnEnded = true;
        } else if (!guessGameOver && !guessTurnEnded && !correct) {
          guessTurnEnded = true;
        } else if (!guessGameOver && !guessTurnEnded) {
          this.gameState!.guessesRemaining--;
          if (this.gameState!.guessesRemaining <= 0) {
            guessTurnEnded = true;
          }
        }

        if (guessGameOver) {
          gameOver = true;
          winner = guessWinner;
          turnEnded = true;
        } else if (guessTurnEnded) {
          turnEnded = true;
        }

        guessResults.push({
          word,
          cardType,
          correct,
          turnEnded: guessTurnEnded,
          gameOver: guessGameOver,
          winner: guessWinner || undefined,
        });
      }

      if (gameOver) {
        // Record final guesser time before game ends
        this.recordPhaseTime();

        this.gameState!.phase = 'finished';
        this.gameState!.winner = winner;

        // Determine end reason and save to history
        const lastGuessResult = guessResults[guessResults.length - 1];
        let endReason: 'all_found' | 'assassin' | 'opponent_found_all';
        if (lastGuessResult?.cardType === 'assassin' && this.gameState!.assassinBehavior === 'instant_loss') {
          endReason = 'assassin';
        } else if (winner === currentTeam) {
          endReason = 'all_found';
        } else {
          endReason = 'opponent_found_all';
        }
        // Fire and forget - don't block the response
        this.saveCompletedGame(endReason).catch(console.error);
      }

      if (!gameOver) {
        // Always end the turn after the planned number of guesses (or earlier if a guess ended it).
        if (!turnEnded && guessResults.length > 0) {
          guessResults[guessResults.length - 1].turnEnded = true;
        }
        turnEnded = true;
        this.endTurn();
      }

      this.gameState!.updatedAt = Date.now();
      await this.saveState();

      const lastGuess = guessResults[guessResults.length - 1];

      return jsonResponse({
        plan: { reasoning: suggestions.reasoning, rankedWords, guessCount },
        guesses: guessResults,
        guess: lastGuess ? { word: lastGuess.word } : null,
        result: lastGuess || {
          word: '',
          cardType: 'neutral' as CardType,
          correct: false,
          turnEnded,
          gameOver,
          winner: winner || undefined,
        },
        reasoning: suggestions.reasoning,
        gameState: this.getPublicState(),
      });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    } finally {
      this.aiPlayInFlight = false;
    }
  }

  // Helper methods

  private revealRandomCards(team: Team, count: number): void {
    // Find unrevealed cards belonging to the specified team
    const unrevealedTeamIndices: number[] = [];
    for (let i = 0; i < 25; i++) {
      if (!this.gameState!.revealed[i] && this.gameState!.key[i] === team) {
        unrevealedTeamIndices.push(i);
      }
    }

    // Shuffle and pick up to `count` cards to reveal
    const shuffled = unrevealedTeamIndices.sort(() => Math.random() - 0.5);
    const toReveal = shuffled.slice(0, Math.min(count, shuffled.length));

    for (const idx of toReveal) {
      this.gameState!.revealed[idx] = true;
      if (team === 'red') {
        this.gameState!.redRemaining--;
      } else {
        this.gameState!.blueRemaining--;
      }
      // Add to guess history
      this.gameState!.guessHistory.push({
        word: this.gameState!.words[idx],
        cardType: team,
        team: team, // credited to the team that benefits
      });
    }
  }

  private convertNeutralToTeam(team: Team, count: number): void {
    // Find unrevealed neutral cards
    const unrevealedNeutralIndices: number[] = [];
    for (let i = 0; i < 25; i++) {
      if (!this.gameState!.revealed[i] && this.gameState!.key[i] === 'neutral') {
        unrevealedNeutralIndices.push(i);
      }
    }

    // Shuffle and pick up to `count` cards to convert
    const shuffled = unrevealedNeutralIndices.sort(() => Math.random() - 0.5);
    const toConvert = shuffled.slice(0, Math.min(count, shuffled.length));

    for (const idx of toConvert) {
      // Change the key card type to the team's color
      this.gameState!.key[idx] = team;
      // Increase remaining count for that team
      if (team === 'red') {
        this.gameState!.redRemaining++;
      } else {
        this.gameState!.blueRemaining++;
      }
    }
  }

  private endTurn(): void {
    // Record guesser time before switching teams
    this.recordPhaseTime();

    this.gameState!.currentTeam = this.gameState!.currentTeam === 'red' ? 'blue' : 'red';
    this.gameState!.currentClue = null;
    this.gameState!.guessesRemaining = 0;
    this.gameState!.turnPhase = 'clue';
    this.pendingAIClue = null;
    this.pendingAIClueTeam = null;
    this.pendingAIClueLoaded = true;

    // Start timing for next team's spymaster
    this.startPhaseTimer();
    // Reset turn timer for new team's turn
    this.gameState!.turnStartTime = Date.now();

    // Best-effort cleanup; don't block turn progression on storage
    this.state.storage.delete('pendingAIClue').catch(() => {});
  }

  private generateBoard(): string[] {
    const words = [...wordlist.words];
    const shuffled = words.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 25);
  }

  private generateKey(startingTeam: Team): CardType[] {
    const key: CardType[] = [];

    // Starting team gets 9, other gets 8
    const startingCount = 9;
    const otherCount = 8;

    if (startingTeam === 'red') {
      key.push(...new Array(startingCount).fill('red'));
      key.push(...new Array(otherCount).fill('blue'));
    } else {
      key.push(...new Array(otherCount).fill('red'));
      key.push(...new Array(startingCount).fill('blue'));
    }

    key.push(...new Array(7).fill('neutral'));
    key.push('assassin');

    // Shuffle
    return key.sort(() => Math.random() - 0.5);
  }

  private getPublicState(includeKey = false): PublicGameState {
    const gs = this.gameState!;

    // Build revealed types array
    const revealedTypes: (CardType | null)[] = gs.revealed.map((r, i) =>
      r ? gs.key[i] : null
    );

    const publicState: PublicGameState = {
      roomCode: gs.roomCode,
      phase: gs.phase,
      allowHumanAIHelp: gs.allowHumanAIHelp,
      showAIReasoning: gs.showAIReasoning,
      showSpymasterReasoning: gs.showSpymasterReasoning,
      giveAIPastTurnInfo: gs.giveAIPastTurnInfo,
      assassinBehavior: gs.assassinBehavior,
      turnTimer: gs.turnTimer,
      simulationCount: gs.simulationCount,
      simulationModel: gs.simulationModel,
      showSimulationDetails: gs.showSimulationDetails,
      lastSimulationResults: gs.showSimulationDetails ? gs.lastSimulationResults || undefined : undefined,
      roleConfig: gs.roleConfig,
      modelConfig: gs.modelConfig,
      reasoningEffortConfig: gs.reasoningEffortConfig,
      customInstructionsConfig: gs.customInstructionsConfig,
      multiModelConfig: gs.multiModelConfig,
      players: gs.players,
      words: gs.words,
      revealed: gs.revealed,
      revealedTypes,
      currentTeam: gs.currentTeam,
      currentClue: gs.currentClue,
      guessesRemaining: gs.guessesRemaining,
      turnPhase: gs.turnPhase,
      redRemaining: gs.redRemaining,
      blueRemaining: gs.blueRemaining,
      winner: gs.winner,
      clueHistory: gs.clueHistory,
      guessHistory: gs.guessHistory,
      phaseStartTime: gs.phaseStartTime,
      turnStartTime: gs.turnStartTime,
      timing: gs.timing,
      isPaused: gs.isPaused,
      pausedAt: gs.pausedAt,
      createdAt: gs.createdAt,
      updatedAt: gs.updatedAt,
    };

    if (includeKey) {
      publicState.key = gs.key;
    }

    return publicState;
  }

  private async saveState(): Promise<void> {
    await this.state.storage.put('gameState', this.gameState);
  }

  private async saveCompletedGame(endReason: 'all_found' | 'assassin' | 'opponent_found_all'): Promise<void> {
    if (!this.env.GAME_HISTORY) {
      console.log('GAME_HISTORY D1 not configured, skipping save');
      return;
    }

    const gs = this.gameState!;

    // Calculate clue stats for each team
    const calcClueStats = (team: Team) => {
      const teamClues = gs.clueHistory.filter(c => c.team === team);
      const numbers = teamClues.map(c => c.number);
      const count = numbers.length;

      if (count === 0) {
        return { count: 0, avgNumber: 0, stdNumber: 0, clues: [] };
      }

      const avgNumber = numbers.reduce((a, b) => a + b, 0) / count;
      const variance = numbers.reduce((sum, n) => sum + Math.pow(n - avgNumber, 2), 0) / count;
      const stdNumber = Math.sqrt(variance);

      return {
        count,
        avgNumber: Math.round(avgNumber * 100) / 100,
        stdNumber: Math.round(stdNumber * 100) / 100,
        clues: teamClues.map(c => ({ word: c.word, number: c.number })),
      };
    };

    // Count turns per team
    const redTurns = gs.clueHistory.filter(c => c.team === 'red').length;
    const blueTurns = gs.clueHistory.filter(c => c.team === 'blue').length;

    // Build team configs with full multi-model support
    const buildTeamConfig = (team: Team) => {
      const spymasterKey = `${team}Spymaster` as keyof typeof gs.roleConfig;
      const guesserKey = `${team}Guesser` as keyof typeof gs.roleConfig;

      // Get model entries from multiModelConfig
      const spymasterModels = gs.multiModelConfig[spymasterKey] || [];
      const guesserModels = gs.multiModelConfig[guesserKey] || [];

      return {
        spymaster: {
          type: gs.roleConfig[spymasterKey],
          // Keep legacy fields for backwards compatibility
          model: gs.modelConfig[spymasterKey],
          reasoning: gs.reasoningEffortConfig[spymasterKey] || null,
          // New multi-model array
          models: spymasterModels,
        },
        guesser: {
          type: gs.roleConfig[guesserKey],
          // Keep legacy fields for backwards compatibility
          model: gs.modelConfig[guesserKey],
          reasoning: gs.reasoningEffortConfig[guesserKey] || null,
          // New multi-model array
          models: guesserModels,
        },
      };
    };

    // Get player names by team
    const redPlayers = gs.players.filter(p => p.team === 'red').map(p => p.name);
    const bluePlayers = gs.players.filter(p => p.team === 'blue').map(p => p.name);

    const finishedAt = Date.now();
    const durationSeconds = Math.round((finishedAt - gs.createdAt) / 1000);

    try {
      await this.env.GAME_HISTORY.prepare(`
        INSERT INTO game_history (
          room_code, winner, red_final_score, blue_final_score,
          assassin_behavior, red_config, blue_config,
          red_players, blue_players,
          total_turns, red_turns, blue_turns,
          red_clue_stats, blue_clue_stats,
          end_reason, started_at, finished_at, duration_seconds,
          clue_history, timing_stats
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        gs.roomCode,
        gs.winner,
        gs.redRemaining,
        gs.blueRemaining,
        gs.assassinBehavior,
        JSON.stringify(buildTeamConfig('red')),
        JSON.stringify(buildTeamConfig('blue')),
        JSON.stringify(redPlayers),
        JSON.stringify(bluePlayers),
        redTurns + blueTurns,
        redTurns,
        blueTurns,
        JSON.stringify(calcClueStats('red')),
        JSON.stringify(calcClueStats('blue')),
        endReason,
        gs.createdAt,
        finishedAt,
        durationSeconds,
        JSON.stringify(gs.clueHistory),
        JSON.stringify(gs.timing)
      ).run();

      console.log(`Saved completed game ${gs.roomCode} to history`);
    } catch (error) {
      console.error('Failed to save game history:', error);
    }
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
