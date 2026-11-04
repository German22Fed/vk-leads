import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeedLoader,feedOutcome,validateFeed,startFeedRefresh,syncPeriodButtons} from '../dist/hosted-feed.js';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runContinuous} from '../server/run-continuous.mjs';
const url='https://example.org/community-feed.json';

const sample=(id,now)=>({id,name:'Мебель на заказ',collectorFeed:true,available:true,members:5,verifiedAt:now,wallUnavailable:false,
 observation:{verdict:'candidate_today',appearance:{kind:'candidate',from:now-600000,to:now-300000},wallCheckedAt:now,wallError:null}});
test('Profile and wall checks expire independently; older original posts reject a card',()=>{
 const now=10000000000,g=sample(42,now),feed={version:1,status:'ok',updatedAt:now,groups:[g]};
 assert.equal(validateFeed(feed,now).groups.length,1);
 for(const patch of [{wallCheckedAt:now-3600001},{wallCheckedAt:now+1},{wallCheckedAt:null},{wallError:'denied'},{oldestObservedPost:now-900000}]){
  assert.equal(validateFeed({...feed,groups:[{...g,observation:{...g.observation,...patch}}]},now).groups.length,0);
 }
});

test('A delayed snapshot remains visible for recovery and reports a warning',()=>{
 const now=10000000000,g=sample(42,now-2*3600000),feed={version:1,status:'ok',updatedAt:now-2*3600000,groups:[g]};
 const result=validateFeed(feed,now);assert.equal(result.stale,false);assert.equal(result.degraded,true);assert.equal(result.groups.length,1);
 assert.equal(feedOutcome(result,1).kind,'warning');assert.match(feedOutcome(result,1).message,/последний рабочий снимок/i);
});

test('Temporary collector failure keeps the previous published cards',()=>{
 const now=10000000000,g=sample(42,now),feed={version:1,status:'ok',updatedAt:now-2*3600000,groups:[g],collector:{status:'error',errorCode:'collection_failed'}};
 const result=validateFeed(feed,now);assert.equal(result.groups.length,1);assert.equal(feedOutcome(result,1).kind,'warning');
});

test('Snapshots older than six hours are withheld',()=>{
 const now=10000000000,g=sample(42,now-7*3600000),feed={version:1,status:'ok',updatedAt:now-7*3600000,groups:[g]};
 const result=validateFeed(feed,now);assert.equal(result.stale,true);assert.equal(result.groups.length,0);assert.equal(feedOutcome(result,0).kind,'error');
});
test('Successive snapshots add real IDs once, and an older server snapshot cannot roll the feed back',async()=>{
 let now=10000000000,index=0;const seen=[];
 const snapshots=[{version:1,status:'ok',updatedAt:now,groups:[sample(1,now)]},{version:1,status:'ok',updatedAt:now+60000,groups:[sample(1,now),sample(2,now)]}];
 const load=createFeedLoader({url,clock:()=>now,onState(){},onData:d=>{seen.push(d);return d.groups.length;},fetchImpl:async()=>({ok:true,json:async()=>snapshots[index]})});
 await load();index=1;now+=60000;await load();await load();index=0;await load();
 assert.deepEqual(seen.map(d=>d.groups.length),[1,2,2,2]);assert.deepEqual(seen.map(d=>d.refresh.added),[0,1,0,0]);
 assert.equal(seen.at(-1).refresh.addedTotal,1);assert.equal(seen.at(-1).refresh.olderSnapshotIgnored,true);
});
test('Refresh resumes on visibility and connectivity without duplicate focus requests',()=>{
 let now=0,calls=0,interval;const handlers={};const target=()=>({addEventListener:(k,f)=>handlers[k]=f,removeEventListener:k=>delete handlers[k]});
 const doc={...target(),hidden:false},win=target();
 const stop=startFeedRefresh(()=>calls++,{doc,win,clock:()=>now,every:f=>(interval=f,1),cancel(){interval=null;}});
 assert.equal(calls,1);handlers.focus();assert.equal(calls,1);
 doc.hidden=true;now=60000;interval();assert.equal(calls,1);
 doc.hidden=false;handlers.visibilitychange();assert.equal(calls,2);
 now+=6000;handlers.online();assert.equal(calls,3);stop();assert.deepEqual(handlers,{});
});
test('Collector and main period controls always display the same persistent selection',()=>{
 const nodes=['','1h','1-3h','today'].flatMap(period=>['period','cloudPeriod'].map(key=>({dataset:{[key]:period},classList:{toggle(k,v){this[k]=v;}},setAttribute(k,v){this[k]=v;}})));
 const root={querySelectorAll:()=>nodes};
 for(const period of ['1h','today','1-3h','']){
  syncPeriodButtons(period,root);
  assert.equal(nodes.filter(b=>b.classList.selected).length,2);
  for(const b of nodes)assert.equal(b['aria-pressed'],String((b.dataset.period??b.dataset.cloudPeriod)===period));
 }
});
test('Concurrent clicks share a request; later searches fetch again and report waiting rather than success',async()=>{
 let resolve,calls=0,updated=0;const states=[];
 const load=createFeedLoader({url,fetchImpl:async()=>{calls++;await new Promise(r=>resolve=r);return {ok:true,json:async()=>({version:1,status:'waiting',groups:[]})};},onState:s=>states.push(s),onData:()=>{updated++;return 0;}});
 const first=load(),second=load();assert.equal(first,second);assert.equal(states[0].kind,'loading');
 await Promise.resolve();assert.equal(calls,1);resolve();assert.equal((await first).kind,'blocked');assert.equal(updated,1);
 const third=load();await Promise.resolve();resolve();await third;assert.equal(calls,2);assert.equal(states.at(-1).setup,true);
});
test('Errors, invalid JSON and timeouts unlock search and allow successful retry',async()=>{
 let n=0;const states=[];
 const load=createFeedLoader({url,onState:s=>states.push(s),onData:()=>0,fetchImpl:()=>{
   n++;if(n===1)throw new TypeError('network');if(n===2)return {ok:false,status:404};
   if(n===3)return {ok:true,json:async()=>{throw Error('html');}};
   if(n===4)throw new DOMException('timeout','TimeoutError');
   return {ok:true,json:async()=>({version:1,status:'ok',updatedAt:Date.now(),groups:[]})};
 }});
 for(let i=0;i<4;i++)assert.equal((await load()).kind,'error');
 assert.equal((await load()).kind,'ready');assert.equal(n,5);assert.match(states[7].message,/15 секунд/);
});
test('Server failure is shown separately from empty results; selected count is used',()=>{
 assert.equal(feedOutcome({status:'waiting',groups:[],collector:{status:'error',errorCode:'missing_token'}}).title,'Сборщик не подключён');
 assert.equal(feedOutcome({status:'ok',groups:[],collector:{status:'error',errorCode:'collection_failed'}}).kind,'error');
 const outcome=feedOutcome({status:'ok',updatedAt:Date.now(),groups:[{},{}]},0);
 assert.match(outcome.message,/фильтрами: 0/);assert.match(outcome.message,/ленте: 2/);
});
test('CLI without key publishes actionable failure without erasing checkpoint or prior cards',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'vk-leads-test-'));
 t.after(async()=>{if(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep))await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(root,'dist'));await mkdir(path.join(root,'collector-data'));
 const old={version:1,status:'ok',updatedAt:123,groups:[{id:42}]};
 await writeFile(path.join(root,'dist/community-feed.json'),JSON.stringify(old));await writeFile(path.join(root,'collector-data/state.json'),'checkpoint');
 const result=await runContinuous({token:'',dir:root,log:{error(){}}});
 assert.equal(result,1);const feed=JSON.parse(await readFile(path.join(root,'dist/community-feed.json'),'utf8'));
 assert.deepEqual(feed.groups,old.groups);assert.equal(feed.updatedAt,123);assert.equal(feed.collector.errorCode,'missing_token');
 assert.equal(await readFile(path.join(root,'collector-data/state.json'),'utf8'),'checkpoint');
});
