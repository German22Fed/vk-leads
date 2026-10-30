import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeedLoader,feedOutcome} from '../dist/hosted-feed.js';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runContinuous} from '../server/run-continuous.mjs';
const url='https://example.org/community-feed.json';
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
