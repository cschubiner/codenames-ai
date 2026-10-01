import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {combinedLeague,partnerMatrix} from '../docs/leaderboard-data.js';
const models=['a','b','x','y'].map(id=>({id,name:id}));
const game=(id,role,aTeam,winner,swap=false)=>({id,role,a:'a',b:'b',aTeam,winner,boardId:0,calls:[],seats:{[aTeam]:{[role]:'a',[role==='spymaster'?'guesser':'spymaster']:swap?'y':'x'},[aTeam==='red'?'blue':'red']:{[role]:'b',[role==='spymaster'?'guesser':'spymaster']:swap?'x':'y'}}});
test('combined matchups equally weight roles and score blue contenders and draws correctly',()=>{
 const data={models,games:[game('1','spymaster','blue','blue'),game('2','spymaster','red','red'),game('3','guesser','blue','red'),game('4','guesser','red',null)]};
 const league=combinedLeague(data), a=league.cells.find(c=>c.model==='a'&&c.opponent==='b');
 assert.equal(a.score,.625);assert.equal(a.games,4);assert.deepEqual(a.ci,[0,1]);
 assert.equal(league.cells.find(c=>c.model==='b'&&c.opponent==='a').score,.375);
 const uneven=combinedLeague({...data,games:[...data.games,game('5','spymaster','red','blue')]});
 assert.ok(Math.abs(uneven.cells.find(c=>c.model==='a'&&c.opponent==='b').score-(2/3+.25)/2)<1e-9);
});
test('partnerships keep roles distinct, include both leagues, and return only their replays',()=>{
 const data={models,games:[game('1','spymaster','blue','blue'),game('2','guesser','red','red'),game('3','spymaster','red',null,true)]};
 const cells=partnerMatrix(data), ax=cells.find(c=>c.spymaster==='a'&&c.guesser==='x'),xa=cells.find(c=>c.spymaster==='x'&&c.guesser==='a');
 assert.equal(ax.games,1);assert.equal(ax.score,1);assert.deepEqual(ax.gameIds,['1']);
 assert.equal(xa.games,1);assert.deepEqual(xa.gameIds,['2']);
 assert.equal(cells.find(c=>c.spymaster==='a'&&c.guesser==='y').score,.5);
 assert.ok(!cells.some(c=>c.spymaster===c.guesser));
 assert.equal(cells.reduce((s,c)=>s+c.games,0),6);
});
test('published run has 40 games per combined matchup and per directional partnership',()=>{
 const data=JSON.parse(readFileSync(new URL('../docs/benchmark-results-original.json',import.meta.url)));
 const league=combinedLeague(data),pairs=partnerMatrix(data);
 assert.equal(league.games,240);
 for(const row of league.rankings){assert.equal(row.games,120);assert.equal(row.boards,5)}
 for(const cell of league.cells){assert.equal(cell.games,40);assert.equal(cell.boards,5)}
 for(const pair of pairs){assert.equal(pair.games,40);assert.equal(pair.boards,5)}
 assert.equal(pairs.reduce((s,p)=>s+p.games,0),480);
});

import {accumulate} from '../docs/leaderboard-history.js';
test('cumulative history is additive, deduplicates imports, and separates board identities',()=>{
 const first={manifest:{id:'old',boardCount:1},models,games:[{...game('1','spymaster','blue','blue'),status:'complete'}],completedGames:1,costUsd:1,reservedUsd:1,apiCalls:1};
 const second={...first,manifest:{id:'new',boardCount:1},costUsd:2,games:[{...game('1','guesser','red','red'),status:'complete'}]};
 const all=accumulate([first,second]);
 assert.equal(all.completedGames,2);assert.equal(all.manifest.boardCount,2);assert.equal(all.costUsd,3);
 assert.equal(accumulate([all,second]).completedGames,2);
 assert.equal(accumulate([all,second]).costUsd,3);
 const partial={...second,games:[],costUsd:2.5};
 const retained=accumulate([all,partial]);
 assert.equal(retained.completedGames,2);assert.equal(retained.costUsd,3.5);
 assert.ok(retained.games.some(g=>g.runId==='old'));
});
test('all 240 original games remain in the cumulative publication',()=>{
 const original=JSON.parse(readFileSync(new URL('../docs/benchmark-results-original.json',import.meta.url)));
 const cumulative=JSON.parse(readFileSync(new URL('../docs/benchmark-results.json',import.meta.url)));
 assert.equal(original.games.length,240);
 const old=cumulative.games.filter(g=>g.runId===original.manifest.id);
 assert.equal(old.length,240);
 assert.deepEqual(new Set(old.map(g=>g.originalGameId)),new Set(original.games.map(g=>g.id)));
 assert.equal(new Set(cumulative.games.map(g=>g.id)).size,cumulative.games.length);
});
