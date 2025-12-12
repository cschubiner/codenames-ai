export function spymasterSingleSchema(): any {
  return {
    type: "object",
    properties: {
      clue: { type: "string", description: "A single-word clue (no spaces)." },
      number: { type: "integer", minimum: 1, maximum: 9, description: "How many words the clue is intended to connect (1-9)." },
      intended_targets: { type: "array", items: { type: "string" }, description: "Optional: which board words you intended the team to guess (analysis only)." },
      danger_words: { type: "array", items: { type: "string" }, description: "Optional: board words you fear the guesser might confuse with the clue." },
    },
    required: ["clue", "number"],
    additionalProperties: false,
  };
}

export function spymasterListSchema(maxCandidates: number): any {
  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: spymasterSingleSchema(),
        minItems: 1,
        maxItems: maxCandidates,
        description: "List of candidate clues. Prefer unique clues.",
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  };
}

export function guesserSchema(unrevealedWords: string[], maxGuesses: number): any {
  const enumWords = Array.from(new Set(unrevealedWords));
  return {
    type: "object",
    properties: {
      guesses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            word: { type: "string", enum: enumWords, description: "One of the unrevealed board words." },
            confidence: { type: "number", minimum: 0.0, maximum: 1.0, description: "Your confidence in this guess." },
          },
          required: ["word", "confidence"],
          additionalProperties: false,
        },
        minItems: 0,
        maxItems: maxGuesses,
        description: "Ordered list of guesses you would attempt this turn. Return fewer to stop early.",
      },
      stop_reason: { type: "string", description: "Optional: why you stopped early (analysis only)." },
    },
    required: ["guesses"],
    additionalProperties: false,
  };
}
