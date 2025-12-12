import type { CardType, GameStateInternal, Team } from "./types";
import { clamp } from "./utils";
import { WORDS } from "./wordlist";

export function otherTeam(t: Team): Team {
  return t === "RED" ? "BLUE" : "RED";
}

export function makeNewGame(roomId: string, redAgent: string, blueAgent: string): GameStateInternal {
  const created = Date.now();

  const boardWords = sampleWords(25);
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  const startingTeam: Team = (b[0] & 1) === 0 ? "RED" : "BLUE";
  const key = makeKey(startingTeam);

  return {
    room_id: roomId,
    created_at: created,
    red_agent: redAgent,
    blue_agent: blueAgent,

    board_words: boardWords,
    key,
    revealed: Array(boardWords.length).fill(false),

    starting_team: startingTeam,
    turn: startingTeam,

    clue: { status: "pending", team: startingTeam },
    guesses_made_this_turn: 0,
    max_guesses_this_turn: 0,

    ended: false,
    winner: undefined,

    players: [],
    history: [{ t: "room_created", at: created }],
    version: 1,
  };
}

function sampleWords(n: number): string[] {
  if (WORDS.length < n) throw new Error("Wordlist too small");
  const idxs = [...Array(WORDS.length).keys()];
  shuffleInPlace(idxs);
  return idxs.slice(0, n).map(i => WORDS[i]);
}

function makeKey(startingTeam: Team): CardType[] {
  const other = otherTeam(startingTeam);

  // 25 cards: 9 for starting team, 8 for other, 7 neutral, 1 assassin
  const labels: CardType[] = [];
  labels.push(...Array(9).fill(startingTeam));
  labels.push(...Array(8).fill(other));
  labels.push(...Array(7).fill("NEUTRAL"));
  labels.push("ASSASSIN");
  shuffleInPlace(labels);
  return labels;
}

// Fisher-Yates shuffle using crypto randomness
function shuffleInPlace<T>(arr: T[]): void {
  const n = arr.length;
  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);
  for (let i = n - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export interface AppliedGuess {
  word: string;
  index: number;
  card_type: CardType;
}

export interface SimTurnResult {
  applied: AppliedGuess[];
  ended_turn: boolean;
  reason: string;
  hit_assassin: boolean;
}

/**
 * Simulate a guessing turn *without* mutating inputs.
 * - Stops on first non-team card.
 * - Stops once it hits maxAllowed guesses.
 */
export function simulateTurn(
  boardWords: string[],
  key: CardType[],
  revealed: boolean[],
  team: Team,
  guesses: string[],
  maxAllowed: number,
): SimTurnResult {
  const applied: AppliedGuess[] = [];
  const maxG = clamp(maxAllowed, 0, 10);

  for (let gi = 0; gi < guesses.length && applied.length < maxG; gi++) {
    const word = guesses[gi];
    const idx = boardWords.indexOf(word);
    if (idx < 0) continue;
    if (revealed[idx]) continue;

    const card = key[idx];
    applied.push({ word, index: idx, card_type: card });

    if (card === "ASSASSIN") {
      return { applied, ended_turn: true, reason: "assassin", hit_assassin: true };
    }
    if (card !== team) {
      return { applied, ended_turn: true, reason: "wrong_color", hit_assassin: false };
    }
  }

  return { applied, ended_turn: applied.length >= maxG, reason: "limit_or_stop", hit_assassin: false };
}

export function remainingCount(state: GameStateInternal, team: Team): number {
  let rem = 0;
  for (let i = 0; i < state.board_words.length; i++) {
    if (state.revealed[i]) continue;
    if (state.key[i] === team) rem++;
  }
  return rem;
}

export function checkWinner(state: GameStateInternal): Team | undefined {
  const redRem = remainingCount(state, "RED");
  const blueRem = remainingCount(state, "BLUE");
  if (redRem === 0) return "RED";
  if (blueRem === 0) return "BLUE";
  return undefined;
}
