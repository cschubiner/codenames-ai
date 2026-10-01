export const MODELS = [
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
  { id: 'openai/gpt-6-sol', name: 'GPT-6 Sol' },
];
export const AVAILABLE_MODELS = [...MODELS,
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1' },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra' },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
];
export function seeded(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function makeBoard(words, seed) {
  const random = seeded(seed);
  return { words: shuffle(words, random).slice(0, 25), key: shuffle([...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'], random) };
}
export function schedule(boardCount, seed = 20261001, models = MODELS, options = {}) {
  const blocks = [];
  for (let board = 0; board < boardCount; board++) for (const role of ['spymaster', 'guesser']) {
    for (let a = 0; a < models.length; a++) for (let b = a + 1; b < models.length; b++) {
      const partners = models.filter((m, i) => i !== a && i !== b && (!options.partnerPanel || options.partnerPanel.includes(m.id)));
      if(partners.length<2) throw new Error('Every matchup needs at least two eligible partner models.');
      const pairs = [];
      for(let x=0;x<partners.length;x++) for(let y=x+1;y<partners.length;y++) pairs.push([x,y]);
      const selected = options.partnerPairs ? shuffle(pairs,seeded(seed+board*10000+a*100+b)).slice(0,options.partnerPairs) : pairs;
      for (const [x,y] of selected) {
        const blockId = `${board}-${role}-${a}-${b}-${x}-${y}`;
        const games = [];
        for (let swap = 0; swap < 2; swap++) for (let side = 0; side < 2; side++) {
          const aTeam = side ? 'blue' : 'red', bTeam = side ? 'red' : 'blue';
          const otherRole = role === 'spymaster' ? 'guesser' : 'spymaster';
          const seats = { [aTeam]: { [role]: models[a].id, [otherRole]: partners[swap ? y : x].id }, [bTeam]: { [role]: models[b].id, [otherRole]: partners[swap ? x : y].id } };
          games.push({ id: `${blockId}-${swap}-${side}`, blockId, boardId: board, seed: seed + board, role, a: models[a].id, b: models[b].id, aTeam, seats });
        }
        blocks.push({ id: blockId, games });
      }
    }
  }
  return blocks;
}
// Paired replays of one board are correlated. Resample whole boards, not games.
export function interval(samples, iterations = 2000) {
  if (samples.length < 2) return [0, 1];
  const random = seeded(8127), values = [];
  for (let i = 0; i < iterations; i++) { let sum = 0; for (let j = 0; j < samples.length; j++) sum += samples[Math.floor(random() * samples.length)]; values.push(sum / samples.length); }
  values.sort((a,b) => a-b);
  return [values[Math.floor(iterations * .025)], values[Math.floor(iterations * .975)]];
}
export function summarize(manifest, results, ledger) {
  const models = manifest.models || MODELS;
  const completed = manifest.blocks.filter(b => b.games.every(g => ['complete','draw'].includes(results[g.id]?.status)));
  const eligible = completed.flatMap(b => b.games.map(g => results[g.id]));
  const roles = {};
  for (const role of ['spymaster','guesser']) {
    const games = eligible.filter(g => g.role === role);
    const cells = [];
    for (const model of models) for (const opponent of models.filter(m => m.id !== model.id)) {
      const matches = games.filter(g => [g.a,g.b].includes(model.id) && [g.a,g.b].includes(opponent.id));
      const boards = [...new Set(matches.map(g => g.boardId))];
      const scores = boards.map(board => {
        const subset = matches.filter(g => g.boardId === board);
        return subset.reduce((s,g) => s + outcome(g,model.id),0) / subset.length;
      });
      cells.push({ model: model.id, opponent: opponent.id, games: matches.length, boards: boards.length, score: scores.length ? scores.reduce((s,x)=>s+x,0)/scores.length : null, ci: interval(scores) });
    }
    const rankings = models.map(model => {
      const row = cells.filter(c => c.model === model.id && c.games);
      const mine = games.filter(g => [g.a,g.b].includes(model.id));
      const boardIds = [...new Set(mine.map(g => g.boardId))];
      const boardScores = boardIds.map(id => {
        const opponentScores = models.filter(m=>m.id !== model.id).map(m=>mine.filter(g=>g.boardId===id && [g.a,g.b].includes(m.id))).filter(a=>a.length).map(a=>a.reduce((s,g)=>s+outcome(g,model.id),0)/a.length);
        return opponentScores.reduce((s,x)=>s+x,0)/opponentScores.length;
      });
      const calls = mine.flatMap(g=>g.calls).filter(c=>c.model===model.id && c.role===role);
      return { ...model, score: row.length ? row.reduce((s,c)=>s+c.score,0)/row.length : null, ci: interval(boardScores), games: mine.length, boards: boardIds.length, opponents: row.length, apiCalls: calls.length, cost: calls.reduce((s,c)=>s+(c.cost??0),0), latencyMs: calls.length ? calls.reduce((s,c)=>s+c.latencyMs,0)/calls.length : null, assassinRate: mine.length ? mine.filter(g=>g.assassinTeam === teamOf(g,model.id)).length/mine.length : null, invalidActions: mine.reduce((s,g)=>s+g.turns.filter(t=>t.invalid?.startsWith(role+':') && t.team===teamOf(g,model.id)).length,0) };
    }).sort((a,b)=>(b.score??-1)-(a.score??-1));
    roles[role] = { rankings, cells, games: games.length };
  }
  return { version: 1, generatedAt: new Date().toISOString(), manifest, roles, models, costUsd: ledger.calls.reduce((s,c)=>s+(c.cost??0),0), reservedUsd: ledger.calls.reduce((s,c)=>s+c.charged,0), apiCalls: ledger.calls.length, completedGames: eligible.length, recordedGames: Object.keys(results).length, failedGames: Object.values(results).filter(g=>g.status==='error').length, completedBlocks: completed.length, plannedBlocks: manifest.blocks.length, games: eligible };
}
export function teamOf(game, model) { return game.a === model ? game.aTeam : game.aTeam === 'red' ? 'blue' : 'red'; }
export function outcome(game, model) { return !game.winner ? .5 : game.winner === teamOf(game,model) ? 1 : 0; }
export function reserveCost(body, price) {
  // Conservative text token bound, including schema and framing, plus capped output.
  return (Buffer.byteLength(JSON.stringify(body))*2 + 2048)*price.prompt + body.max_tokens*price.completion;
}
export function reserveCall(ledger, budget, amount, fields = {}) {
  if(!Number.isFinite(amount) || amount < 0) throw new Error('Invalid reservation.');
  const spent = ledger.calls.reduce((s,c)=>s+c.charged,0);
  if(spent + amount > budget) throw new Error('Budget ceiling reached.');
  const call = { ...fields, id: ledger.calls.length, charged:amount, cost:null, status:'pending' };
  ledger.calls.push(call);
  return call;
}
