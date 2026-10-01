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
const { generateAIClue, requiresBackgroundMode } = await import(pathToFileURL(join(buildDir, 'ai.mjs')));
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
