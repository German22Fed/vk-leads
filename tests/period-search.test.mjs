import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refreshObservation} from '../dist/period-search.js';
import {filterGroups,mergeGroups} from '../dist/core.js';

test('Repeated refresh retains the original range and history, and resumes without a duplicate cycle',async()=>{
 let configs=0,cycles=0;const starts=[];
 const collector={busy:false,state:{config:null,records:{old:1}},stop(){},async cycle(){cycles++;return {status:'ok'};},start(o){starts.push(o);},snapshot(){return this.state;}};
 const ensureConfig=async()=>{configs++;collector.state.config={startId:500};};
 for(let i=0;i<3;i++)await refreshObservation({collector,ensureConfig});
 assert.equal(configs,1);assert.equal(cycles,3);assert.equal(collector.state.records.old,1);
 assert.deepEqual(starts,[{immediate:false},{immediate:false},{immediate:false}]);
});
test('Failed or cancelled period refresh does not start observation or fall back to ID snapshots',async()=>{
 let starts=0;const collector={busy:false,state:{config:{}},stop(){},async cycle(){return {status:'error',error:'VK permission denied'};},start(){starts++;}};
 await assert.rejects(refreshObservation({collector}),/VK permission denied/);
 const abort=new AbortController();collector.cycle=async()=>{abort.abort();return {status:'ok'};};
 await assert.rejects(refreshObservation({collector,signal:abort.signal}),/остановлен/);
 assert.equal(starts,0);
});
test('A previous scan must finish before starting another; timeout is actionable',async()=>{
 let clock=0,cycles=0;const collector={busy:true,state:{config:{}},stop(){},async cycle(){cycles++;return {status:'ok'};},start(){},snapshot(){return {};}};
 await assert.rejects(refreshObservation({collector,now:()=>clock,wait:async ms=>{clock+=ms;}}),/завершается/);
 assert.equal(cycles,0);
 await refreshObservation({collector,wait:async()=>{collector.busy=false;}});assert.equal(cycles,1);
});

test('Time selection survives repeated merges and switching hour / 1–3h / Moscow day',()=>{
 const now=Date.parse('2026-10-30T20:00:00+03:00'),H=3600000;
 const row=(id,from,to)=>({id,name:'Мебель на заказ',firstSeen:now,available:true,status:'new',observation:{verdict:'candidate_today',appearance:{kind:'candidate',from:now-from*H,to:now-to*H}}});
 const rows=[row(1,.5,.4),row(2,2,1.9),row(3,18,17.9),row(4,21,20.9),row(5,1.1,.9),{id:6,firstSeen:now,available:true,members:1000000}, {...row(7,.2,.1),observation:{verdict:'baseline'}},{...row(8,.2,.1),available:false}];
 let merged=[];
 for(let i=0;i<3;i++){
  merged=mergeGroups(merged,rows,now+i*1000);
  const ids=period=>filterGroups(merged,{dateBasis:'appeared',period},now).map(g=>g.id);
  assert.deepEqual(ids('1h'),[1,5]);assert.deepEqual(ids('1-3h'),[2]);assert.deepEqual(ids('today'),[1,2,3,5]);
  assert.deepEqual(filterGroups(merged,{dateBasis:'created',period:'today'},now),[]);
 }
});

