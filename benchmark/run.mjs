import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loadEngine, MemoryStorage, action } from './engine.mjs';
import { MODELS, schedule, makeBoard, summarize, reserveCost, reserveCall } from './core.mjs';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const root = resolve(new URL('../',import.meta.url).pathname);
const directory = resolve(option('--out', join(root,'benchmark/runs.local/october-2026-published')));
mkdirSync(directory,{recursive:true});
function load(name, fallback) { try { return JSON.parse(readFileSync(join(directory,name),'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
function save(name, value) { const file=join(directory,name); writeFileSync(file+'.tmp',JSON.stringify(value,null,2)); renameSync(file+'.tmp',file); }
const engine = await loadEngine();
const boardCount = Number(option('--boards', '5'));
const seed = Number(option('--seed','20261001'));
const maxBlocks = Number(option('--max-blocks','Infinity'));
const budget = Number(option('--budget','45'));
if(!Number.isInteger(boardCount)||boardCount<1||!Number.isFinite(budget)||budget<=0||budget>45) throw new Error('Use a positive board count and budget at most $45.');
const fingerprint = createHash('sha256').update(engine.fingerprint+readFileSync(new URL('core.mjs',import.meta.url))+readFileSync(new URL('run.mjs',import.meta.url))).digest('hex');
let manifest = load('manifest.json', null);
if(!manifest) {
  manifest={ id:'codenames-'+Date.now(), createdAt:new Date().toISOString(), fingerprint, engineFingerprint:engine.fingerprint, seed, boardCount, simulations:0, reasoningEffort:'low', models:MODELS, unavailableModels:[{id:'openai/gpt-6.1-sol',reason:'Persistent upstream rate limits during cost checks; replaced by GPT-6 Sol in this run.'}], giveAIPastTurnInfo:true, assassinBehavior:'instant_loss', maxTokens:4096, maxTurns:40, budgetUsd:budget, methodology:'Two role leagues. Each pair has two distinct partner models excluding both contenders. Four-game blocks swap partners and starting sides on identical boards. Only complete blocks enter rankings; opponents have equal weight. 95% bootstrap intervals resample boards. Draws score 0.5. Illegal actions lose the turn; provider failures are excluded.', blocks:schedule(boardCount,seed).slice(0,maxBlocks), boards:Array.from({length:boardCount},(_,i)=>makeBoard(engine.wordlist,seed+i)) };
  save('manifest.json',manifest);
} else if (!args.includes('--export') && (manifest.fingerprint!==fingerprint || manifest.boardCount!==boardCount || manifest.seed!==seed || manifest.budgetUsd!==budget)) {
  throw new Error('Run settings or code changed. Keep this run immutable; use a different --out directory.');
}
const results=load('games.json',{}), ledger=load('ledger.json',{calls:[]});
const publicPath=resolve(option('--publish',join(root,'docs/benchmark-results.json')));
function publish() { const value=summarize(manifest,results,ledger); writeFileSync(publicPath+'.tmp',JSON.stringify(value)); renameSync(publicPath+'.tmp',publicPath); return value; }
if(args.includes('--export')) { console.log(JSON.stringify({exported:publicPath,completedGames:publish().completedGames})); process.exit(0); }
if(args.includes('--dry-run')) { console.log(JSON.stringify({boards:manifest.boardCount,blocks:manifest.blocks.length,games:manifest.blocks.length*4,budgetUsd:budget,simulations:0,models:MODELS},null,2)); process.exit(0); }
const lockPath=join(directory,'run.lock');
let lock;
try { lock=openSync(lockPath,'wx'); writeFileSync(lock,String(process.pid)); } catch { throw new Error('This run is locked. Check the PID in run.lock; remove the lock only if that process has stopped.'); }
process.on('exit',()=>{try{closeSync(lock);unlinkSync(lockPath);}catch{}});
const originalFetch=globalThis.fetch;
const context=new AsyncLocalStorage();
let stopped=false, stopReason=null;
const apiKey=(process.env.OPENROUTER_API_KEY||readFileSync(resolve(option('--key-file',join(root,'.benchmark-key.local'))),'utf8')).trim();
if(!apiKey.startsWith('sk-or-')) throw new Error('Use an OpenRouter benchmark key.');
const auth={Authorization:`Bearer ${apiKey}`};
const infoResponse=await originalFetch('https://openrouter.ai/api/v1/key',{headers:auth});
if(!infoResponse.ok) throw new Error('Cannot verify benchmark key limits.');
const info=(await infoResponse.json()).data;
if(info.limit == null || info.limit>45 || info.limit_reset != null) throw new Error('Benchmark key must have a nonrenewing total limit of at most $45.');
const catalog=await (await originalFetch('https://openrouter.ai/api/v1/models')).json();
const prices=Object.fromEntries(MODELS.map(m=>{
  const entry=catalog.data.find(e=>e.id===m.id);
  if(!entry?.supported_parameters.includes('structured_outputs')) throw new Error(`Structured output unavailable: ${m.id}`);
  const price={prompt:Number(entry.pricing.prompt),completion:Number(entry.pricing.completion)};
  if(!Number.isFinite(price.prompt)||!Number.isFinite(price.completion)) throw new Error('Unknown price.');
  return [m.id,price];
}));
if(manifest.prices && JSON.stringify(manifest.prices)!==JSON.stringify(prices)) throw new Error('Model pricing changed; create a new benchmark run.');
manifest.prices=prices; save('manifest.json',manifest);
console.log(JSON.stringify({keyLimit:info.limit,usedBefore:info.usage,budgetUsd:budget,plannedGames:manifest.blocks.length*4}));
process.on('SIGINT',()=>{stopped=true;stopReason='interrupted';});
process.on('SIGTERM',()=>{stopped=true;stopReason='interrupted';});
globalThis.fetch=async (url,init)=>{
  if(url!=='https://openrouter.ai/api/v1/chat/completions') throw new Error('Unexpected network destination.');
  if(stopped) throw new Error('Benchmark stopped: '+stopReason);
  const body=JSON.parse(init.body), price=prices[body.model];
  if(!price) throw new Error('Unconfigured model.');
  body.max_tokens=manifest.maxTokens;
  body.reasoning={effort:manifest.reasoningEffort};
  delete body.temperature;
  body.provider={require_parameters:true,ignore:['openai/flex'],max_price:{prompt:price.prompt*1e6,completion:price.completion*1e6}};
  const reserve=reserveCost(body,price);
  const ctx=context.getStore();
  let call;
  try { call=reserveCall(ledger,budget,reserve,{gameId:ctx.gameId,role:ctx.role,model:body.model,startedAt:new Date().toISOString(),latencyMs:0}); }
  catch(e) {stopped=true;stopReason='budget';throw e;}
  save('ledger.json',ledger);
  const start=Date.now();
  try {
    const response=await originalFetch(url,{...init,body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
    call.latencyMs=Date.now()-start; call.httpStatus=response.status;
    const data=await response.clone().json().catch(()=>null);
    call.latencyMs=Date.now()-start;
    const cost=data?.usage?.cost;
    if(typeof cost==='number' && Number.isFinite(cost) && cost>=0) { call.cost=cost;call.charged=cost; }
    // Failed/unknown calls retain their reservation: a timeout can still be billed.
    call.providerError=data?.error ?? (!data?.choices?.length ? {message:'No completion choices',keys:Object.keys(data||{})} : null);
    if(data?.error?.code===429 && !data?.id && !data?.usage) call.charged=0;
    call.tokens=data?.usage?.total_tokens??null; call.provider=data?.provider??null;call.generationId=data?.id??null;
    call.status=response.ok?'complete':'error'; save('ledger.json',ledger);
    if(call.charged>reserve) { stopped=true;stopReason='unexpected price'; }
    if([401,402,403].includes(response.status)) { stopped=true;stopReason='provider authorization or credits'; }
    if(call.providerError || [429,500,502,503,504].includes(response.status)) throw new Error('Temporary provider failure');
    return response;
  } catch(e) { call.status='error';call.latencyMs=Date.now()-start;save('ledger.json',ledger);throw e; }
};
const modelQueues=new Map(), modelLastStart=new Map();
async function completion(game,role,fn) {
  const model=game.seats[(await contexts.get(game.id).storage.get('gameState')).currentTeam][role];
  for(let attempt=0;attempt<4;attempt++) {
    if(stopped) throw new Error('Benchmark stopped: '+stopReason);
    const previous=modelQueues.get(model)||Promise.resolve();
    let release;
    const ticket=new Promise(r=>{release=r;});
    modelQueues.set(model,ticket);
    await previous;
    const delay=Math.max(0,1000-(Date.now()-(modelLastStart.get(model)||0)));
    if(delay) await new Promise(r=>setTimeout(r,delay));
    modelLastStart.set(model,Date.now());
    // Space request starts; don't serialize the entire model generation.
    release();
    try { return await context.run({gameId:game.id,role},fn); }
    catch(e) { if(stopped||attempt===3) throw e; await new Promise(r=>setTimeout(r,2000*(attempt+1))); }
  }
}

const contexts=new Map();

async function play(game) {
  const storage=new MemoryStorage();
  let room=new engine.GameRoom({storage},{});
  await action(room,'/create',{roomCode:game.id});
  const fresh=await storage.get('gameState');
  const partial=load(`partial-${game.id}.json`,null);
  const state=partial?.state || {...fresh,...manifest.boards[game.boardId],phase:'playing',roleConfig:{redSpymaster:'ai',redGuesser:'ai',blueSpymaster:'ai',blueGuesser:'ai'},giveAIPastTurnInfo:manifest.giveAIPastTurnInfo,simulationCount:0,assassinBehavior:'instant_loss'};
  await storage.put('gameState',state);
  room=new engine.GameRoom({storage},{});
  contexts.set(game.id,{storage});
  const turns=partial?.turns || [];
  let status='complete',error=null,assassinTeam=partial?.assassinTeam??null;
  try {
    while((await storage.get('gameState')).phase!=='finished' && turns.length<manifest.maxTurns) {
      const gs=await storage.get('gameState'), team=gs.currentTeam, seats=game.seats[team];
      const turn={team,clue:null,guesses:[],invalid:null};
      const clue=await completion(game,'spymaster',()=>engine.generateAIClue(apiKey,gs,team,seats.spymaster,manifest.reasoningEffort));
      turn.clue=clue;
      const accepted=await action(room,'/clue',{word:clue.clue,number:clue.number});
      if(!accepted.ok || typeof clue.clue!=='string' || !/^\p{L}[\p{L}'-]*$/u.test(clue.clue)) {
        turn.invalid='spymaster: '+(accepted.error||'Clue must be one word');
        await action(room,'/end-turn');
      } else {
        const guess=await completion(game,'guesser',async()=>engine.generateAIGuesses(apiKey,await storage.get('gameState'),clue.clue,clue.number,team,seats.guesser,manifest.reasoningEffort));
        turn.guesserReasoning=guess.reasoning;
        if(!Number.isInteger(guess.stopAfter)||guess.stopAfter<0||!Array.isArray(guess.suggestions)) turn.invalid='guesser: malformed action';
        else for(const suggestion of guess.suggestions.slice(0,Math.min(guess.stopAfter,clue.number+1))) {
          const outcome=await action(room,'/guess',{word:suggestion.word});
          if(!outcome.ok) {turn.invalid='guesser: '+outcome.error;break;}
          turn.guesses.push(outcome.result);
          if(outcome.result.cardType==='assassin') assassinTeam=team;
          if(outcome.result.turnEnded) break;
        }
        const after=await storage.get('gameState');
        if(after.phase==='playing' && after.currentTeam===team) await action(room,'/end-turn');
      }
      turns.push(turn);
      save(`partial-${game.id}.json`,{state:await storage.get('gameState'),turns,assassinTeam});
    }
    if((await storage.get('gameState')).phase!=='finished') status='draw';
  } catch(e) { status='error';error=e.message.replace(/sk-or-[\w-]+/g,'[redacted]'); }
  const final=await storage.get('gameState');
  const result={...game,status,error,winner:final.winner,assassinTeam,turns,board:manifest.boards[game.boardId],calls:ledger.calls.filter(c=>c.gameId===game.id)};
  results[game.id]=result;save('games.json',results);publish();
  console.log(JSON.stringify({game:game.id,status,turns:turns.length,winner:final.winner,costUsd:ledger.calls.reduce((s,c)=>s+(c.cost??0),0)}));
}
try {
  const pending=manifest.blocks.flatMap(b=>b.games).filter(g=>!results[g.id] || (args.includes('--retry-errors') && results[g.id].status==='error'));
  let next=0;
  const concurrency=Number(option('--concurrency','4'));
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8) throw new Error('Concurrency must be 1-8.');
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<pending.length&&!stopped){const game=pending[next++];await play(game);}}));
  const endInfo=await originalFetch('https://openrouter.ai/api/v1/key',{headers:auth});
  if(endInfo.ok) {manifest.keyUsageUsd=(await endInfo.json()).data.usage; save('manifest.json',manifest);}
  manifest.stopReason=stopReason; save('manifest.json',manifest);
  const summary=publish();
  console.log(JSON.stringify({finished:true,completedGames:summary.completedGames,costUsd:summary.costUsd,chargedOrReservedUsd:summary.reservedUsd,stopReason}));
} finally {globalThis.fetch=originalFetch;closeSync(lock);unlinkSync(lockPath);}
