import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectOnce,compactState,selectRechecks} from '../server/continuous.mjs';
import {validateFeed,feedOutcome} from '../dist/hosted-feed.js';
import {filterGroups,creationTimestamp} from '../dist/core.js';

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

test('VK placeholders are stored as frontier probes without publishing fake cards',async()=>{
 const api=async(m,p)=>({groups:p.group_ids.split(',').map(Number).map(id=>({id,name:id===1?'Control':'delete'}))});
 let r=await collectOnce({api,discover:async()=>({id:100}),clock:()=>Date.UTC(2026,9,30,10)});
 assert.equal(r.feed.observation.checked,2000);assert.equal(r.feed.observation.deleted,2000);
 assert.equal(r.feed.observation.omitted,0);assert.equal(r.feed.observation.tracked,0);
 assert.deepEqual(r.feed.groups,[]);assert.equal(r.feed.observation.frontierProbes,2000);assert.equal(feedOutcome(r.feed).kind,'ready');
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

test('250 real-shaped transitions survive verification, batching, periods and repeated cycles',async()=>{
 let now=Date.UTC(2026,10,3,10),visible=false;const batches=[];
 const api=async(method,p)=>{
  if(method==='wall.get')return {count:1,items:[{owner_id:p.owner_id,date:Math.floor(now/1000)}]};
  const ids=p.group_ids.split(',').map(Number);batches.push(ids.length);
  assert.ok(ids.length<=100,'VK requests must stay bounded, including the control');
  return {groups:ids.map(id=>id===1?{id,name:'Control'}:visible&&id>=101&&id<=350?
   {id,name:'Мебель на заказ '+id,members_count:12,is_closed:0,has_photo:1}:
   {id,name:'DELETED',deactivated:'deleted'})};
 };
 const opts={api,clock:()=>now,discover:async()=>({id:100})};
 let r=await collectOnce(opts);assert.equal(r.feed.groups.length,0);
 now+=900000;visible=true;r=await collectOnce({...opts,previous:r.state});
 assert.equal(r.feed.groups.length,250);assert.equal(new Set(r.feed.groups.map(g=>g.id)).size,250);
 assert.equal(validateFeed(r.feed,now).groups.length,250);
 assert.equal(filterGroups(r.feed.groups,{period:'1h',dateBasis:'appeared'},now).length,250);
 assert.ok(r.feed.groups.every(g=>creationTimestamp(g)===null));
 now+=900000;r=await collectOnce({...opts,previous:JSON.parse(JSON.stringify(r.state))});
 assert.equal(r.feed.groups.length,250);assert.ok(r.feed.verification.attempted<=250);
 assert.equal(filterGroups(r.feed.groups,{period:'1-3h',dateBasis:'appeared'},now).length,0);
});

test('Hourly and 1-3h candidates precede a large morning backlog; fresh checks are reused',()=>{
 const now=Date.UTC(2026,10,3,17),records={};
 const make=(id,age)=>({id,available:true,appearance:{kind:'frontier_candidate',from:now-age-60000,to:now-age},group:{id,name:'Мебель на заказ '+id,members:12,verifiedAt:now-7200000},wallCheckedAt:now-7200000});
 for(let id=100;id<500;id++)records[id]=make(id,5*3600000);
 records[501]=make(501,1800000);records[502]=make(502,7200000);
 const chosen=selectRechecks(records,now);assert.equal(chosen.length,250);
 assert.deepEqual(chosen.slice(0,2).map(r=>r.id),[501,502]);
 records[501].group.verifiedAt=records[501].wallCheckedAt=now;
 assert.equal(selectRechecks(records,now).some(r=>r.id===501),false);
});



