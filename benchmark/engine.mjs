// Load the actual Worker gameplay and prompts into Node; no public rooms are created.
import ts from '../worker/node_modules/typescript/lib/typescript.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
export async function loadEngine() {
  const sources = await Promise.all(['ai', 'game'].map(n => readFile(new URL(`worker/src/${n}.ts`, root), 'utf8')));
  const words = await readFile(new URL('shared/wordlist.json', root), 'utf8');
  const fingerprint = createHash('sha256').update(sources.join('\n') + words).digest('hex');
  const dir = new URL(`.benchmark-build.local/${fingerprint}/`, root);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < sources.length; i++) {
    let source = sources[i].replace("from './ai'", "from './ai.mjs'").replace("import wordlist from '../../shared/wordlist.json';", `const wordlist = ${words};`);
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
    await writeFile(new URL(`${['ai', 'game'][i]}.mjs`, dir), outputText);
  }
  return { ...(await import(new URL('ai.mjs', dir))), ...(await import(new URL('game.mjs', dir))), fingerprint, wordlist: JSON.parse(words).words };
}
export class MemoryStorage {
  data = new Map();
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { return this.data.delete(key); }
}
export async function action(room, path, body = {}) {
  const response = await room.fetch(new Request(`http://local${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { ok: response.ok, ...(await response.json()) };
}
