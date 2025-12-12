export function spymasterSingleSchema(): any {
  return {
    type: "object",
    properties: {
      clue: { type: "string", description: "A single-word clue (no spaces)." },
      number: { type: "integer", description: "How many words the clue is intended to connect (1-9)." },
      intended_targets: { type: "array", items: { type: "string" }, description: "Which board words you intended the team to guess (analysis only)." },
      danger_words: { type: "array", items: { type: "string" }, description: "Board words you fear the guesser might confuse with the clue." },
    },
    required: ["clue", "number", "intended_targets", "danger_words"],
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
            confidence: { type: "number", description: "Your confidence in this guess (0.0 to 1.0)." },
          },
          required: ["word", "confidence"],
          additionalProperties: false,
        },
        description: "Ordered list of guesses you would attempt this turn. Return fewer to stop early.",
      },
      stop_reason: { type: "string", description: "Why you stopped early (analysis only)." },
    },
    required: ["guesses", "stop_reason"],
    additionalProperties: false,
  };
}
