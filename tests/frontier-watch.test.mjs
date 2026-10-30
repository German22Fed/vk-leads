import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectOnce} from '../server/continuous.mjs';
import {filterGroups,creationTimestamp} from '../dist/core.js';
import {validateFeed} from '../dist/hosted-feed.js';

function setup(){
 let now=Date.UTC(2026,9,30,10),visible=false,fail=false;
 const api=async(m,p)=>{
  if(fail)throw Error('network');
  if(m==='wall.get')return {count:2,items:[{owner_id:p.owner_id,date:Math.floor((p.owner_id===-102?now-86400000:now)/1000)}]};
  return {groups:p.group_ids.split(',').map(Number).map(id=>{
   if(id===1)return {id,name:'Control'};
   if(visible&&id>=101&&id<=106)return {id,name:id===103?'Мама':id===104?'Ozon':id===105?'中文商店':'Мебель на заказ '+id,members_count:id===106?20000:12,is_closed:0,has_photo:1,photo_200:'https://example.org/avatar.jpg',cover:{enabled:1,images:[{url:'https://example.org/cover.jpg'}]}};
   return {id,name:'DELETED',deactivated:'deleted'};
  })};
 };
 return {api,clock:()=>now,discover:async()=>({id:100}),tick(){now+=900000;visible=true;},hide(){visible=false;now+=900000;},fail(){fail=true;}};
}
test('Live-shaped DELETED responses become explicitly labelled frontier candidates, never creation dates',async()=>{
 const f=setup();let r=await collectOnce(f);
 assert.equal(r.feed.groups.length,0);assert.equal(r.feed.observation.frontierProbes,2000);
 f.tick();r=await collectOnce({...f,previous:r.state});
 assert.deepEqual(r.feed.groups.map(g=>g.id),[101]);
 const g=r.feed.groups[0];assert.equal(g.observation.appearance.kind,'frontier_candidate');
 assert.equal(g.observation.appearance.previousResponse,'placeholder');assert.equal(creationTimestamp(g),null);
 assert.equal(validateFeed(r.feed,f.clock()).groups.length,1);
 assert.equal(filterGroups([g],{dateBasis:'appeared',period:'1h'},f.clock()).length,1);
 assert.equal(filterGroups([g],{dateBasis:'created',period:'1h'},f.clock()).length,0);
 assert.equal(filterGroups([g],{dateBasis:'appeared',period:'1-3h'},f.clock()+7200000).length,1);
 assert.ok(g.photo&&g.coverUrl);assert.equal(r.state.records[102].oldestObservedPost<f.clock()-3600000,true);
 f.tick();r=await collectOnce({...f,previous:JSON.parse(JSON.stringify(r.state))});assert.equal(r.feed.groups.length,1);
 f.hide();r=await collectOnce({...f,previous:r.state});assert.equal(r.feed.groups.length,0);
 f.tick();r=await collectOnce({...f,previous:r.state});assert.equal(r.feed.groups.length,0,'A previously available group cannot reappear as new');
 const checkpoint=JSON.stringify(r.state);f.fail();await assert.rejects(collectOnce({...f,previous:r.state}));assert.equal(JSON.stringify(r.state),checkpoint);
});
test('Migration reseeds the current frontier and does not relabel old baseline records',async()=>{
 const f=setup();let r=await collectOnce(f);f.tick();r=await collectOnce({...f,previous:r.state});
 delete r.state.frontierWatch;
 r=await collectOnce({...f,previous:r.state,discover:async()=>({id:106})});
 assert.equal(r.state.frontierWatch.floorId,106);assert.equal(r.state.config.startId,107);
});
test('Named banned groups never qualify as a frontier transition',async()=>{
 const f=setup(),api=f.api;
 f.api=async(m,p)=>{const r=await api(m,p);if(m==='groups.getById')r.groups=r.groups.map(g=>g.name==='DELETED'&&g.id===101?{id:101,name:'Мебель раньше',deactivated:'banned'}:g);return r;};
 let r=await collectOnce(f);f.tick();r=await collectOnce({...f,previous:r.state});assert.equal(r.feed.groups.length,0);
});

test('Frontier evidence cannot forge creation, cross period boundaries or omit its lower ID',async()=>{
 const f=setup();let r=await collectOnce(f);f.tick();r=await collectOnce({...f,previous:r.state});
 const g=r.feed.groups[0],now=f.clock();
 const altered=change=>({...g,observation:{...g.observation,appearance:{...g.observation.appearance,...change}}});
 assert.equal(validateFeed({...r.feed,groups:[altered({lowerId:g.id})]},now).groups.length,0);
 assert.equal(validateFeed({...r.feed,groups:[altered({previousResponse:'guessed'})]},now).groups.length,0);
 assert.equal(filterGroups([altered({from:now-3600001})],{dateBasis:'appeared',period:'1h'},now).length,0);
 const mid=Date.parse('2026-10-30T00:00:00+03:00');
 assert.equal(filterGroups([altered({from:mid-1,to:mid+1000})],{dateBasis:'appeared',period:'today'},mid+10000).length,0);
});
