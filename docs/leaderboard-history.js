import { combinedLeague } from './leaderboard-data.js';
// Merge by permanent run/game identity. Existing completed games are never removed.
export function accumulate(sources) {
  const models=new Map(), games=new Map(), runs=new Map();
  function retainRun(run) {
    const previous=runs.get(run.id);
    const merged={...previous,...run};
    for(const key of ['costUsd','apiCalls','recordedGames','keyUsageUsd']) if(previous?.[key]!=null) merged[key]=Math.max(previous[key],run[key]||0);
    runs.set(run.id,merged);
  }
  for(const source of sources) {
    for(const model of source.models) models.set(model.id,model);
    const inherited=source.manifest.runs;
    if(inherited) for(const run of inherited) retainRun(run);
    else retainRun({
      id:source.manifest.id,models:source.models.length,boardCount:source.manifest.boardCount,
      costUsd:source.costUsd,reservedUsd:source.reservedUsd,apiCalls:source.apiCalls,
      recordedGames:source.recordedGames,failedGames:source.failedGames,
      completedBlocks:source.completedBlocks,plannedBlocks:source.plannedBlocks,
      unavailableModels:source.manifest.unavailableModels||[],
      engineFingerprint:source.manifest.engineFingerprint,methodology:source.manifest.methodology,
      strategyId:source.manifest.strategyId,contenders:source.manifest.contenders,partnerPanel:source.manifest.partnerPanel,createdAt:source.manifest.createdAt,
      keyUsageUsd:source.manifest.keyUsageUsd
    });
    for(const game of source.games) {
      if(!['complete','draw'].includes(game.status)) continue;
      const runId=game.runId||source.manifest.id;
      const id=game.runId?game.id:`${runId}:${game.id}`;
      games.set(id,game.runId?game:{...game,id,runId,originalGameId:game.id,blockId:`${runId}:${game.blockId}`,boardId:`${runId}:${game.boardId}`,boardLabel:`${source.models.length}-model run · Board ${game.boardId+1}`});
    }
  }
  const values=[...games.values()], roster=[...models.values()], history=[...runs.values()];
  const sum=key=>history.reduce((total,run)=>total+(run[key]||0),0);
  const boards=new Set(values.map(g=>g.boardId));
  const base={models:roster,games:values};
  return {
    version:2,generatedAt:new Date().toISOString(),models:roster,games:values,
    manifest:{id:'codenames-cumulative',cumulative:true,runs:history,models:roster,boardCount:boards.size,
      budgetUsd:45,keyUsageUsd:Math.max(0,...history.map(r=>r.keyUsageUsd||0)),
      unavailableModels:[...new Map(history.flatMap(r=>r.unavailableModels).filter(m=>!models.has(m.id)).map(m=>[m.id,m])).values()],
      methodology:'All completed games are retained across runs. Model and matchup percentages use observed outcomes; overall rankings give each observed opponent equal weight. Combined scores give each role equal weight. Sample counts vary by model and pairing. Incomplete comparison blocks can contribute completed games; failed or unfinished games are excluded. Runs differ in board and partner coverage; inspect individual runs for their protocols.',
      engineFingerprint:[...new Set(history.map(r=>r.engineFingerprint))].join(', ')},
    roles:Object.fromEntries(['spymaster','guesser'].map(role=>[role,combinedLeague({...base,games:values.filter(g=>g.role===role)})])),
    completedGames:values.length,recordedGames:sum('recordedGames'),failedGames:sum('failedGames'),
    completedBlocks:sum('completedBlocks'),plannedBlocks:sum('plannedBlocks'),
    costUsd:sum('costUsd'),reservedUsd:sum('reservedUsd'),apiCalls:sum('apiCalls')
  };
}
