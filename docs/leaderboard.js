import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { combinedLeague, partnerMatrix } from './leaderboard-data.js?v=24';
const html = htm.bind(h);
const pct = n => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const money = n => `$${(n || 0).toFixed(n > 0 && n < .001 ? 5 : 3)}`;
// Keep tiny board samples from displaying a falsely precise bootstrap range.
function uncertainty(item) {
  if (!item.boards || item.boards < 2) return [0, 1];
  const n = item.boards, p = item.score, z = 1.959964, z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return [Math.max(0, Math.min(item.ci[0], center - spread)), Math.min(1, Math.max(item.ci[1], center + spread))];
}
function teamOf(g,m) { return g.a === m ? g.aTeam : g.aTeam === 'red' ? 'blue' : 'red'; }
function score(g,m) { return !g.winner ? .5 : g.winner === teamOf(g,m) ? 1 : 0; }
export function Leaderboard() {
  const [data,setData] = useState(null), [error,setError] = useState(null), [run,setRun] = useState('benchmark-results-expanded.json');
  const [role,setRole] = useState('spymaster'), [matchup,setMatchup] = useState(null), [replay,setReplay] = useState(null), [pair,setPair] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);setError(null);setMatchup(null);setPair(null);setReplay(null);
    fetch(run, { cache: 'no-store', signal: controller.signal }).then(r => { if(!r.ok) throw Error('Published results are unavailable.'); return r.json(); }).then(setData).catch(e => { if(e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [run]);
  if(error) return html`<main class="arena"><h1>Model arena</h1><p role="alert">${error}</p><p>Please try again shortly.</p></main>`;
  if(!data) return html`<main class="arena"><p role="status">Loading benchmark results…</p></main>`;
  const league = role==='combined'?combinedLeague(data):data.roles[role], names = Object.fromEntries(data.models.map(m=>[m.id,m.name]));
  const games = data.games.filter(g=>(role==='combined'||g.role === role) && (!matchup || [g.a,g.b].includes(matchup.model) && [g.a,g.b].includes(matchup.opponent)) && (!pair || pair.gameIds.includes(g.id)));
  const pairCells = partnerMatrix(data), bestPair = pairCells.filter(p=>p.games).sort((a,b)=>b.score-a.score)[0];
  const cell = (a,b) => league.cells.find(c=>c.model===a && c.opponent===b);
  const chosen = data.games.find(g=>g.id===replay);
  const otherRole = role==='spymaster'?'guesser':'spymaster';
  const partners = matchup && role!=='combined' ? data.models.filter(m=>m.id!==matchup.model && m.id!==matchup.opponent).map(m=>{
    const subset = games.filter(g=>g.seats[teamOf(g,matchup.model)][otherRole]===m.id);
    return { ...m, games:subset.length, score:subset.length ? subset.reduce((s,g)=>s+score(g,matchup.model),0)/subset.length : null };
  }) : [];
  return html`
    <main class="arena">
      <header class="arena-hero">
        <div><p class="arena-eyebrow">CODENAMES / MODEL ARENA</p><h1>Good clues.<br/>Better teammates.</h1><p class="arena-intro">Two roles. Different partners. One fair test of how well models play together.</p></div>
        <aside class="arena-status"><span class="arena-pill">${data.completedGames ? 'Provisional results' : 'Awaiting first results'}</span><strong>${data.completedGames}</strong><span>games in completed matchup blocks</span><small>Updated ${new Date(data.generatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</small></aside>
      </header>
      <label class="arena-run-picker">Benchmark run<select value=${run} onChange=${e=>setRun(e.target.value)}><option value="benchmark-results-expanded.json">Expanded model comparison</option><option value="benchmark-results.json">Original four-model comparison</option></select></label>
      <p class="arena-run-note">${data.models.length} models · ${data.manifest.boardCount} ${data.manifest.boardCount===1?'board':'boards'} · ${data.manifest.partnerPanel?'Limited reference partner panel':'All eligible partner pairs'}. ${data.manifest.boardCount<2?'One-board results are exploratory; intervals span the full range.':''}</p>
      ${data.manifest.unavailableModels?.map(m=>html`<p class="arena-unavailable">${m.id}: ${m.reason}</p>`)}
      <div class="arena-facts"><span><b>Simulations off</b> · one clue per turn</span><span><b>Mixed teams</b> · no same-model partners</span><span><b>${money(data.costUsd)}</b> measured API spend</span></div>
      <div class="arena-role-tabs" role="tablist" aria-label="Benchmark role">
        ${['spymaster','guesser','combined'].map(r=>html`<button role="tab" aria-selected=${role===r} class=${role===r?'selected':''} onClick=${()=>{setRole(r);setMatchup(null);setPair(null);setReplay(null);}}>${r==='spymaster'?'Spymasters':r==='guesser'?'Guessers':'Both combined'}</button>`)}
      </div>
      <section class="arena-section"><div class="arena-section-head"><div><h2>${role==='spymaster'?'Who gives the best clues?':role==='guesser'?'Who reads the clues best?':'Who performs best across both roles?'}</h2><p>${role==='combined'?'Both roles have equal weight within each opponent matchup.':'Equal weight per opponent.'} Partners and starting sides swap on the same boards.</p></div><span class="arena-pill muted">${league.games} games · low reasoning</span></div>
        <div class="arena-table-scroll"><table class="arena-rankings"><thead><tr><th>Rank / Model</th><th>Match score</th><th>Approx. 95% interval</th><th>Games / Boards</th><th>Opponents</th><th>Team assassin losses</th><th>Cost / Call*</th><th>Response*</th></tr></thead><tbody>
          ${league.rankings.map((m,i)=>html`<tr><th><span class="arena-rank">${m.games?String(league.rankings.findIndex(r=>Math.abs(r.score-m.score)<1e-9)+1).padStart(2,'0'):'—'}</span>${m.name}</th><td class="arena-score">${pct(m.score)}</td><td>${m.games?`${pct(uncertainty(m)[0])}–${pct(uncertainty(m)[1])}`:'—'}</td><td>${m.games} / ${m.boards}</td><td>${m.opponents} / ${data.models.length-1}</td><td>${pct(m.assassinRate)}</td><td>${m.apiCalls?money(m.cost/m.apiCalls):'—'}</td><td>${m.latencyMs?`${(m.latencyMs/1000).toFixed(1)}s`:'—'}</td></tr>`)}
        </tbody></table></div>
        <p class="arena-footnote">Match score = wins + half of draws. Approximate intervals resample whole boards and include a Wilson-style small-sample guard; fewer than two boards shows the full range. Small samples are provisional. *Cost and response time cover this model’s calls in the selected roles.</p>
      </section>
      <section class="arena-section"><div class="arena-section-head"><div><h2>Head to head</h2><p>${role==='combined'?'Both roles combined':role==='spymaster'?'Spymaster versus spymaster':'Guesser versus guesser'}. Read across a row. Select a matchup to explore game replays.</p></div>${matchup && html`<button class="arena-clear" onClick=${()=>{setMatchup(null);setReplay(null);}}>Clear selection</button>`}</div>
        <div class="arena-table-scroll"><table class="arena-matrix" style=${{minWidth:`${160+data.models.length*115}px`}}><thead><tr><th>Row model vs. column model</th>${data.models.map(m=>html`<th>${m.name}</th>`)}</tr></thead><tbody>${data.models.map(m=>html`<tr><th>${m.name}</th>${data.models.map(o=>{const c=cell(m.id,o.id);return html`<td>${m.id===o.id ? html`<span class="arena-diagonal">—</span>` : html`<button disabled=${!c?.games} class="arena-match ${c?.score>.5?'positive':c?.score!=null && c.score<.5?'negative':''} ${matchup?.model===m.id && matchup?.opponent===o.id?'active':''}" aria-label=${`${m.name} versus ${o.name}: ${pct(c?.score)}`} onClick=${()=>{setMatchup(c);setPair(null);setReplay(null);}}><strong>${pct(c?.score)}</strong><small>${c?.games||0} games · ${c?.boards||0} boards</small></button>`}</td>`;})}</tr>`)}</tbody></table></div>
      </section>
      ${matchup && html`<section class="arena-section"><h2>${names[matchup.model]} vs. ${names[matchup.opponent]}</h2><p>${pct(matchup.score)} match score · Approx. 95% interval ${pct(uncertainty(matchup)[0])}–${pct(uncertainty(matchup)[1])}</p>${role!=='combined' && html`<h3>${names[matchup.model]} with each ${otherRole}</h3>`}<div class="arena-partners">${partners.map(p=>html`<div><span>${p.name}</span><strong>${pct(p.score)}</strong><small>${p.games} games</small></div>`)}</div><p class="arena-footnote">Partner pools exclude both contenders. Different matchups therefore have different partner pools; the aggregate measures performance under this schedule.</p></section>`}
      <section class="arena-section"><div class="arena-section-head"><div><h2>Best partners</h2><p>Rows give clues; columns guess. Team win rate across both benchmark leagues.</p></div>${pair && html`<button class="arena-clear" onClick=${()=>{setPair(null);setReplay(null);}}>Clear partner selection</button>`}</div>
        ${bestPair && html`<p class="arena-partner-leader"><b>Highest observed win rate:</b> ${names[bestPair.spymaster]} + ${names[bestPair.guesser]} · ${pct(bestPair.score)} (${bestPair.games} games)</p>`}
        <div class="arena-table-scroll"><table class="arena-matrix" style=${{minWidth:`${160+data.models.length*115}px`}}><thead><tr><th>Spymaster ↓ / Guesser →</th>${data.models.map(m=>html`<th>${m.name}</th>`)}</tr></thead><tbody>${data.models.map(spy=>html`<tr><th>${spy.name}</th>${data.models.map(guess=>{const c=pairCells.find(p=>p.spymaster===spy.id && p.guesser===guess.id);return html`<td>${spy.id===guess.id?html`<span class="arena-diagonal" title="Same-model teams were not tested">—</span>`:html`<button disabled=${!c?.games} class="arena-match ${c?.score>.5?'positive':c?.score!=null && c.score<.5?'negative':''} ${pair?.spymaster===spy.id && pair?.guesser===guess.id?'active':''}" aria-label=${`${spy.name} spymaster with ${guess.name} guesser: ${pct(c?.score)}`} onClick=${()=>{setPair(c);setMatchup(null);setRole('combined');setReplay(null);}}><strong>${pct(c?.score)}</strong><small>${c?.games||0} games · ${c?.boards||0} boards</small></button>`}</td>`;})}</tr>`)}</tbody></table></div>
        <p class="arena-footnote">Pairs keep their roles: reversing spymaster and guesser is a different team. All completed games count once per team. Opposing teams vary by pairing; these win rates describe observed teamwork, not an isolated compatibility effect. Same-model teams and other untested pairs show a dash.</p>
        ${pair && html`<div class="arena-partner-detail"><h3>${names[pair.spymaster]} giving clues + ${names[pair.guesser]} guessing</h3><p>${pct(pair.score)} team win rate · Approx. 95% interval ${pct(uncertainty(pair)[0])}–${pct(uncertainty(pair)[1])} · ${pair.games} games</p><p>The replay list below now shows this partnership.</p></div>`}
      </section>
      <section class="arena-section"><h2>Inside the games</h2><p>Inspect the clues, guesses, and full board behind each result.</p><label class="arena-replay-picker">Game replay<select value=${replay||''} onChange=${e=>setReplay(e.target.value)}><option value="">Choose a completed game</option>${games.map(g=>html`<option value=${g.id}>Board ${g.boardId+1} · ${names[g.a]} vs ${names[g.b]} · ${g.id} · ${g.winner?g.winner+' wins':'draw'}</option>`)}</select></label>
      ${chosen && html`<div class="arena-replay"><div class="arena-teams">${['red','blue'].map(t=>html`<div><b>${t.toUpperCase()} ${chosen.winner===t?'· WINNER':''}</b><span>Spymaster: ${names[chosen.seats[t].spymaster]}</span><span>Guesser: ${names[chosen.seats[t].guesser]}</span></div>`)}</div><div class="arena-board">${chosen.board.words.map((w,i)=>html`<div class=${chosen.board.key[i]}>${w}<small>${chosen.board.key[i]}</small></div>`)}</div><ol class="arena-turns">${chosen.turns.map(t=>html`<li><span class="arena-team-label ${t.team}">${t.team}</span><strong>${t.clue?.clue} · ${t.clue?.number}</strong><p>${t.guesses.map(g=>`${g.word} (${g.cardType})`).join(' → ')||'Passed'}</p>${t.invalid && html`<p class="arena-invalid">${t.invalid}</p>`}<details><summary>Clue explanation</summary><p>${t.clue?.reasoning}</p><p>${t.clue?.riskAssessment}</p></details></li>`)}</ol></div>`}</section>
      <details class="arena-section arena-method"><summary>Methodology & run details</summary><p>${data.manifest.methodology}</p><p>Standard assassin rules, turn history enabled, 40-turn limit, low reasoning, 4,096 output token cap. All calls run locally; viewing this page costs no API credits.</p>${data.manifest.unavailableModels?.map(m=>html`<p>${m.id}: ${m.reason}</p>`)}<p>${data.completedBlocks} / ${data.plannedBlocks} blocks complete. ${data.failedGames} unfinished/error games excluded. Confirmed spend ${money(data.costUsd)}; conservative charged/reserved total ${money(data.reservedUsd)}. Run budget ${money(data.manifest.budgetUsd)}.${data.manifest.keyUsageUsd!=null?` Total experiment API usage, including setup checks: ${money(data.manifest.keyUsageUsd)}.`:""}</p><p>These rankings measure AI teamwork. They do not establish performance with human partners. Each partner pairing is tested together, so compatibility is descriptive rather than a causal estimate of an individual model’s skill.</p><a href=${run} download>Download results and replays</a><p class="arena-fingerprint">Engine ${data.manifest.engineFingerprint}</p></details>
    </main>`;
}
