import { safeUpper } from "./utils";

export interface LegalityResult {
  ok: boolean;
  reason?: string;
}

export function checkClueLegality(clueRaw: string, boardWords: string[]): LegalityResult {
  const clue = safeUpper(clueRaw);

  if (!clue) return { ok: false, reason: "empty_clue" };
  if (/\s/.test(clue)) return { ok: false, reason: "contains_space" };
  // Keep it simple: letters only (no digits, punctuation, hyphens)
  if (!/^[A-Z]+$/.test(clue)) return { ok: false, reason: "non_letters" };

  const boardUpper = boardWords.map(w => safeUpper(w));
  if (boardUpper.includes(clue)) return { ok: false, reason: "clue_is_board_word" };

  // Substring guard (moderate strictness)
  for (const w of boardUpper) {
    if (w.length >= 4 && clue.length >= 4) {
      if (w.includes(clue) || clue.includes(w)) {
        return { ok: false, reason: "substring_overlap" };
      }
    }
  }

  return { ok: true };
}
