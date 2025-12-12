import type { CardType, Team } from "./types";

type Msg = { role: "system" | "user"; content: string };

function fmtWords(words: string[]): string {
  return words.length ? words.join(", ") : "(none)";
}

export function spymasterMessages(
  promptId: string,
  boardWords: string[],
  key: CardType[],
  revealed: boolean[],
  team: Team,
): Msg[] {
  const fn = SPYMASTER_PROMPTS[promptId];
  if (!fn) throw new Error(`Unknown spymaster prompt_id: ${promptId}`);

  const yours: string[] = [];
  const opp: string[] = [];
  const neut: string[] = [];
  const assassin: string[] = [];
  const already: string[] = [];

  for (let i = 0; i < boardWords.length; i++) {
    const w = boardWords[i];
    const t = key[i];
    const r = revealed[i];

    if (r) {
      already.push(`${w}(${t})`);
      continue;
    }
    if (t === team) yours.push(w);
    else if (t === "RED" || t === "BLUE") opp.push(w);
    else if (t === "NEUTRAL") neut.push(w);
    else if (t === "ASSASSIN") assassin.push(w);
  }

  const ctx = {
    TEAM: team,
    UNREVEALED_ALL: fmtWords(boardWords.filter((_, i) => !revealed[i])),
    YOUR_WORDS: fmtWords(yours),
    OPP_WORDS: fmtWords(opp),
    NEUTRAL_WORDS: fmtWords(neut),
    ASSASSIN_WORDS: fmtWords(assassin),
    REVEALED_WORDS: fmtWords(already),
    REMAINING_YOURS: String(yours.length),
    REMAINING_OPP: String(opp.length),
  };

  const { system, user } = fn(ctx);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function guesserMessages(
  promptId: string,
  boardWords: string[],
  revealed: boolean[],
  clue: string,
  number: number,
  maxAllowed: number,
): Msg[] {
  const fn = GUESSER_PROMPTS[promptId];
  if (!fn) throw new Error(`Unknown guesser prompt_id: ${promptId}`);

  const unrevealed = boardWords.filter((_, i) => !revealed[i]);
  const revealedWords = boardWords.filter((_, i) => revealed[i]);

  const ctx = {
    UNREVEALED: fmtWords(unrevealed),
    REVEALED: fmtWords(revealedWords),
    CLUE: clue,
    NUMBER: String(number),
    MAX_ALLOWED: String(maxAllowed),
  };

  const { system, user } = fn(ctx);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ---------------------
// Prompt implementations
// ---------------------

function spymaster_v1(ctx: Record<string, string>): { system: string; user: string } {
  const system =
    "You are an expert CODENAMES SPYMASTER.\n" +
    "You know which unrevealed board words belong to your team, the opponent, neutrals, and the assassin.\n" +
    "Your job: output a SINGLE-WORD clue and a number.\n\n" +
    "Rules / constraints:\n" +
    "- Clue must be ONE word (no spaces).\n" +
    "- Do NOT use any board word as the clue.\n" +
    "- Avoid clues that could point to the assassin or opponent words.\n" +
    "- Prefer clues that link 2-3 of your words safely; be conservative if risk is high.\n\n" +
    "Return ONLY the JSON required by the schema.";

  const user =
    `TEAM: ${ctx.TEAM}\n` +
    `Unrevealed words: ${ctx.UNREVEALED_ALL}\n\n` +
    `Your unrevealed words (${ctx.REMAINING_YOURS}): ${ctx.YOUR_WORDS}\n` +
    `Opponent unrevealed words (${ctx.REMAINING_OPP}): ${ctx.OPP_WORDS}\n` +
    `Neutral unrevealed words: ${ctx.NEUTRAL_WORDS}\n` +
    `ASSASSIN unrevealed words: ${ctx.ASSASSIN_WORDS}\n\n` +
    `Already revealed: ${ctx.REVEALED_WORDS}\n\n` +
    "Pick the best safe clue and number for this turn.";

  return { system, user };
}

function spymaster_v2(ctx: Record<string, string>): { system: string; user: string } {
  const system =
    "You are CODENAMES SPYMASTER (high precision).\n" +
    "You must output a single-word clue and an integer number.\n\n" +
    "Goal: maximize correct guesses this turn while minimizing risk.\n" +
    "Hard rules:\n" +
    "- One word clue (letters only; no spaces, no hyphens if avoidable).\n" +
    "- Never output a board word as the clue.\n" +
    "- Never intentionally bait the assassin.\n" +
    "- Number should usually be <= 4 unless the board is extremely safe.\n\n" +
    "Return ONLY JSON per the schema. No extra text.";

  const user =
    `TEAM: ${ctx.TEAM}\n` +
    `YOUR WORDS: ${ctx.YOUR_WORDS}\n` +
    `OPPONENT WORDS: ${ctx.OPP_WORDS}\n` +
    `NEUTRALS: ${ctx.NEUTRAL_WORDS}\n` +
    `ASSASSIN: ${ctx.ASSASSIN_WORDS}\n` +
    `ALREADY REVEALED: ${ctx.REVEALED_WORDS}\n\n` +
    "Choose a clue that best connects a subset of YOUR WORDS while being far from the assassin and opponent words.";

  return { system, user };
}

function guesser_v1(ctx: Record<string, string>): { system: string; user: string } {
  const system =
    "You are a CODENAMES GUESSER.\n" +
    "You only see the board words and the spymaster's clue + number.\n" +
    "You must propose an ordered list of guesses (0 to MAX_ALLOWED guesses).\n\n" +
    "Guidelines:\n" +
    "- Guess only from the unrevealed board words.\n" +
    "- You may return fewer than MAX_ALLOWED guesses to stop early.\n" +
    "- Be cautious: if uncertain, stop rather than guessing randomly.\n\n" +
    "Return ONLY JSON that matches the provided schema.";

  const user =
    `UNREVEALED WORDS: ${ctx.UNREVEALED}\n` +
    `REVEALED WORDS: ${ctx.REVEALED}\n\n` +
    `CLUE: ${ctx.CLUE}\n` +
    `NUMBER: ${ctx.NUMBER}\n` +
    `MAX_ALLOWED_GUESSES_THIS_TURN: ${ctx.MAX_ALLOWED}\n\n` +
    "Provide the ordered list of guesses you would attempt now.";

  return { system, user };
}

function guesser_v2(ctx: Record<string, string>): { system: string; user: string } {
  const system =
    "You are a CODENAMES GUESSER (conservative stop policy).\n" +
    "Return an ordered list of guesses you would attempt now.\n\n" +
    "Rules:\n" +
    "- Only choose from the unrevealed words.\n" +
    "- Stop early unless you are confident.\n" +
    "- Prefer 1-2 high-confidence guesses over using the full limit.\n\n" +
    "Return ONLY JSON per schema.";

  const user =
    `UNREVEALED: ${ctx.UNREVEALED}\n` +
    `CLUE: ${ctx.CLUE}  NUMBER: ${ctx.NUMBER}  MAX_ALLOWED: ${ctx.MAX_ALLOWED}\n` +
    "Output guesses now.";

  return { system, user };
}

const SPYMASTER_PROMPTS: Record<string, (ctx: Record<string, string>) => { system: string; user: string }> = {
  spymaster_v1,
  spymaster_v2,
};

const GUESSER_PROMPTS: Record<string, (ctx: Record<string, string>) => { system: string; user: string }> = {
  guesser_v1,
  guesser_v2,
};
