import {readFileSync,writeFileSync,existsSync,copyFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {accumulate} from '../docs/leaderboard-history.js';
import {summarize} from './core.mjs';
const args=process.argv.slice(2), option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=resolve(new URL('../',import.meta.url).pathname), publicPath=join(root,'docs/benchmark-results.json');
const originalPath=join(root,'docs/benchmark-results-original.json');
if(!existsSync(originalPath)) {
 const original=JSON.parse(readFileSync(publicPath));
 if(original.manifest.cumulative) throw Error('Original snapshot missing; preserve it before merging.');
 copyFileSync(publicPath,originalPath);
}
const sources=[JSON.parse(readFileSync(publicPath))];
if(args.includes('--run')) {
 const directory=resolve(option('--run',''));
 const read=name=>JSON.parse(readFileSync(join(directory,name)));
 const manifest=read('manifest.json'),results=read('games.json'),ledger=read('ledger.json');
 const current=summarize(manifest,results,ledger);
 // Retain every completed game, including games from partially finished blocks.
 current.games=Object.values(results).filter(g=>['complete','draw'].includes(g.status));
 current.completedGames=current.games.length;
 sources.push(current);
}
const merged=accumulate(sources),old=sources[0];
if(merged.completedGames<old.completedGames) throw Error('Refusing to remove historical games.');
writeFileSync(publicPath+'.tmp',JSON.stringify(merged));renameSync(publicPath+'.tmp',publicPath);
console.log(JSON.stringify({totalGames:merged.completedGames,runs:merged.manifest.runs.length,models:merged.models.length,costUsd:merged.costUsd}));
