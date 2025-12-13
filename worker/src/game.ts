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
  GuessResult,
  AIClueCandidate,
} from './types';
import { generateAIClue, generateAIGuesses } from './ai';

// Word list (subset for the worker - full list loaded from shared/)
import wordlist from '../../shared/wordlist.json';

interface Env {
  OPENAI_API_KEY?: string;
}

export class GameRoom {
  private state: DurableObjectState;
  private env: Env;
  private gameState: GameState | null = null;
  private pendingAIClue: AIClueCandidate | null = null;
  private pendingAIClueTeam: Team | null = null;
  private pendingAIClueLoaded = false;

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

    if (!Array.isArray(gs.players)) gs.players = [];
    if (!Array.isArray(gs.clueHistory)) gs.clueHistory = [];
    if (!Array.isArray(gs.guessHistory)) gs.guessHistory = [];

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
      players: [],
      words,
      key,
      revealed: new Array(25).fill(false),
      currentTeam: 'red',
      currentClue: null,
      guessesRemaining: 0,
      redRemaining: 9,
      blueRemaining: 8,
      winner: null,
      clueHistory: [],
      guessHistory: [],
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
    const team = url.searchParams.get('team') as Team | null;

    const isSpymaster = role === 'spymaster';
    return jsonResponse({
      gameState: this.getPublicState(isSpymaster),
    });
  }

  private async handleConfigure(request: Request): Promise<Response> {
    if (this.gameState!.phase !== 'setup') {
      return jsonResponse({ error: 'Can only configure during setup' }, 400);
    }

    const body = await request.json() as { roleConfig: RoleConfig; modelConfig?: ModelConfig; reasoningEffortConfig?: ReasoningEffortConfig; customInstructionsConfig?: CustomInstructionsConfig; allowHumanAIHelp?: boolean };
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
    if (typeof body.allowHumanAIHelp === 'boolean') {
      this.gameState!.allowHumanAIHelp = body.allowHumanAIHelp;
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
    this.gameState!.updatedAt = Date.now();

    await this.saveState();

    return jsonResponse({ gameState: this.getPublicState() });
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
      // Assassin - guessing team loses
      gameOver = true;
      winner = currentTeam === 'red' ? 'blue' : 'red';
      turnEnded = true;
    } else if (this.gameState!.redRemaining === 0) {
      gameOver = true;
      winner = 'red';
      turnEnded = true;
    } else if (this.gameState!.blueRemaining === 0) {
      gameOver = true;
      winner = 'blue';
      turnEnded = true;
    } else if (!correct) {
      turnEnded = true;
    } else {
      this.gameState!.guessesRemaining--;
      if (this.gameState!.guessesRemaining <= 0) {
        turnEnded = true;
      }
    }

    if (gameOver) {
      this.gameState!.phase = 'finished';
      this.gameState!.winner = winner;
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

  private async handleAIClue(request: Request): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }

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

    // If confirming a pending clue
    if (body.confirm) {
      if (!this.pendingAIClueLoaded) {
        const stored = await this.state.storage.get('pendingAIClue') as { clue: AIClueCandidate; team: Team } | null;
        if (stored?.clue && stored?.team) {
          this.pendingAIClue = stored.clue;
          this.pendingAIClueTeam = stored.team;
        }
        this.pendingAIClueLoaded = true;
      }
    }

    if (body.confirm && this.pendingAIClue) {
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
        guesses: [],
      };

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

    // Generate a new AI clue
    try {
      // Get the configured model, reasoning effort, and custom instructions for this team's spymaster
      const modelKey = `${team}Spymaster` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];
      const reasoningEffort = this.gameState!.reasoningEffortConfig[modelKey];
      const customInstructions = this.gameState!.customInstructionsConfig[modelKey];

      const aiClue = await generateAIClue(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        team,
        model,
        reasoningEffort,
        customInstructions
      );

      this.pendingAIClue = aiClue;
      this.pendingAIClueTeam = team;
      this.pendingAIClueLoaded = true;
      await this.state.storage.put('pendingAIClue', { clue: aiClue, team });

      return jsonResponse({
        clue: aiClue,
        message: 'AI generated a clue. Call with confirm=true to submit it.',
        gameState: this.getPublicState(),
      });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleAISuggest(request: Request): Promise<Response> {
    if (!this.env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'OpenAI API key not configured' }, 500);
    }

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
      // Get the configured model, reasoning effort, and custom instructions for this team's guesser
      const modelKey = `${clue.team}Guesser` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];
      const reasoningEffort = this.gameState!.reasoningEffortConfig[modelKey];
      const customInstructions = this.gameState!.customInstructionsConfig[modelKey];

      const suggestions = await generateAIGuesses(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        clue.word,
        clue.number,
        clue.team,
        model,
        reasoningEffort,
        customInstructions
      );

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
      // Get the configured model, reasoning effort, and custom instructions for this team's guesser
      const modelKey = `${expectedClue.team}Guesser` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];
      const reasoningEffort = this.gameState!.reasoningEffortConfig[modelKey];
      const customInstructions = this.gameState!.customInstructionsConfig[modelKey];

      // Get AI suggestions
      const suggestions = await generateAIGuesses(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        expectedClue.word,
        expectedClue.number,
        expectedClue.team,
        model,
        reasoningEffort,
        customInstructions
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

      const rawStopAfter = Number.isInteger(suggestions.stopAfter) ? suggestions.stopAfter : 0;
      const guessCount = Math.max(
        0,
        Math.min(
          rawStopAfter > 0 ? rawStopAfter : this.gameState!.guessesRemaining,
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
          guessGameOver = true;
          guessWinner = currentTeam === 'red' ? 'blue' : 'red';
          guessTurnEnded = true;
        } else if (this.gameState!.redRemaining === 0) {
          guessGameOver = true;
          guessWinner = 'red';
          guessTurnEnded = true;
        } else if (this.gameState!.blueRemaining === 0) {
          guessGameOver = true;
          guessWinner = 'blue';
          guessTurnEnded = true;
        } else if (!correct) {
          guessTurnEnded = true;
        } else {
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
        this.gameState!.phase = 'finished';
        this.gameState!.winner = winner;
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
    }
  }

  // Helper methods

  private endTurn(): void {
    this.gameState!.currentTeam = this.gameState!.currentTeam === 'red' ? 'blue' : 'red';
    this.gameState!.currentClue = null;
    this.gameState!.guessesRemaining = 0;
    this.pendingAIClue = null;
    this.pendingAIClueTeam = null;
    this.pendingAIClueLoaded = true;
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
      roleConfig: gs.roleConfig,
      modelConfig: gs.modelConfig,
      reasoningEffortConfig: gs.reasoningEffortConfig,
      customInstructionsConfig: gs.customInstructionsConfig,
      players: gs.players,
      words: gs.words,
      revealed: gs.revealed,
      revealedTypes,
      currentTeam: gs.currentTeam,
      currentClue: gs.currentClue,
      guessesRemaining: gs.guessesRemaining,
      redRemaining: gs.redRemaining,
      blueRemaining: gs.blueRemaining,
      winner: gs.winner,
      clueHistory: gs.clueHistory,
      guessHistory: gs.guessHistory,
    };

    if (includeKey) {
      publicState.key = gs.key;
    }

    return publicState;
  }

  private async saveState(): Promise<void> {
    await this.state.storage.put('gameState', this.gameState);
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
