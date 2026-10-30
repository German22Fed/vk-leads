import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectOnce,compactState} from '../server/continuous.mjs';
import {validateFeed,feedOutcome} from '../dist/hosted-feed.js';
import {filterGroups} from '../dist/core.js';

function fixture(){
  let now=Date.UTC(2026,9,30,10),phase=0,failed=false;
  const group=id=>({id,name:id===1?'Control':id===103?'Мама':id===105?'delete':'Мебель на заказ '+id,members_count:20,has_photo:1,photo_200:'https://example.org/avatar.jpg',cover:{enabled:1,images:[{url:'https://example.org/cover.jpg'}]}});
  const api=async(method,p)=>{
    if(failed)throw Error('secret should never enter a feed');
    if(method==='wall.get'){
      if(p.owner_id===-106)throw Error('Access denied');
      return {count:1,items:[{owner_id:p.owner_id,date:Math.floor((p.owner_id===-104?now-86400000:now)/1000)}]};
    }
    return {groups:p.group_ids.split(',').map(Number).filter(id=>id===1||id===101||(phase>=2&&id>=102&&id<=106)).map(group)};
  };
  return {api,clock:()=>now,discover:async()=>({id:100}),tick(){now+=900000;phase++;},fail(){failed=true;}};
}

test('VK placeholders for all future IDs report unusable observation instead of promising candidates',async()=>{
 const api=async(m,p)=>({groups:p.group_ids.split(',').map(Number).map(id=>({id,name:id===1?'Control':'delete'}))});
 let r=await collectOnce({api,discover:async()=>({id:100}),clock:()=>Date.UTC(2026,9,30,10)});
 assert.equal(r.feed.observation.checked,2000);assert.equal(r.feed.observation.deleted,2000);
 assert.equal(r.feed.observation.omitted,0);assert.equal(r.feed.observation.tracked,0);
 assert.deepEqual(r.feed.groups,[]);assert.equal(feedOutcome(r.feed).kind,'blocked');
 // A deleted/unavailable placeholder is never evidence of nonexistence.
 r=await collectOnce({api,previous:r.state,clock:()=>Date.UTC(2026,9,30,10,15)});
 assert.deepEqual(r.feed.groups,[]);assert.equal(r.feed.observation.tracked,0);
});
test('Autonomous bootstrap excludes baseline; two absences then appearance; old, deleted and irrelevant excluded',async()=>{
  const f=fixture();let r=await collectOnce(f);
  assert.deepEqual(r.feed.groups,[]);assert.equal(r.state.bootstrap.id,100);
  f.tick();r=await collectOnce({...f,previous:r.state});assert.equal(r.feed.groups.length,0);
  f.tick();r=await collectOnce({...f,previous:r.state});
  assert.deepEqual(r.feed.groups.map(g=>g.id),[102]);
  assert.match(r.feed.groups[0].name,/Мебель/);assert.ok(r.feed.groups[0].photo);assert.ok(r.feed.groups[0].coverUrl);
  assert.equal(r.state.records[104].oldestObservedPost<f.clock()-3600000,true);
  f.tick();r=await collectOnce({...f,previous:JSON.parse(JSON.stringify(r.state))});
  assert.deepEqual(r.feed.groups.map(g=>g.id),[102]);assert.equal(r.feed.cycles,4);
  const before=JSON.stringify(r.state);f.fail();await assert.rejects(collectOnce({...f,previous:r.state}));assert.equal(JSON.stringify(r.state),before);
});
test('Feed validates, deduplicates, rejects stale data and preserves real period boundaries',async()=>{
  const f=fixture();let r=await collectOnce(f);f.tick();r=await collectOnce({...f,previous:r.state});f.tick();r=await collectOnce({...f,previous:r.state});
  const g=r.feed.groups[0],now=f.clock();
  assert.equal(validateFeed({...r.feed,groups:[g,g]},now).groups.length,1);
  assert.equal(validateFeed(r.feed,now+3600001).groups.length,0);
  assert.equal(validateFeed({...r.feed,groups:[{...g,name:'delete'}]},now).groups.length,0);
  assert.equal(validateFeed({...r.feed,groups:[{...g,observation:{appearance:{kind:'baseline'}}}]},now).groups.length,0);
  assert.equal(filterGroups([g],{dateBasis:'appeared',period:'1h'},now).length,1);
  assert.equal(filterGroups([g],{dateBasis:'appeared',period:'1-3h'},now).length,0);
  assert.equal(filterGroups([g],{dateBasis:'appeared',period:'1-3h'},now+7200000).length,1);
  assert.equal(filterGroups([g],{dateBasis:'created',period:'today'},now).length,0);
});
test('Unavailable wall never publishes a new group',async()=>{
 const f=fixture(),api=f.api;f.api=(m,p)=>m==='wall.get'?Promise.reject(Error('denied')):api(m,p);
 let r=await collectOnce(f);f.tick();r=await collectOnce({...f,previous:r.state});f.tick();r=await collectOnce({...f,previous:r.state});
 assert.deepEqual(r.feed.groups,[]);assert.ok(!JSON.stringify(r).includes('denied'));
});
test('Compaction retains active window, bounds pending history and never reuses removed baseline IDs',()=>{
 const now=1000000000,state={config:{startId:10000},records:{}};
 for(let id=1;id<=12000;id++)state.records[id]={id,firstChecked:now-1000,everReturned:id%2===0};
 compactState(state,now);
 assert.ok(Object.keys(state.records).length<=2501);
 assert.ok(state.records[10000]);assert.ok(state.records[12000]);assert.equal(state.records[2],undefined);
});
test('Resynchronization after a gap starts a new baseline and never fabricates historical groups',async()=>{
 const f=fixture();let r=await collectOnce(f);
 r.state.lastFrontierCheck=f.clock()-7*3600000;
 r=await collectOnce({...f,previous:r.state,discover:async()=>({id:10000})});
 assert.equal(r.state.config.startId,10001);assert.equal(r.state.resyncs,1);assert.deepEqual(r.feed.groups,[]);
});
