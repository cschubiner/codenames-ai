import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const buildDir = await mkdtemp(join(tmpdir(), 'codenames-ai-test-'));
const source = await readFile(new URL('../src/ai.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ES2022 },
});
await writeFile(join(buildDir, 'ai.mjs'), outputText);
const { generateAIClue, generateAIGuesses, buildSpymasterPrompt, buildGuesserPrompt, requiresBackgroundMode } = await import(pathToFileURL(join(buildDir, 'ai.mjs')));
after(() => rm(buildDir, { recursive: true, force: true }));
const board = {
  words: ['APPLE', 'PEAR', 'MOON', 'BOMB'],
  key: ['red', 'red', 'blue', 'assassin'],
  revealed: [false, false, false, false],
  redRemaining: 2, blueRemaining: 1, giveAIPastTurnInfo: false,
};
const clue = { clue: 'Fruit', number: 2, intendedTargets: ['APPLE', 'PEAR'], reasoning: 'Both are fruit', riskAssessment: 'Safe' };

for (const model of ['gpt-4o', 'gpt-5.2-pro', 'openai/gpt-4o-mini']) {
  test(`OpenRouter routes ${model} with structured output and the capped credential`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer sk-or-test');
      const body = JSON.parse(init.body);
      assert.equal(body.model, model.includes('/') ? model : `openai/${model}`);
      assert.equal(body.response_format.type, 'json_schema');
      assert.equal(body.provider.require_parameters, true);
      assert.ok(!('reasoning_effort' in body));
      if (model === 'gpt-5.2-pro') assert.deepEqual(body.reasoning, { effort: 'high' });
      return Response.json({ choices: [{ message: { content: JSON.stringify(clue) } }] });
    });
    assert.deepEqual(await generateAIClue('sk-or-test', board, 'red', model, 'high'), clue);
    assert.equal(requiresBackgroundMode(model, 'sk-or-test'), false);
  });
}

test('legacy direct OpenAI routing and background support are preserved', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(init.body).model, 'gpt-4o');
    return Response.json({ choices: [{ message: { content: JSON.stringify(clue) } }] });
  });
  await generateAIClue('sk-test', board, 'red', 'gpt-4o');
  assert.equal(requiresBackgroundMode('gpt-5.2-pro', 'sk-test'), true);
});

for (const [status, message] of [[401, 'credentials need updating'], [402, 'monthly application limit'], [429, 'temporarily unavailable']]) {
  test(`provider HTTP ${status} is actionable without exposing provider details`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('private provider diagnostic', { status }));
    t.mock.method(console, 'error', () => {});
    await assert.rejects(generateAIClue('sk-or-test', board, 'red'), (error) => {
      assert.ok(error.message.includes(message));
      assert.ok(!error.message.includes('private provider diagnostic'));
      return true;
    });
  });
}

test('HTTP 200 with an upstream error is shown as a temporary service failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 429, message: 'private upstream diagnostic' } }));
  await assert.rejects(generateAIClue('sk-or-test', board, 'red'), /temporarily unavailable/);
});

for (const model of ['openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-fable-5.1', 'openai/gpt-6-astra', 'openai/gpt-6.1-sol', 'google/gemini-3.1-pro-preview', 'openai/gpt-6-sol']) {
  test(`OpenRouter forwards low reasoning for ${model} without temperature`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (_, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, model);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.ok(!('temperature' in body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(clue) } }] });
    });
    await generateAIClue('sk-or-test', board, 'red', model, 'low');
  });
}

for (const team of ['red', 'blue']) {
  test(`last-chance prompts cover both roles for ${team}, even without history`, async (t) => {
    const state = { ...board, redRemaining: team === 'red' ? 2 : 1, blueRemaining: team === 'blue' ? 2 : 1 };
    const spy = buildSpymasterPrompt(state, team);
    const guesser = buildGuesserPrompt(state, 'Fruit', 2, team);
    assert.match(spy, /ALL 2 remaining team words, with number 2/);
    assert.match(spy, /planning assumption, not a guaranteed outcome/);
    assert.match(guesser, /at most 3 guesses/);
    assert.match(guesser, /Assume they will find it and win/);
    const prompts = [];
    t.mock.method(globalThis, 'fetch', async (_, init) => {
      prompts.push(JSON.parse(init.body).messages[0].content);
      return Response.json({ choices: [{ message: { content: JSON.stringify(clue) } }] });
    });
    await generateAIClue('sk-or-test', state, team);
    await generateAIGuesses('sk-or-test', state, 'Fruit', 2, team);
    assert.equal(prompts[0], spy);
    assert.equal(prompts[1], guesser);
    const normal = { ...state, redRemaining: 3, blueRemaining: 3 };
    assert.doesNotMatch(buildSpymasterPrompt(normal, team), /Last-Chance Strategy/);
    assert.doesNotMatch(buildGuesserPrompt(normal, 'Fruit', 2, team), /Last-Chance Strategy/);
  });
}

test('guesser uses unresolved past clues without exposing hidden targets or claiming exact counts', () => {
  const state = { ...board, blueRemaining: 3, giveAIPastTurnInfo: true,
    clueHistory: [{ team: 'red', word: 'Orchard', number: 2, intendedTargets: ['SECRET_TARGET'],
      guesses: [{ word: 'APPLE', cardType: 'red' }] }] };
  const prompt = buildGuesserPrompt(state, 'Round', 1, 'red');
  assert.match(prompt, /Orchard/);
  assert.match(prompt, /APPLE/);
  assert.match(prompt, /leftover word need not also fit the current clue/);
  assert.match(prompt, /not an exact count of distinct remaining targets/);
  assert.doesNotMatch(prompt, /SECRET_TARGET|Opponent's Words|THE ASSASSIN/);
  const disabled = buildGuesserPrompt({ ...state, giveAIPastTurnInfo: false }, 'Round', 1, 'red');
  assert.doesNotMatch(disabled, /Orchard|Past Clues/);
});
