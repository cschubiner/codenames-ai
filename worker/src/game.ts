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

      if (method === 'POST' && path === '/ai-clue') {
        return this.handleAIClue(request);
      }

      if (method === 'POST' && path === '/ai-suggest') {
        return this.handleAISuggest(request);
      }

      if (method === 'POST' && path === '/ai-play') {
        return this.handleAIPlay();
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Error handling request:', error);
      return jsonResponse({ error: String(error) }, 500);
    }
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

    const body = await request.json() as { roleConfig: RoleConfig; modelConfig?: ModelConfig };
    this.gameState!.roleConfig = body.roleConfig;
    if (body.modelConfig) {
      this.gameState!.modelConfig = body.modelConfig;
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

    if (body.number < 1 || body.number > 9) {
      return jsonResponse({ error: 'Number must be 1-9' }, 400);
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

    // If confirming a pending clue
    if (body.confirm && this.pendingAIClue) {
      if (this.pendingAIClueTeam && this.pendingAIClueTeam !== team) {
        // Turn advanced while the clue was pending; discard to avoid applying to wrong team.
        this.pendingAIClue = null;
        this.pendingAIClueTeam = null;
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

      await this.saveState();

      return jsonResponse({
        confirmed: true,
        clue: confirmedClue,
        gameState: this.getPublicState(),
      });
    }

    // Generate a new AI clue
    try {
      // Get the configured model for this team's spymaster
      const modelKey = `${team}Spymaster` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];

      const aiClue = await generateAIClue(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        team,
        model
      );

      this.pendingAIClue = aiClue;
      this.pendingAIClueTeam = team;

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

    try {
      // Get the configured model for this team's guesser
      const modelKey = `${clue.team}Guesser` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];

      const suggestions = await generateAIGuesses(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        clue.word,
        clue.number,
        clue.team,
        model
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

    try {
      // Get the configured model for this team's guesser
      const modelKey = `${expectedClue.team}Guesser` as keyof ModelConfig;
      const model = this.gameState!.modelConfig[modelKey];

      // Get AI suggestions
      const suggestions = await generateAIGuesses(
        this.env.OPENAI_API_KEY,
        this.gameState!,
        expectedClue.word,
        expectedClue.number,
        expectedClue.team,
        model
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

      // Find the first valid suggestion (word on board and not revealed)
      let topGuess = null;
      let wordIndex = -1;

      for (const suggestion of suggestions.suggestions) {
        const wordUpper = suggestion.word.toUpperCase();
        const idx = this.gameState!.words.findIndex(
          w => w.toUpperCase() === wordUpper
        );

        if (idx !== -1 && !this.gameState!.revealed[idx]) {
          topGuess = suggestion;
          wordIndex = idx;
          break;
        }
      }

      if (!topGuess || wordIndex === -1) {
        return jsonResponse({ error: 'AI could not find a valid word to guess' }, 500);
      }

      // Reveal the card
      this.gameState!.revealed[wordIndex] = true;
      const cardType = this.gameState!.key[wordIndex];
      const currentTeam = this.gameState!.currentTeam;

      if (cardType === 'red') this.gameState!.redRemaining--;
      if (cardType === 'blue') this.gameState!.blueRemaining--;

      this.gameState!.guessHistory.push({
        word: topGuess.word,
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
        (lastClue.guesses ??= []).push({ word: topGuess.word, cardType });
      }

      const correct = cardType === currentTeam;
      let turnEnded = false;
      let gameOver = false;
      let winner: Team | null = null;

      if (cardType === 'assassin') {
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

      return jsonResponse({
        guess: topGuess,
        result: {
          word: topGuess.word,
          cardType,
          correct,
          turnEnded,
          gameOver,
          winner,
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
      roleConfig: gs.roleConfig,
      modelConfig: gs.modelConfig,
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
