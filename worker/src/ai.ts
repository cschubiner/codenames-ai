/**
 * AI integration for Codenames - OpenAI API calls
 *
 * Supports both synchronous Chat Completions API and async Responses API with background mode
 * for long-running reasoning models.
 */

import {
  GameState,
  Team,
  CardType,
  AIClueCandidate,
  AIGuessResponse,
  ClueSimulationResult,
  SimulationEvaluationResult,
  AssassinBehavior,
  ModelEntry,
} from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Response from Responses API
interface ResponsesAPIResponse {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
  error?: {
    message: string;
  };
}

// Models that support reasoning_effort parameter
const REASONING_MODELS = ['gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'o3', 'o4-mini', 'o3-mini', 'o1', 'o1-mini'];

// Models that require background mode (very long reasoning times)
const BACKGROUND_MODE_MODELS = ['gpt-5.2-pro', 'o3', 'o1-pro'];

/**
 * Call OpenAI Chat Completions API with structured output (synchronous)
 */
async function callChatCompletions(
  apiKey: string,
  messages: OpenAIMessage[],
  jsonSchema: object,
  model: string = 'gpt-4o-mini',
  temperature: number = 0.7,
  reasoningEffort?: string
): Promise<any> {
  const isReasoningModel = REASONING_MODELS.some(m => model.startsWith(m));

  const body: any = {
    model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: jsonSchema,
    },
  };

  // Only add temperature for non-reasoning models
  if (!isReasoningModel) {
    body.temperature = temperature;
  }

  // Add reasoning_effort for reasoning models
  if (isReasoningModel && reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${error}`);
  }

  const data = await response.json() as OpenAIResponse;
  return JSON.parse(data.choices[0].message.content);
}

/**
 * Start a background request using OpenAI Responses API
 * Returns the response ID for polling
 */
export async function startBackgroundRequest(
  apiKey: string,
  messages: OpenAIMessage[],
  jsonSchema: { name: string; schema: object; strict?: boolean },
  model: string,
  reasoningEffort?: string
): Promise<string> {
  const body: any = {
    model,
    input: messages,
    text: {
      format: {
        type: 'json_schema',
        name: jsonSchema.name,
        schema: jsonSchema.schema,
        strict: jsonSchema.strict ?? true,
      },
    },
    background: true,
    store: true, // Required for background mode
  };

  // Add reasoning_effort for reasoning models
  const isReasoningModel = REASONING_MODELS.some(m => model.startsWith(m));
  if (isReasoningModel && reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI Responses API error ${response.status}: ${error}`);
  }

  const data = await response.json() as ResponsesAPIResponse;
  return data.id;
}

/**
 * Poll for background request result
 * Returns null if still processing, throws on error, returns result on completion
 */
export async function pollBackgroundRequest(
  apiKey: string,
  responseId: string
): Promise<{ status: 'queued' | 'in_progress' | 'completed' | 'failed'; result?: any; error?: string }> {
  const response = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI poll error ${response.status}: ${error}`);
  }

  const data = await response.json() as ResponsesAPIResponse;

  if (data.status === 'failed') {
    return { status: 'failed', error: data.error?.message || 'Unknown error' };
  }

  if (data.status === 'completed') {
    // Extract the text content from the response
    const textOutput = data.output?.find(o => o.type === 'message');
    const textContent = textOutput?.content?.find(c => c.type === 'output_text');
    if (textContent?.text) {
      return { status: 'completed', result: JSON.parse(textContent.text) };
    }
    return { status: 'failed', error: 'No text content in response' };
  }

  return { status: data.status };
}

/**
 * Check if a model requires background mode
 */
export function requiresBackgroundMode(model: string): boolean {
  return BACKGROUND_MODE_MODELS.some(m => model.startsWith(m));
}

/**
 * Build turn history section for spymaster prompt
 * Shows past clues given by this spymaster and how guessers responded
 */
function buildSpymasterHistorySection(gameState: GameState, team: Team): string {
  const teamClues = gameState.clueHistory.filter(c => c.team === team);

  if (teamClues.length === 0) {
    return '';
  }

  let section = `\n## Your Past Clues This Game\n`;
  section += `Understanding what clues you've already given helps avoid redundancy and track "outstanding" hints.\n\n`;

  for (const clue of teamClues) {
    const guessedCount = clue.guesses?.length || 0;
    const correctGuesses = clue.guesses?.filter(g => g.cardType === team) || [];
    const wrongGuesses = clue.guesses?.filter(g => g.cardType !== team) || [];
    const outstandingCount = clue.number - correctGuesses.length;

    section += `### Clue: "${clue.word}" for ${clue.number}\n`;
    if (clue.intendedTargets && clue.intendedTargets.length > 0) {
      section += `- Intended targets: ${clue.intendedTargets.join(', ')}\n`;
    }
    section += `- Guessed: ${guessedCount} word(s)\n`;
    if (correctGuesses.length > 0) {
      section += `- Correct guesses: ${correctGuesses.map(g => g.word).join(', ')}\n`;
    }
    if (wrongGuesses.length > 0) {
      section += `- Wrong guesses: ${wrongGuesses.map(g => `${g.word} (${g.cardType})`).join(', ')}\n`;
    }
    if (outstandingCount > 0) {
      const unrevealed = clue.intendedTargets?.filter(t =>
        !gameState.revealed[gameState.words.findIndex(w => w.toUpperCase() === t.toUpperCase())]
      ) || [];
      if (unrevealed.length > 0) {
        section += `- **Outstanding targets (${outstandingCount} word(s) not yet guessed):** ${unrevealed.join(', ')}\n`;
        section += `  - The guesser may still be looking for words related to "${clue.word}"\n`;
      }
    }
    section += '\n';
  }

  section += `## Strategic Implications\n`;
  section += `- If you have outstanding targets from previous clues, your guesser may still guess them without a new clue\n`;
  section += `- Consider whether a new clue might interfere with or complement outstanding hints\n`;
  section += `- Avoid giving clues that overlap with words your guesser already missed (they may have been wrong guesses for a reason)\n`;

  return section;
}

/**
 * Build turn history section for guesser prompt
 * Shows past clues and which words were guessed for each
 */
function buildGuesserHistorySection(gameState: GameState, team: Team): string {
  const teamClues = gameState.clueHistory.filter(c => c.team === team);

  if (teamClues.length === 0) {
    return '';
  }

  let section = `\n## Past Clues From Your Spymaster This Game\n`;
  section += `Use this history to identify "outstanding" clues - words your spymaster hinted at but you haven't found yet.\n\n`;

  let totalOutstanding = 0;
  const outstandingClues: Array<{ clue: string; number: number; guessedCorrect: number; targets?: string[] }> = [];

  for (const clue of teamClues) {
    const correctGuesses = clue.guesses?.filter(g => g.cardType === team) || [];
    const wrongGuesses = clue.guesses?.filter(g => g.cardType !== team) || [];
    const outstandingCount = Math.max(0, clue.number - correctGuesses.length);

    section += `### Clue: "${clue.word}" for ${clue.number}\n`;
    section += `- Correct guesses: ${correctGuesses.length > 0 ? correctGuesses.map(g => g.word).join(', ') : 'None yet'}\n`;
    if (wrongGuesses.length > 0) {
      section += `- Wrong guesses: ${wrongGuesses.map(g => `${g.word} (was ${g.cardType})`).join(', ')}\n`;
    }

    if (outstandingCount > 0) {
      section += `- **${outstandingCount} word(s) still outstanding** - there are likely ${outstandingCount} more word(s) on the board related to "${clue.word}"\n`;
      totalOutstanding += outstandingCount;
      outstandingClues.push({
        clue: clue.word,
        number: clue.number,
        guessedCorrect: correctGuesses.length,
        targets: clue.intendedTargets
      });
    } else {
      section += `- Fully resolved (all ${clue.number} words found)\n`;
    }
    section += '\n';
  }

  if (totalOutstanding > 0) {
    section += `## Key Strategic Insight: Outstanding Words\n`;
    section += `You have approximately **${totalOutstanding} outstanding word(s)** from previous clues that you haven't found yet.\n\n`;
    section += `When analyzing the current clue, also consider:\n`;
    for (const oc of outstandingClues) {
      section += `- "${oc.clue}" (gave ${oc.number}, found ${oc.guessedCorrect}) - look for ${oc.number - oc.guessedCorrect} more word(s) related to this\n`;
    }
    section += `\nThis is valuable information! A word that connects to BOTH the current clue AND an outstanding clue is very likely to be correct.\n`;
  }

  return section;
}

/**
 * Build advanced strategy section for spymaster
 */
function buildSpymasterStrategySection(): string {
  return `
## Advanced Spymaster Strategy

### Clue Construction
- **Scan the entire board first:** Before finalizing a clue, check every word to ensure your clue doesn't accidentally trigger opponent cards, neutrals, or the assassin.
- **Think from the guesser's perspective:** What associations might they make that you didn't intend?
- **Abstract vs. concrete:** Abstract clues (concepts, categories) can link more words but are riskier. Concrete clues (direct synonyms, specific facts) are safer but limited.

### Risk Management
- **Never risk the assassin:** If your clue has ANY connection to the assassin word, find a different clue.
- **Opponent words are costly:** Guessing an opponent's word gives them progress AND ends your turn.
- **Neutrals waste turns:** Better than opponent words, but still a setback.

### Number Strategy
- **Early game (6+ words left):** Go for 2-3 word clues to build a lead
- **Mid game (3-5 words left):** Balance between safe 2-word clues and riskier higher numbers
- **End game (1-2 words left):** Play it safe with 1-word clues unless you're behind

### Zero Clue Strategy
- Giving "WORD, 0" tells your team to AVOID that word - useful if it might be confused with your targets
- Example: If "CAKE" could be confused with your words but is the assassin, consider "BAKING, 0" to warn them away

### Listen to the Board
- Words that have already been revealed give you information about what connections have been made
- Reusing a concept from a previous successful clue (yours or opponent's) can help or confuse your guesser`;
}

/**
 * Build advanced strategy section for guesser
 */
function buildGuesserStrategySection(): string {
  return `
## Advanced Guesser Strategy

### Analyzing the Clue
- **Think like your spymaster:** What words would they be looking at? What connections are they trying to make?
- **Consider multiple meanings:** A clue might be a synonym, category, rhyme, pop culture reference, or compound word component
- **Check for hypothetical better clues:** If you're considering a word, think "would a better, more specific clue exist for that word?" If yes, it might not be the target

### Prioritizing Guesses
- **Strongest connections first:** Always guess your most confident word first
- **The "+1 bonus guess":** You can guess clue_number + 1 words. Use the extra guess for outstanding words from previous clues if you're confident
- **Stop when uncertain:** It's often better to end your turn than to guess a word you're unsure about

### Using Past Clues
- **Outstanding words are gold:** If a word connects to both the current clue AND a previous clue you didn't fully solve, it's very likely correct
- **Patterns in your spymaster's thinking:** Has your spymaster used category-based clues? Synonym clues? Learn their style

### Risk Assessment
- **Avoid obvious opponent words:** If a word screams "this is for the other team," avoid it
- **The assassin is always a threat:** Never guess a word that could plausibly be the assassin
- **When in doubt, stop:** Ending your turn early is better than hitting the assassin or an opponent word`;
}

/**
 * Call OpenAI API with structured output - routes to appropriate API
 * For background mode models, this throws an error - use startBackgroundRequest instead
 */
async function callOpenAI(
  apiKey: string,
  messages: OpenAIMessage[],
  jsonSchema: object,
  model: string = 'gpt-4o-mini',
  temperature: number = 0.7,
  reasoningEffort?: string
): Promise<any> {
  // Check if this model requires background mode
  if (requiresBackgroundMode(model)) {
    throw new Error(`Model ${model} requires background mode. Use the async API endpoints.`);
  }

  return callChatCompletions(apiKey, messages, jsonSchema, model, temperature, reasoningEffort);
}

/**
 * Generate AI spymaster clue
 */
export async function generateAIClue(
  apiKey: string,
  gameState: GameState,
  team: Team,
  model: string = 'gpt-4o',
  reasoningEffort?: string,
  customInstructions?: string
): Promise<AIClueCandidate> {
  // Get words by type
  const teamWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === team
  );
  const opponentWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === (team === 'red' ? 'blue' : 'red')
  );
  const neutralWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === 'neutral'
  );
  const assassinWord = gameState.words.find((_w, i) => gameState.key[i] === 'assassin');

  const myRemaining = team === 'red' ? gameState.redRemaining : gameState.blueRemaining;
  const opponentRemaining = team === 'red' ? gameState.blueRemaining : gameState.redRemaining;

  let prompt = `You are playing Codenames as the spymaster for the ${team.toUpperCase()} team.

## Game Rules Reminder
- Give a one-word clue and a number indicating how many words it relates to
- Your clue cannot be any word on the board or a form of any board word
- Your team will guess based on your clue - they don't know which words are yours

## Current Board State

## Remaining Words
- Your team: ${myRemaining}
- Opponent team: ${opponentRemaining}

### Your Team's Words (get these guessed):
${teamWords.map(w => `- ${w}`).join('\n')}

### Opponent's Words (avoid these):
${opponentWords.map(w => `- ${w}`).join('\n')}

### Neutral Words (not harmful but waste a turn):
${neutralWords.map(w => `- ${w}`).join('\n')}

### THE ASSASSIN (instant loss if guessed):
${assassinWord}`;

  // Add past turn history and advanced strategy if enabled
  if (gameState.giveAIPastTurnInfo) {
    prompt += buildSpymasterHistorySection(gameState, team);
    prompt += buildSpymasterStrategySection();
  }

  prompt += `

## Your Task
Generate a single clue that connects multiple of YOUR team's words safely.

Strategy tips:
- Prioritize safety: avoid clues that could lead to the assassin
- Consider word associations your guesser might make
- Balance between connecting many words vs. being too vague
- It's often better to give a safe clue for 2 words than a risky clue for 4`;

  if (customInstructions) {
    prompt += `\n\n## Additional Instructions\n${customInstructions}`;
  }

  const schema = {
    name: 'spymaster_clue',
    strict: true,
    schema: {
      type: 'object',
      required: ['reasoning', 'clue', 'riskAssessment', 'intendedTargets', 'number'],
      additionalProperties: false,
      properties: {
        reasoning: {
          type: 'string',
          description: 'Why this clue connects the target words',
        },
        clue: {
          type: 'string',
          description: 'A single word clue (no spaces, no board words)',
        },
        riskAssessment: {
          type: 'string',
          description: 'Potential confusion with opponent/neutral/assassin words',
        },
        intendedTargets: {
          type: 'array',
          items: { type: 'string' },
          description: 'The specific team words this clue hints at',
        },
        number: {
          type: 'integer',
          description: 'Number of words this clue relates to (1-9)',
        },
      },
    },
  };

  const result = await callOpenAI(
    apiKey,
    [{ role: 'user', content: prompt }],
    schema,
    model,
    0.7,
    reasoningEffort
  );

  return result as AIClueCandidate;
}

/**
 * Generate AI guesser suggestions
 */
export async function generateAIGuesses(
  apiKey: string,
  gameState: GameState,
  clueWord: string,
  clueNumber: number,
  team: Team,
  model: string = 'gpt-4o-mini',
  reasoningEffort?: string,
  customInstructions?: string
): Promise<AIGuessResponse> {
  const unrevealedWords = gameState.words.filter((_w, i) => !gameState.revealed[i]);

  let prompt = `You are playing Codenames as a guesser for the ${team.toUpperCase()} team.

## Game State
- Your team's remaining words: ${team === 'red' ? gameState.redRemaining : gameState.blueRemaining} words left to find
- Opponent's remaining words: ${team === 'red' ? gameState.blueRemaining : gameState.redRemaining} words left

## Current Clue
Your spymaster gave the clue: "${clueWord}" for ${clueNumber} word(s)

## Unrevealed Words on the Board
${unrevealedWords.map(w => `- ${w}`).join('\n')}`;

  // Add past turn history and advanced strategy if enabled
  if (gameState.giveAIPastTurnInfo) {
    prompt += buildGuesserHistorySection(gameState, team);
    prompt += buildGuesserStrategySection();
  }

  prompt += `

## Your Task
Analyze the clue and identify which unrevealed words your spymaster is hinting at.

Guidelines:
1. Consider semantic connections, categories, synonyms, and word associations
2. The clue relates to exactly ${clueNumber} of your team's words
3. Be careful - some words might be opponent words, neutral, or the assassin
4. Order your guesses from most confident to least confident
5. Assign confidence scores (0-1) based on how strongly each word connects to the clue
6. If you're unsure about later guesses, indicate you should stop early
7. If you can't find ANY strong connection to the clue, set stopAfter to 0 to pass the turn immediately`;

  if (customInstructions) {
    prompt += `\n\n## Additional Instructions\n${customInstructions}`;
  }

  const schema = {
    name: 'guesser_output',
    strict: true,
    schema: {
      type: 'object',
      required: ['reasoning', 'suggestions', 'stopAfter'],
      additionalProperties: false,
      properties: {
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the guessing strategy',
        },
        suggestions: {
          type: 'array',
          description: 'Ordered list of guesses from most to least confident',
          items: {
            type: 'object',
            required: ['word', 'confidence'],
            additionalProperties: false,
            properties: {
              word: {
                type: 'string',
                description: 'The word being guessed',
              },
              confidence: {
                type: 'number',
                description: 'Confidence score between 0 and 1',
              },
            },
          },
        },
        stopAfter: {
          type: 'integer',
          description: 'Number of guesses to make (0 = pass turn immediately without guessing)',
        },
      },
    },
  };

  const result = await callOpenAI(
    apiKey,
    [{ role: 'user', content: prompt }],
    schema,
    model,
    0.3,
    reasoningEffort
  );

  return result as AIGuessResponse;
}

// Schema definitions for background mode
const SPYMASTER_SCHEMA = {
  name: 'spymaster_clue',
  strict: true,
  schema: {
    type: 'object',
    required: ['reasoning', 'clue', 'riskAssessment', 'intendedTargets', 'number'],
    additionalProperties: false,
    properties: {
      reasoning: {
        type: 'string',
        description: 'Why this clue connects the target words',
      },
      clue: {
        type: 'string',
        description: 'A single word clue (no spaces, no board words)',
      },
      riskAssessment: {
        type: 'string',
        description: 'Potential confusion with opponent/neutral/assassin words',
      },
      intendedTargets: {
        type: 'array',
        items: { type: 'string' },
        description: 'The specific team words this clue hints at',
      },
      number: {
        type: 'integer',
        description: 'Number of words this clue relates to (1-9)',
      },
    },
  },
};

const GUESSER_SCHEMA = {
  name: 'guesser_output',
  strict: true,
  schema: {
    type: 'object',
    required: ['reasoning', 'suggestions', 'stopAfter'],
    additionalProperties: false,
    properties: {
      reasoning: {
        type: 'string',
        description: 'Brief explanation of the guessing strategy',
      },
      suggestions: {
        type: 'array',
        description: 'Ordered list of guesses from most to least confident',
        items: {
          type: 'object',
          required: ['word', 'confidence'],
          additionalProperties: false,
          properties: {
            word: {
              type: 'string',
              description: 'The word being guessed',
            },
            confidence: {
              type: 'number',
              description: 'Confidence score between 0 and 1',
            },
          },
        },
      },
      stopAfter: {
        type: 'integer',
        description: 'Number of guesses to make (0 = pass turn immediately without guessing)',
      },
    },
  },
};

/**
 * Build spymaster prompt (exported for background mode)
 */
export function buildSpymasterPrompt(
  gameState: GameState,
  team: Team,
  customInstructions?: string
): string {
  const teamWords = gameState.words.filter((_w, i) =>
    !gameState.revealed[i] && gameState.key[i] === team
  );
  const opponentWords = gameState.words.filter((_w, i) =>
    !gameState.revealed[i] && gameState.key[i] === (team === 'red' ? 'blue' : 'red')
  );
  const neutralWords = gameState.words.filter((_w, i) =>
    !gameState.revealed[i] && gameState.key[i] === 'neutral'
  );
  const assassinWord = gameState.words.find((_w, i) => gameState.key[i] === 'assassin');

  const myRemaining = team === 'red' ? gameState.redRemaining : gameState.blueRemaining;
  const opponentRemaining = team === 'red' ? gameState.blueRemaining : gameState.redRemaining;

  let prompt = `You are playing Codenames as the spymaster for the ${team.toUpperCase()} team.

## Game Rules Reminder
- Give a one-word clue and a number indicating how many words it relates to
- Your clue cannot be any word on the board or a form of any board word
- Your team will guess based on your clue - they don't know which words are yours

## Current Board State

## Remaining Words
- Your team: ${myRemaining}
- Opponent team: ${opponentRemaining}

### Your Team's Words (get these guessed):
${teamWords.map(w => `- ${w}`).join('\n')}

### Opponent's Words (avoid these):
${opponentWords.map(w => `- ${w}`).join('\n')}

### Neutral Words (not harmful but waste a turn):
${neutralWords.map(w => `- ${w}`).join('\n')}

### THE ASSASSIN (instant loss if guessed):
${assassinWord}`;

  // Add past turn history and advanced strategy if enabled
  if (gameState.giveAIPastTurnInfo) {
    prompt += buildSpymasterHistorySection(gameState, team);
    prompt += buildSpymasterStrategySection();
  }

  prompt += `

## Your Task
Generate a single clue that connects multiple of YOUR team's words safely.

Strategy tips:
- Prioritize safety: avoid clues that could lead to the assassin
- Consider word associations your guesser might make
- Balance between connecting many words vs. being too vague
- It's often better to give a safe clue for 2 words than a risky clue for 4`;

  if (customInstructions) {
    prompt += `\n\n## Additional Instructions\n${customInstructions}`;
  }

  return prompt;
}

/**
 * Build guesser prompt (exported for background mode)
 */
export function buildGuesserPrompt(
  gameState: GameState,
  clueWord: string,
  clueNumber: number,
  team: Team,
  customInstructions?: string
): string {
  const unrevealedWords = gameState.words.filter((_w, i) => !gameState.revealed[i]);

  let prompt = `You are playing Codenames as a guesser for the ${team.toUpperCase()} team.

## Game State
- Your team's remaining words: ${team === 'red' ? gameState.redRemaining : gameState.blueRemaining} words left to find
- Opponent's remaining words: ${team === 'red' ? gameState.blueRemaining : gameState.redRemaining} words left

## Current Clue
Your spymaster gave the clue: "${clueWord}" for ${clueNumber} word(s)

## Unrevealed Words on the Board
${unrevealedWords.map(w => `- ${w}`).join('\n')}`;

  // Add past turn history and advanced strategy if enabled
  if (gameState.giveAIPastTurnInfo) {
    prompt += buildGuesserHistorySection(gameState, team);
    prompt += buildGuesserStrategySection();
  }

  prompt += `

## Your Task
Analyze the clue and identify which unrevealed words your spymaster is hinting at.

Guidelines:
1. Consider semantic connections, categories, synonyms, and word associations
2. The clue relates to exactly ${clueNumber} of your team's words
3. Be careful - some words might be opponent words, neutral, or the assassin
4. Order your guesses from most confident to least confident
5. Assign confidence scores (0-1) based on how strongly each word connects to the clue
6. If you're unsure about later guesses, indicate you should stop early
7. If you can't find ANY strong connection to the clue, set stopAfter to 0 to pass the turn immediately`;

  if (customInstructions) {
    prompt += `\n\n## Additional Instructions\n${customInstructions}`;
  }

  return prompt;
}

/**
 * Start a background clue generation request
 * Returns the response ID for polling
 */
export async function startBackgroundClue(
  apiKey: string,
  gameState: GameState,
  team: Team,
  model: string,
  reasoningEffort?: string,
  customInstructions?: string
): Promise<string> {
  const prompt = buildSpymasterPrompt(gameState, team, customInstructions);

  return startBackgroundRequest(
    apiKey,
    [{ role: 'user', content: prompt }],
    SPYMASTER_SCHEMA,
    model,
    reasoningEffort
  );
}

/**
 * Start a background guess generation request
 * Returns the response ID for polling
 */
export async function startBackgroundGuess(
  apiKey: string,
  gameState: GameState,
  clueWord: string,
  clueNumber: number,
  team: Team,
  model: string,
  reasoningEffort?: string,
  customInstructions?: string
): Promise<string> {
  const prompt = buildGuesserPrompt(gameState, clueWord, clueNumber, team, customInstructions);

  return startBackgroundRequest(
    apiKey,
    [{ role: 'user', content: prompt }],
    GUESSER_SCHEMA,
    model,
    reasoningEffort
  );
}

// ============================================================================
// SIMULATION FUNCTIONS
// For evaluating multiple candidate clues by simulating guesser responses
// ============================================================================

/**
 * Generate a single clue candidate with higher temperature for diversity
 */
async function generateSingleClueCandidate(
  apiKey: string,
  gameState: GameState,
  team: Team,
  model: string,
  reasoningEffort?: string,
  customInstructions?: string
): Promise<AIClueCandidate> {
  const teamWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === team
  );
  const opponentWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === (team === 'red' ? 'blue' : 'red')
  );
  const neutralWords = gameState.words.filter((w, i) =>
    !gameState.revealed[i] && gameState.key[i] === 'neutral'
  );
  const assassinWord = gameState.words.find((_w, i) => gameState.key[i] === 'assassin');

  const myRemaining = team === 'red' ? gameState.redRemaining : gameState.blueRemaining;
  const opponentRemaining = team === 'red' ? gameState.blueRemaining : gameState.redRemaining;

  let prompt = `You are playing Codenames as the spymaster for the ${team.toUpperCase()} team.

## Game Rules Reminder
- Give a one-word clue and a number indicating how many words it relates to
- Your clue cannot be any word on the board or a form of any board word
- Your team will guess based on your clue - they don't know which words are yours

## Current Board State

## Remaining Words
- Your team: ${myRemaining}
- Opponent team: ${opponentRemaining}

### Your Team's Words (get these guessed):
${teamWords.map(w => `- ${w}`).join('\n')}

### Opponent's Words (avoid these):
${opponentWords.map(w => `- ${w}`).join('\n')}

### Neutral Words (not harmful but waste a turn):
${neutralWords.map(w => `- ${w}`).join('\n')}

### THE ASSASSIN (instant loss if guessed):
${assassinWord}`;

  if (gameState.giveAIPastTurnInfo) {
    prompt += buildSpymasterHistorySection(gameState, team);
    prompt += buildSpymasterStrategySection();
  }

  prompt += `

## Your Task
Generate a single clue that connects multiple of YOUR team's words safely.
Be creative and consider different possible connections - there are many valid approaches!

Strategy tips:
- Prioritize safety: avoid clues that could lead to the assassin
- Consider word associations your guesser might make
- Balance between connecting many words vs. being too vague
- It's often better to give a safe clue for 2 words than a risky clue for 4`;

  if (customInstructions) {
    prompt += `\n\n## Additional Instructions\n${customInstructions}`;
  }

  const schema = {
    name: 'spymaster_clue',
    strict: true,
    schema: {
      type: 'object',
      required: ['reasoning', 'clue', 'riskAssessment', 'intendedTargets', 'number'],
      additionalProperties: false,
      properties: {
        reasoning: {
          type: 'string',
          description: 'Why this clue connects the target words',
        },
        clue: {
          type: 'string',
          description: 'A single word clue (no spaces, no board words)',
        },
        riskAssessment: {
          type: 'string',
          description: 'Potential confusion with opponent/neutral/assassin words',
        },
        intendedTargets: {
          type: 'array',
          items: { type: 'string' },
          description: 'The specific team words this clue hints at',
        },
        number: {
          type: 'integer',
          description: 'Number of words this clue relates to (1-9)',
        },
      },
    },
  };

  const result = await callChatCompletions(
    apiKey,
    [{ role: 'user', content: prompt }],
    schema,
    model,
    0.9, // Higher temperature for diverse candidates
    reasoningEffort
  );

  return result as AIClueCandidate;
}

/**
 * Generate multiple clue candidates in parallel
 * If modelEntries array is provided, randomly picks a model for each candidate
 */
export async function generateMultipleClueCandidates(
  apiKey: string,
  gameState: GameState,
  team: Team,
  count: number,
  modelEntries: ModelEntry[]
): Promise<AIClueCandidate[]> {
  // Generate all candidates in parallel, randomly picking a model entry for each
  const candidatePromises = Array.from({ length: count }, () => {
    const entry = modelEntries[Math.floor(Math.random() * modelEntries.length)];
    return generateSingleClueCandidate(
      apiKey,
      gameState,
      team,
      entry.model,
      entry.reasoningEffort,
      entry.customInstructions
    );
  });

  const candidates = await Promise.all(candidatePromises);
  return candidates;
}

/**
 * Simulate how a guesser would respond to a given clue
 */
export async function simulateGuesserResponse(
  apiKey: string,
  gameState: GameState,
  clue: AIClueCandidate,
  team: Team,
  simulationModel: string
): Promise<AIGuessResponse> {
  const unrevealedWords = gameState.words.filter((_w, i) => !gameState.revealed[i]);

  const prompt = `You are playing Codenames as a guesser for the ${team.toUpperCase()} team.

## Game State
- Your team's remaining words: ${team === 'red' ? gameState.redRemaining : gameState.blueRemaining} words left to find
- Opponent's remaining words: ${team === 'red' ? gameState.blueRemaining : gameState.redRemaining} words left

## Current Clue
Your spymaster gave the clue: "${clue.clue}" for ${clue.number} word(s)

## Unrevealed Words on the Board
${unrevealedWords.map(w => `- ${w}`).join('\n')}

## Your Task
Analyze the clue and identify which unrevealed words your spymaster is hinting at.

Guidelines:
1. Consider semantic connections, categories, synonyms, and word associations
2. The clue relates to exactly ${clue.number} of your team's words
3. Be careful - some words might be opponent words, neutral, or the assassin
4. Order your guesses from most confident to least confident
5. Assign confidence scores (0-1) based on how strongly each word connects to the clue
6. If you're unsure about later guesses, indicate you should stop early
7. If you can't find ANY strong connection to the clue, set stopAfter to 0 to pass the turn immediately`;

  const schema = {
    name: 'guesser_output',
    strict: true,
    schema: {
      type: 'object',
      required: ['reasoning', 'suggestions', 'stopAfter'],
      additionalProperties: false,
      properties: {
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the guessing strategy',
        },
        suggestions: {
          type: 'array',
          description: 'Ordered list of guesses from most to least confident',
          items: {
            type: 'object',
            required: ['word', 'confidence'],
            additionalProperties: false,
            properties: {
              word: {
                type: 'string',
                description: 'The word being guessed',
              },
              confidence: {
                type: 'number',
                description: 'Confidence score between 0 and 1',
              },
            },
          },
        },
        stopAfter: {
          type: 'integer',
          description: 'Number of guesses to make (0 = pass turn immediately without guessing)',
        },
      },
    },
  };

  const result = await callChatCompletions(
    apiKey,
    [{ role: 'user', content: prompt }],
    schema,
    simulationModel,
    0.3, // Lower temperature for more predictable guessing
    undefined // No reasoning effort for simulation model
  );

  return result as AIGuessResponse;
}

/**
 * Calculate the score for a simulated clue result
 *
 * Scoring:
 * - Correct team word: +1.0
 * - Outstanding (hinted but not guessed): +0.4
 * - Neutral word: -0.15
 * - Opponent word: -1.15
 * - Assassin: varies by mode (-999, -3, or -2)
 */
export function calculateSimulationScore(
  candidate: AIClueCandidate,
  guessResponse: AIGuessResponse,
  gameState: GameState,
  team: Team,
  assassinBehavior: AssassinBehavior
): { guessResults: Array<{ word: string; cardType: CardType; points: number }>; outstandingCount: number; totalScore: number; opponentEndPenalty: number } {
  const guessResults: Array<{ word: string; cardType: CardType; points: number }> = [];
  let correctGuesses = 0;
  let opponentWordsGuessed = 0;
  let totalScore = 0;

  // stopAfter = 0 means pass turn immediately (no guesses)
  // stopAfter > 0 means make that many guesses (capped at clue number + 1)
  const maxGuesses = guessResponse.stopAfter === 0
    ? 0
    : Math.min(guessResponse.stopAfter, candidate.number + 1);

  const guessesToEvaluate = guessResponse.suggestions.slice(0, maxGuesses);

  // Get assassin penalty based on behavior
  const getAssassinPenalty = (): number => {
    switch (assassinBehavior) {
      case 'instant_loss': return -999;
      case 'reveal_opponent': return -3;
      case 'add_own_cards': return -2;
      default: return -999;
    }
  };

  // Evaluate each guess sequentially (simulation stops on wrong guess)
  for (const guess of guessesToEvaluate) {
    const wordIndex = gameState.words.findIndex(
      w => w.toUpperCase() === guess.word.toUpperCase()
    );

    if (wordIndex === -1) {
      // Word not found on board - shouldn't happen but skip it
      continue;
    }

    const cardType = gameState.key[wordIndex];
    let points = 0;

    if (cardType === team) {
      // Correct guess
      points = 1.0;
      correctGuesses++;
    } else if (cardType === 'neutral') {
      points = -0.15;
    } else if (cardType === 'assassin') {
      points = getAssassinPenalty();
    } else {
      // Opponent's word
      points = -1.15;
      opponentWordsGuessed++;
    }

    guessResults.push({ word: guess.word, cardType, points });
    totalScore += points;

    // Stop evaluating if we hit a non-team card
    if (cardType !== team) {
      break;
    }
  }

  // Calculate outstanding count (clue.number - correctGuesses)
  const outstandingCount = Math.max(0, candidate.number - correctGuesses);

  // Add outstanding credit: +0.4 per outstanding word
  const outstandingScore = outstandingCount * 0.4;
  totalScore += outstandingScore;

  // Calculate opponent end position penalty
  // Penalty based on how many words opponent has left after this simulation
  const opponentStartRemaining = team === 'red' ? gameState.blueRemaining : gameState.redRemaining;
  const opponentEndRemaining = opponentStartRemaining - opponentWordsGuessed;

  let opponentEndPenalty = 0;
  if (opponentEndRemaining === 0) {
    opponentEndPenalty = -999; // They won
  } else if (opponentEndRemaining === 1) {
    opponentEndPenalty = -9; // Very easy for them to win
  } else if (opponentEndRemaining === 2) {
    opponentEndPenalty = -3;
  } else if (opponentEndRemaining === 3) {
    opponentEndPenalty = -1;
  } else if (opponentEndRemaining === 4) {
    opponentEndPenalty = -0.3;
  }
  // 5+ remaining: no additional penalty

  totalScore += opponentEndPenalty;

  return { guessResults, outstandingCount, totalScore, opponentEndPenalty };
}

/**
 * Evaluate multiple clue candidates by simulating guesser responses
 * Returns the winning candidate and all results for display
 *
 * @param modelEntries - Array of model entries for the spymaster (randomly picks for each candidate)
 * @param simulationModel - Model to use for simulating guesser responses
 */
export async function evaluateClueWithSimulation(
  apiKey: string,
  gameState: GameState,
  team: Team,
  simulationCount: number,
  modelEntries: ModelEntry[],
  simulationModel: string
): Promise<SimulationEvaluationResult> {
  // Step 1: Generate all candidates in parallel (randomly selecting from model entries)
  const candidates = await generateMultipleClueCandidates(
    apiKey,
    gameState,
    team,
    simulationCount,
    modelEntries
  );

  // Step 2: Simulate guesser responses for all candidates in parallel
  const simulationPromises = candidates.map(async (candidate): Promise<ClueSimulationResult> => {
    const guessResponse = await simulateGuesserResponse(
      apiKey,
      gameState,
      candidate,
      team,
      simulationModel
    );

    const { guessResults, outstandingCount, totalScore, opponentEndPenalty } = calculateSimulationScore(
      candidate,
      guessResponse,
      gameState,
      team,
      gameState.assassinBehavior
    );

    return {
      candidate,
      simulatedGuesses: guessResponse.suggestions,
      guesserReasoning: guessResponse.reasoning,
      guessResults,
      outstandingCount,
      opponentEndPenalty,
      totalScore,
    };
  });

  const allResults = await Promise.all(simulationPromises);

  // Step 3: Sort by score and pick the winner
  allResults.sort((a, b) => b.totalScore - a.totalScore);
  const winner = allResults[0];

  return { winner, allResults };
}
