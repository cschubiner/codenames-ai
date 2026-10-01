// Pure aggregation of the already-published complete matchup blocks. No API calls.
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const boardsOf = games => [...new Set(games.map(g => g.boardId))];
const teamOf = (g, model) => g.a === model ? g.aTeam : g.aTeam === 'red' ? 'blue' : 'red';
const outcome = (g, team) => !g.winner ? .5 : g.winner === team ? 1 : 0;
function interval(values) {
  if (values.length < 2) return [0, 1];
  let seed = 8127;
  const random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const samples = Array.from({length:2000}, () => mean(values.map(() => values[Math.floor(random()*values.length)]))).sort((a,b)=>a-b);
  return [samples[50], samples[1950]];
}
function roleAverage(games, model) {
  return mean(['spymaster','guesser'].map(role => mean(games.filter(g=>g.role===role).map(g=>outcome(g,teamOf(g,model))))).filter(x=>x!=null));
}
export function combinedLeague(data) {
  const {models,games} = data;
  const cells = models.flatMap(m=>models.filter(o=>o.id!==m.id).map(o=>{
    const matches = games.filter(g=>[g.a,g.b].includes(m.id) && [g.a,g.b].includes(o.id));
    const boards = boardsOf(matches);
    return {model:m.id,opponent:o.id,games:matches.length,boards:boards.length,score:roleAverage(matches,m.id),ci:interval(boards.map(id=>roleAverage(matches.filter(g=>g.boardId===id),m.id)))};
  }));
  const rankings = models.map(m=>{
    const mine = games.filter(g=>[g.a,g.b].includes(m.id)), boards = boardsOf(mine);
    const row = cells.filter(c=>c.model===m.id && c.games);
    const calls = mine.flatMap(g=>(g.calls||[]).filter(c=>c.model===m.id && c.role===g.role));
    const boardScores = boards.map(id=>mean(models.filter(o=>o.id!==m.id).map(o=>roleAverage(mine.filter(g=>g.boardId===id && [g.a,g.b].includes(o.id)),m.id)).filter(x=>x!=null)));
    return {...m,score:mean(row.map(c=>c.score)),ci:interval(boardScores),games:mine.length,boards:boards.length,opponents:row.length,apiCalls:calls.length,cost:calls.reduce((s,c)=>s+(c.cost??0),0),latencyMs:mean(calls.map(c=>c.latencyMs)),assassinRate:mean(mine.map(g=>g.assassinTeam===teamOf(g,m.id)?1:0))};
  }).sort((a,b)=>(b.score??-1)-(a.score??-1));
  return {rankings,cells,games:games.length};
}
export function partnerMatrix(data) {
  return data.models.flatMap(spy=>data.models.filter(guess=>guess.id!==spy.id).map(guess=>{
    const appearances = data.games.flatMap(g=>['red','blue'].filter(team=>g.seats[team].spymaster===spy.id && g.seats[team].guesser===guess.id).map(team=>({game:g,team,score:outcome(g,team)})));
    const boards = boardsOf(appearances.map(a=>a.game));
    return {spymaster:spy.id,guesser:guess.id,score:mean(appearances.map(a=>a.score)),games:appearances.length,boards:boards.length,ci:interval(boards.map(id=>mean(appearances.filter(a=>a.game.boardId===id).map(a=>a.score)))),gameIds:appearances.map(a=>a.game.id)};
  }));
}
