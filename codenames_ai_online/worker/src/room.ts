import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "./cors";
import { jsonResponse, nowMs, randomToken, safeUpper } from "./utils";
import type { GameStateInternal, GameStatePublic, Player, Team } from "./types";
import { makeNewGame, otherTeam, checkWinner } from "./game";
import { getPreset } from "./presets";
import { pickBestClueForTeam } from "./agent";
import { guesserMessages } from "./prompts";
import { guesserSchema } from "./schemas";
import { callOpenAIJsonSchema } from "./openai";
import { clamp, uniq } from "./utils";

interface InitBody {
  room_id: string;
  red_agent: string;
  blue_agent: string;
}

interface JoinBody {
  name: string;
  team: Team | "SPECTATOR";
}

interface AuthedBody {
  player_id: string;
  token: string;
}

interface GuessBody extends AuthedBody {
  word: string;
}

export class CodenamesRoom {
  private state: DurableObjectState;
  private env: Env;

  private generatingClue: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    try {
      if (path === "/init" && request.method === "POST") {
        const body = (await request.json()) as InitBody;
        await this.handleInit(body);
        return jsonResponse({ ok: true });
      }

      const game = await this.load();
      if (!game) return jsonResponse({ error: "room_not_initialized" }, { status: 400 });

      if (path === "/join" && request.method === "POST") {
        const body = (await request.json()) as JoinBody;
        const res = await this.handleJoin(game, body);
        return jsonResponse(res);
      }

      if (path === "/state" && request.method === "GET") {
        // If clue generation is pending, kick it off opportunistically.
        await this.kickoffClueGenerationIfNeeded(game);
        const fresh = (await this.load()) ?? game;
        return jsonResponse(this.toPublic(fresh));
      }

      if (path === "/guess" && request.method === "POST") {
        const body = (await request.json()) as GuessBody;
        const res = await this.handleGuess(game, body);
        return jsonResponse(res);
      }

      if (path === "/stop" && request.method === "POST") {
        const body = (await request.json()) as AuthedBody;
        const res = await this.handleStop(game, body);
        return jsonResponse(res);
      }

      if (path === "/ai_guess" && request.method === "POST") {
        const body = (await request.json()) as AuthedBody;
        const res = await this.handleAIGuess(game, body);
        return jsonResponse(res);
      }

      if (path === "/ai_play_next" && request.method === "POST") {
        const body = (await request.json()) as AuthedBody;
        const res = await this.handleAIPlayNext(game, body);
        return jsonResponse(res);
      }

      if (path === "/reset" && request.method === "POST") {
        const body = (await request.json()) as AuthedBody;
        const res = await this.handleReset(game, body);
        return jsonResponse(res);
      }

      return jsonResponse({ error: "not_found", path }, { status: 404 });
    } catch (e: any) {
      return jsonResponse({ error: "exception", message: String(e?.message ?? e) }, { status: 500 });
    }
  }

  // --------------------
  // Storage
  // --------------------

  private async load(): Promise<GameStateInternal | undefined> {
    return (await this.state.storage.get("game")) as GameStateInternal | undefined;
  }

  private async save(game: GameStateInternal): Promise<void> {
    game.version = (game.version ?? 0) + 1;
    await this.state.storage.put("game", game);
  }

  private toPublic(game: GameStateInternal): GameStatePublic {
    return {
      room_id: game.room_id,
      created_at: game.created_at,

      red_agent: game.red_agent,
      blue_agent: game.blue_agent,

      board_words: game.board_words,
      revealed: game.revealed,

      starting_team: game.starting_team,
      turn: game.turn,
      clue: game.clue,
      guesses_made_this_turn: game.guesses_made_this_turn,
      max_guesses_this_turn: game.max_guesses_this_turn,

      ended: game.ended,
      winner: game.winner,

      players: game.players.map(p => ({ id: p.id, name: p.name, team: p.team, joined_at: p.joined_at })),
      history: game.history.slice(-200),
      version: game.version,
    };
  }

  // --------------------
  // Handlers
  // --------------------

  private async handleInit(body: InitBody): Promise<void> {
    const roomId = body.room_id;
    // Validate presets exist.
    getPreset(body.red_agent);
    getPreset(body.blue_agent);

    const game = makeNewGame(roomId, body.red_agent, body.blue_agent);
    await this.state.storage.put("game", game);

    // Kick off clue generation immediately
    await this.kickoffClueGenerationIfNeeded(game);
  }

  private async handleJoin(game: GameStateInternal, body: JoinBody): Promise<any> {
    const name = (body.name || "Player").trim().slice(0, 32);
    const team = body.team ?? "SPECTATOR";

    const playerId = randomToken(8);
    const token = randomToken(16);

    const p: Player = { id: playerId, token, name, team, joined_at: nowMs() };
    game.players.push(p);
    game.history.push({ t: "player_joined", at: nowMs(), player_id: playerId, name, team });
    await this.save(game);

    return { player_id: playerId, token, team, name };
  }

  private auth(game: GameStateInternal, body: AuthedBody): Player {
    const pid = body.player_id;
    const tok = body.token;
    const p = game.players.find(x => x.id === pid);
    if (!p) throw new Error("unknown_player");
    if (p.token !== tok) throw new Error("bad_token");
    return p;
  }

  private async handleGuess(game: GameStateInternal, body: GuessBody): Promise<GameStatePublic> {
    const p = this.auth(game, body);

    if (game.ended) return this.toPublic(game);
    if (game.clue.status !== "ready") throw new Error("clue_not_ready");
    if (p.team !== game.turn) throw new Error("not_your_turn");

    const word = safeUpper(body.word);
    const idx = game.board_words.indexOf(word);
    if (idx < 0) throw new Error("word_not_on_board");
    if (game.revealed[idx]) throw new Error("already_revealed");

    // Reveal
    game.revealed[idx] = true;
    const card = game.key[idx];

    game.history.push({ t: "guess", at: nowMs(), team: game.turn, word, result: card, by: p.id });
    game.guesses_made_this_turn += 1;

    // Check immediate end conditions
    if (card === "ASSASSIN") {
      game.ended = true;
      game.winner = otherTeam(game.turn);
      game.history.push({ t: "game_end", at: nowMs(), winner: game.winner, reason: "assassin" });
      await this.save(game);
      return this.toPublic(game);
    }

    const winner = checkWinner(game);
    if (winner) {
      game.ended = true;
      game.winner = winner;
      game.history.push({ t: "game_end", at: nowMs(), winner, reason: "all_words_revealed" });
      await this.save(game);
      return this.toPublic(game);
    }

    // End turn rules
    const hitWrong = card !== game.turn;
    const hitLimit = game.guesses_made_this_turn >= game.max_guesses_this_turn;

    if (hitWrong || hitLimit) {
      const next = otherTeam(game.turn);
      const reason = hitWrong ? "wrong_color" : "max_guesses";
      game.history.push({ t: "turn_end", at: nowMs(), next_team: next, reason });

      game.turn = next;
      game.clue = { status: "pending", team: next };
      game.guesses_made_this_turn = 0;
      game.max_guesses_this_turn = 0;

      await this.save(game);
      await this.kickoffClueGenerationIfNeeded(game);
      const fresh = (await this.load()) ?? game;
      return this.toPublic(fresh);
    }

    await this.save(game);
    return this.toPublic(game);
  }

  private async handleStop(game: GameStateInternal, body: AuthedBody): Promise<GameStatePublic> {
    const p = this.auth(game, body);

    if (game.ended) return this.toPublic(game);
    if (game.clue.status !== "ready") throw new Error("clue_not_ready");
    if (p.team !== game.turn) throw new Error("not_your_turn");

    game.history.push({ t: "stop", at: nowMs(), team: game.turn, by: p.id });

    const next = otherTeam(game.turn);
    game.history.push({ t: "turn_end", at: nowMs(), next_team: next, reason: "stop" });

    game.turn = next;
    game.clue = { status: "pending", team: next };
    game.guesses_made_this_turn = 0;
    game.max_guesses_this_turn = 0;

    await this.save(game);
    await this.kickoffClueGenerationIfNeeded(game);
    const fresh = (await this.load()) ?? game;
    return this.toPublic(fresh);
  }

  private async handleReset(game: GameStateInternal, body: AuthedBody): Promise<GameStatePublic> {
    // Anyone in the room can reset (simple). You can tighten this later.
    this.auth(game, body);

    const players = game.players;
    const newGame = makeNewGame(game.room_id, game.red_agent, game.blue_agent);
    newGame.players = players;
    newGame.history.push({ t: "reset", at: nowMs(), by: body.player_id });

    await this.state.storage.put("game", newGame);
    await this.kickoffClueGenerationIfNeeded(newGame);
    const fresh = (await this.load()) ?? newGame;
    return this.toPublic(fresh);
  }

  private async handleAIGuess(game: GameStateInternal, body: AuthedBody): Promise<any> {
    const p = this.auth(game, body);
    if (game.ended) return { ended: true, state: this.toPublic(game) };

    if (game.clue.status !== "ready") throw new Error("clue_not_ready");

    const activeTeam = game.turn;
    const agentId = activeTeam === "RED" ? game.red_agent : game.blue_agent;
    const agent = getPreset(agentId);

    const clue = game.clue.clue ?? "";
    const number = game.clue.number ?? 1;
    const remainingAllowed = clamp(game.max_guesses_this_turn - game.guesses_made_this_turn, 0, 10);

    const unrevealedWords = game.board_words.filter((_, i) => !game.revealed[i]);
    const msgs = guesserMessages(agent.guesser.prompt_id, game.board_words, game.revealed, clue, number, remainingAllowed);
    const schema = guesserSchema(unrevealedWords, remainingAllowed);

    const out = await callOpenAIJsonSchema<{ guesses: Array<{ word: string; confidence: number }>; stop_reason?: string }>(
      this.env,
      {
        model: agent.guesser.model,
        input: msgs,
        temperature: agent.guesser.temperature,
        top_p: agent.guesser.top_p,
        max_output_tokens: agent.guesser.max_output_tokens,
        schema_name: "guesser_output",
        schema,
        store: false,
      },
    );

    const rawGuesses = (out?.guesses ?? [])
      .map(g => ({ word: safeUpper(g.word), confidence: g.confidence }))
      .filter(g => unrevealedWords.includes(g.word));

    const seen = new Set<string>();
    const guesses: Array<{ word: string; confidence: number }> = [];
    for (const g of rawGuesses) {
      if (seen.has(g.word)) continue;
      seen.add(g.word);
      guesses.push(g);
    }

    return {
      can_play: p.team === activeTeam,
      team_for_clue: activeTeam,
      clue,
      number,
      remaining_allowed: remainingAllowed,
      guesses,
      stop_reason: out?.stop_reason ?? "",
    };
  }

  private async handleAIPlayNext(game: GameStateInternal, body: AuthedBody): Promise<GameStatePublic> {
    const p = this.auth(game, body);
    if (game.ended) return this.toPublic(game);
    if (game.clue.status !== "ready") throw new Error("clue_not_ready");
    if (p.team !== game.turn) throw new Error("not_your_turn");

    const sug = await this.handleAIGuess(game, body);
    const nextWord = sug?.guesses?.[0]?.word;
    if (!nextWord) throw new Error("ai_no_guess");

    // Re-load latest state (since handleAIGuess didn't mutate but it may be stale)
    const fresh = (await this.load()) ?? game;
    return await this.handleGuess(fresh, { ...body, word: nextWord });
  }

  // --------------------
  // Clue generation
  // --------------------

  private async kickoffClueGenerationIfNeeded(game: GameStateInternal): Promise<void> {
    if (game.ended) return;
    if (game.clue.status !== "pending") return;
    if (this.generatingClue) return;

    this.generatingClue = true;
    const team = game.turn;
    const startVersion = game.version;

    // Run in background; DOs usually stay alive while doing I/O, but we still use waitUntil for clarity.
    this.state.waitUntil(this.generateAndStoreClue(team, startVersion));
  }

  private async generateAndStoreClue(team: Team, startVersion: number): Promise<void> {
    try {
      const before = await this.load();
      if (!before) return;
      if (before.ended) return;
      if (before.turn !== team) return;
      if (before.clue.status !== "pending") return;

      const agentId = team === "RED" ? before.red_agent : before.blue_agent;
      const agent = getPreset(agentId);

      const picked = await pickBestClueForTeam(
        this.env,
        agent,
        before.board_words,
        before.key,
        before.revealed,
        team,
      );

      // Reload state before committing, to avoid overwriting a reset/turn change.
      const latest = await this.load();
      if (!latest) return;
      if (latest.ended) return;
      if (latest.turn !== team) return;
      if (latest.clue.status !== "pending") return;

      latest.clue = {
        status: "ready",
        team,
        clue: picked.clue,
        number: picked.number,
        generated_at: nowMs(),
        picked_index: picked.picked_index,
      };
      latest.guesses_made_this_turn = 0;
      latest.max_guesses_this_turn = clamp(picked.number + 1, 0, 10);

      latest.history.push({ t: "clue_ready", at: nowMs(), team, clue: picked.clue, number: picked.number });

      await this.save(latest);
    } catch (e) {
      // Fallback: put a safe clue so the game doesn't brick.
      const latest = await this.load();
      if (latest && !latest.ended && latest.clue.status === "pending") {
        latest.clue = { status: "ready", team: latest.turn, clue: "SKIP", number: 1, generated_at: nowMs() };
        latest.max_guesses_this_turn = 2;
        latest.history.push({ t: "clue_ready", at: nowMs(), team: latest.turn, clue: "SKIP", number: 1 });
        await this.save(latest);
      }
    } finally {
      this.generatingClue = false;
    }
  }
}
