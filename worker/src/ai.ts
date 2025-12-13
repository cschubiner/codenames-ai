/**
 * AI integration for Codenames - OpenAI API calls
 */

import { GameState, Team, AIClueCandidate, AIGuessResponse } from './types';

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

// Models that support reasoning_effort parameter
const REASONING_MODELS = ['gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'o3', 'o4-mini', 'o3-mini', 'o1', 'o1-mini'];

/**
 * Call OpenAI API with structured output
 */
async function callOpenAI(
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
  const assassinWord = gameState.words.find((w, i) => gameState.key[i] === 'assassin');

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
${assassinWord}

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
  const unrevealedWords = gameState.words.filter((w, i) => !gameState.revealed[i]);

  let prompt = `You are playing Codenames as a guesser for the ${team.toUpperCase()} team.

## Game State
- Your team's remaining words: ${team === 'red' ? gameState.redRemaining : gameState.blueRemaining} words left to find
- Opponent's remaining words: ${team === 'red' ? gameState.blueRemaining : gameState.redRemaining} words left

## Current Clue
Your spymaster gave the clue: "${clueWord}" for ${clueNumber} word(s)

## Unrevealed Words on the Board
${unrevealedWords.map(w => `- ${w}`).join('\n')}

## Your Task
Analyze the clue and identify which unrevealed words your spymaster is hinting at.

Guidelines:
1. Consider semantic connections, categories, synonyms, and word associations
2. The clue relates to exactly ${clueNumber} of your team's words
3. Be careful - some words might be opponent words, neutral, or the assassin
4. Order your guesses from most confident to least confident
5. Assign confidence scores (0-1) based on how strongly each word connects to the clue
6. If you're unsure about later guesses, indicate you should stop early`;

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
          description: 'Recommended number of guesses before stopping (0 means use all)',
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
