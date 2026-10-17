#!/usr/bin/env node
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadAvg} from './lib/watchdog.mjs';
import {pinVendor} from './pin-vendor.mjs';
const ROOT=import.meta.dirname;
const productionCommit=process.env.TK_PRODUCTION_COMMIT||'b7157f60b7a2d000c7354a38f91a545fa2b71c05';
const vendor='tool-kumar-'+productionCommit;
if(process.argv[2]==='--worker'){
 const [size,engine]=process.argv.slice(3),src=readFileSync(`/home/ubuntu/.cache/perf-tmp/tklb/fixtures/bench-${size}.json`,'utf8');
 const {parse}=await import(`../../vendor/${vendor}/parser.ts`),{formatDoc,reindent}=await import(`../../vendor/${vendor}/format.ts`);
 const samples=[];let sink=0;
 for(let i=0;i<6;i++){
  if(global.gc)global.gc();
  const t0=performance.now(),v=engine==='source-reindent'?null:engine==='native'?JSON.parse(src):parse(src),t1=performance.now();
  if(engine==='tool-kumar'&&(!v.root||v.error))throw Error('Parse failed');
  const out=engine==='source-reindent'?reindent(src,'  '):engine==='native'?JSON.stringify(v,null,2):formatDoc(src,v,'  '),t2=performance.now();
  sink+=out.length;
  samples.push({phase:i===0?'cold':'warm',parseMs:t1-t0,formatMs:t2-t1,totalMs:t2-t0,...(engine==='tool-kumar'?{exact:v.exact}:{})});
 }
 const warm=samples.slice(1),stats=k=>({best:Math.min(...warm.map(x=>x[k])),median:warm.map(x=>x[k]).sort((a,b)=>a-b)[2]});
 console.log(JSON.stringify({size,engine,bytes:Buffer.byteLength(src),sha256:createHash('sha256').update(src).digest('hex'),samples,cold:samples[0],warm:{parseMs:stats('parseMs'),formatMs:stats('formatMs'),totalMs:stats('totalMs')},sink}));
}else{
 if(!process.env.TKLB_HEAVY_LOCK||process.env.TMPDIR!=='/home/ubuntu/.cache/perf-tmp')throw Error('Run inside v2-batch.sh');
 pinVendor(productionCommit);
 const checkpoint=`${ROOT}/results/parse-cost/checkpoint-${productionCommit}.json`;
 mkdirSync(`${ROOT}/results/parse-cost`,{recursive:true});
 const r=(process.argv.includes('--resume')&&existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):null)||{environment:JSON.parse(readFileSync(ROOT+'/environment.json')),startedAt:new Date().toISOString(),node:process.version,vendor,commit:vendor.slice(11),method:'One fresh Node process per fixture and implementation; first call cold; next five warm; GC outside each timed region; parse then format with two spaces. formatDoc is the production formatter, including its native-safe fast path.',loadAtStart:loadAvg(),measurements:[]};
 for(const size of ['1mb','10mb'])for(const engine of ['native','tool-kumar','source-reindent']){
  if(r.measurements.some(m=>m.size===size&&m.engine===engine))continue;
  if(loadAvg().one>=4){writeFileSync(checkpoint,JSON.stringify(r,null,2)+'\n');console.error('Load gate >=4 before worker; checkpoint saved, no worker started');process.exit(75);}
  const load=loadAvg();const one=JSON.parse(execFileSync(process.execPath,['--expose-gc',`${ROOT}/parse-cost.mjs`,'--worker',size,engine],{encoding:'utf8',env:process.env}));
  r.measurements.push({...one,loadAtStart:load,loadAtEnd:loadAvg()});writeFileSync(checkpoint,JSON.stringify(r,null,2)+'\n');
 }
 const src=readFileSync('/home/ubuntu/.cache/perf-tmp/tklb/fixtures/bench-1mb.json','utf8');const ids=[...src.matchAll(/"account_number":(\d+)/g)].map(m=>m[1]);
 r.nativeUnsafeIntegerCheck={fixture:'bench-1mb.json',unsafeIntegers:ids.filter(x=>BigInt(x)>9007199254740991n).length,changed:ids.filter(x=>BigInt(x)!==BigInt(JSON.parse(x))).length,exampleSource:'9007199254756831',exampleNative:JSON.stringify(JSON.parse('{"id":9007199254756831}'))};
 r.finishedAt=new Date().toISOString();r.loadAtEnd=loadAvg();
 mkdirSync(`${ROOT}/results/parse-cost`,{recursive:true});
 const f=`${ROOT}/results/parse-cost/${r.startedAt.replace(/[:.]/g,'-')}.json`;writeFileSync(f,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r,null,2));
}
