import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,schedule,makeBoard,summarize,reserveCall} from './core.mjs';
import {loadEngine,MemoryStorage,action} from './engine.mjs';

test('every role matchup swaps partners and sides without same-model teams',()=>{
 const blocks=schedule(2);
 assert.equal(blocks.length,24);
 for(const block of blocks){
  assert.equal(block.games.length,4);
  const first=block.games[0];
  assert.deepEqual(block.games.map(g=>g.aTeam),['red','blue','red','blue']);
  for(const g of block.games){
   for(const team of ['red','blue']) assert.notEqual(g.seats[team].spymaster,g.seats[team].guesser);
   assert.deepEqual([g.seats.red[g.role],g.seats.blue[g.role]].sort(),[g.a,g.b].sort());
   const other=g.role==='spymaster'?'guesser':'spymaster';
   assert.ok(![g.a,g.b].includes(g.seats.red[other]));
   assert.ok(![g.a,g.b].includes(g.seats.blue[other]));
   assert.equal(g.seed,first.seed);
  }
 }
});
test('seeded boards are stable, unique and have standard card counts',()=>{
 const words=Array.from({length:50},(_,i)=>`WORD${i}`), board=makeBoard(words,42);
 assert.deepEqual(board,makeBoard(words,42));assert.notDeepEqual(board,makeBoard(words,43));
 assert.equal(new Set(board.words).size,25);
 assert.equal(board.key.filter(k=>k==='red').length,9);assert.equal(board.key.filter(k=>k==='blue').length,8);
});
test('rankings track the contender on either side and reject incomplete blocks',()=>{
 const blocks=schedule(1).slice(0,1), manifest={blocks};
 const games=Object.fromEntries(blocks[0].games.map(g=>[g.id,{...g,status:'complete',winner:g.aTeam,turns:[],calls:[]} ]));
 const summary=summarize(manifest,games,{calls:[]});
 assert.equal(summary.roles.spymaster.rankings.find(m=>m.id===MODELS[0].id).score,1);
 assert.equal(summary.roles.spymaster.rankings.find(m=>m.id===MODELS[1].id).score,0);
 assert.deepEqual(summary.roles.spymaster.rankings[0].ci,[0,1]);
 delete games[blocks[0].games[3].id];
 assert.equal(summarize(manifest,games,{calls:[]}).completedGames,0);
});
test('reservations survive resume and prevent concurrent calls crossing the ceiling',()=>{
 const ledger={calls:[]};reserveCall(ledger,1,.7);
 const resumed=JSON.parse(JSON.stringify(ledger));
 assert.throws(()=>reserveCall(resumed,1,.4),/ceiling/);
 assert.equal(resumed.calls.length,1);
 reserveCall(resumed,1,.3);assert.equal(resumed.calls.length,2);
 assert.throws(()=>reserveCall(resumed,1,NaN),/Invalid/);
});
test('local runner uses Worker rules: wrong guess ends turn and assassin loses',async()=>{
 const engine=await loadEngine(),storage=new MemoryStorage();let room=new engine.GameRoom({storage},{});
 await action(room,'/create',{roomCode:'TEST'});let gs=await storage.get('gameState');
 gs.phase='playing';gs.words=['APPLE','MOON','BOMB'];gs.key=['red','blue','assassin'];gs.revealed=[false,false,false];gs.redRemaining=1;gs.blueRemaining=2;
 await storage.put('gameState',gs);room=new engine.GameRoom({storage},{});
 assert.equal((await action(room,'/clue',{word:'APPLE',number:1})).ok,false);
 assert.equal((await action(room,'/clue',{word:'Fruit',number:1})).ok,true);
 const wrong=await action(room,'/guess',{word:'MOON'});assert.equal(wrong.result.turnEnded,true);
 assert.equal((await storage.get('gameState')).currentTeam,'blue');
 await action(room,'/clue',{word:'Danger',number:1});
 const assassin=await action(room,'/guess',{word:'BOMB'});assert.equal(assassin.result.winner,'red');assert.equal(assassin.result.gameOver,true);
});
test('shared guesser prompt contains no secret key or intended targets',async(t)=>{
 const engine=await loadEngine();
 t.mock.method(globalThis,'fetch',async(_,init)=>{
  const body=JSON.parse(init.body),prompt=body.messages[0].content;
  assert.ok(prompt.includes('APPLE'));assert.ok(prompt.includes('BOMB'));
  assert.ok(!prompt.includes('PRIVATE_SECRET_TARGET'));assert.ok(!prompt.includes('"key"'));
  assert.deepEqual(body.reasoning,{effort:'low'});assert.ok(!('temperature' in body));
  return Response.json({choices:[{message:{content:JSON.stringify({reasoning:'fruit',suggestions:[{word:'APPLE',confidence:.9}],stopAfter:1})}}]});
 });
 await engine.generateAIGuesses('sk-or-test',{words:['APPLE','BOMB'],key:['red','assassin'],revealed:[false,false],redRemaining:1,blueRemaining:1,giveAIPastTurnInfo:false,currentClue:{intendedTargets:['PRIVATE_SECRET_TARGET']}},'Fruit',1,'red','google/gemini-3.8-flash','low');
});
