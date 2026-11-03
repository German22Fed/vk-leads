import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Collector,initialState,recordBatch,verdict,publicRecord,configFor} from '../server/collector.mjs';
import {vkClient,groupRows,normalizeAccessToken} from '../server/vk.mjs';
import {filterGroups,creationTimestamp} from '../dist/core.js';
import {createApp} from '../serve.mjs';
const at=Date.parse('2026-10-21T10:00:00+03:00');

test('Wall to_id confirms old original posts; wrong-owner responses never confirm a wall check',async()=>{
 let items=[{to_id:-42,date:Math.floor((at-86400000)/1000)}];
 const c=new Collector({storage:{},clock:()=>at,api:async()=>({count:1,items})});
 const rec={id:42,group:{},appearance:{kind:'candidate',from:at-3600000,to:at}};
 await c.inspectWall(rec);assert.equal(verdict(rec,at),'older');assert.equal(rec.wallCheckedAt,at);
 items=[{owner_id:-77,date:Math.floor(at/1000)}];
 const unknown={id:42,group:{}};await c.inspectWall(unknown);
 assert.equal(unknown.wallCheckedAt,undefined);assert.match(unknown.wallError,/Не подтверждены/);
});
const group=id=>({id,name:'Test community',has_photo:1,cover:{enabled:1},members_count:2});
const absentTwice=s=>{recordBatch(s,[100],[],at);recordBatch(s,[100],[],at+60000);};
test('Service key input accepts a copied access_token wrapper but not embedded whitespace',()=>{
  assert.equal(normalizeAccessToken('  access_token=abc123456789  '),'abc123456789');
  assert.equal(normalizeAccessToken('"abc123456789"'),'abc123456789');
  assert.equal(/\s/.test(normalizeAccessToken('abc 123456789')),true);
});
test('First scan is baseline, even for a very high ID',()=>{
  const s=initialState();recordBatch(s,[999999999],[group(999999999)],at);
  assert.equal(verdict(s.records[999999999],at),'baseline');
  assert.equal(creationTimestamp(publicRecord(s.records[999999999],at)),null);
});
test('Two successful omissions followed by a return yield an interval candidate, not a creation timestamp',()=>{
  const s=initialState();absentTwice(s);recordBatch(s,[100],[group(100)],at+120000);
  const r=s.records[100];assert.equal(verdict(r,at+180000),'candidate_today');
  assert.equal(r.appearance.from,at+60000);assert.equal(r.appearance.to,at+120000);
  const publicRow=publicRecord(r,at+180000);assert.equal(creationTimestamp(publicRow),null);
  assert.equal(filterGroups([publicRow],{dateBasis:'appeared',period:'today'},at+180000).length,1);
  assert.equal(filterGroups([publicRow],{dateBasis:'created',period:'today'},at+180000).length,0);
});
test('One omission is insufficient, and an existing group becoming visible again is baseline',()=>{
  const s=initialState();recordBatch(s,[100],[],at);recordBatch(s,[100],[group(100)],at+60000);
  recordBatch(s,[100],[],at+120000);recordBatch(s,[100],[],at+180000);recordBatch(s,[100],[group(100)],at+240000);
  assert.equal(verdict(s.records[100],at+240000),'baseline');
});
test('Deactivated IDs do not become new candidates after restoration',()=>{
  const s=initialState();absentTwice(s);recordBatch(s,[100],[{...group(100),deactivated:'banned'}],at+120000);
  recordBatch(s,[100],[group(100)],at+180000);assert.equal(verdict(s.records[100],at+180000),'baseline');
});

test('An incomplete row interrupts missing evidence and never creates a blank card',()=>{
  const s=initialState();absentTwice(s);
  recordBatch(s,[100,101],[{id:100},{id:101,name:''}],at+120000);
  assert.equal(s.records[100].missingChecks,0);assert.equal(s.records[100].available,false);
  assert.equal(s.records[101],undefined);
  recordBatch(s,[100],[group(100)],at+180000);
  assert.equal(verdict(s.records[100],at+180000),'baseline');
});

test('Delete markers interrupt missing evidence and never create a fake card',()=>{
  const s=initialState();absentTwice(s);
  recordBatch(s,[100],[{id:100,name:'delete'}],at+120000);
  assert.equal(s.records[100].missingChecks,0);assert.equal(s.records[100].available,false);
  recordBatch(s,[100],[group(100)],at+180000);
  assert.equal(verdict(s.records[100],at+180000),'baseline');
});

test('Default validation stays strict; partial mode still rejects unrequested and duplicate IDs',()=>{
  assert.throws(()=>groupRows({groups:[{id:100}]},[100]),/название/);
  assert.deepEqual(groupRows({groups:[{id:100}]},[100],{allowIncomplete:true}),[{id:100}]);
  assert.throws(()=>groupRows({groups:[{id:101}]},[100],{allowIncomplete:true}),/Некорректные ID/);
  assert.throws(()=>groupRows({groups:[{id:100},{id:100}]},[100],{allowIncomplete:true}),/Некорректные ID/);
});
test('A pre-midnight request or uncertain multi-day interval is excluded from today',()=>{
  const s=initialState(),mid=Date.parse('2026-10-21T00:00:00+03:00');
  recordBatch(s,[100],[],mid-10000);recordBatch(s,[100],[],mid+1000,mid-1000);recordBatch(s,[100],[group(100)],mid+2000);
  const g=publicRecord(s.records[100],mid+3000);
  assert.equal(verdict(s.records[100],mid+3000),'candidate_other_day');
  assert.equal(filterGroups([g],{dateBasis:'appeared',period:'today'},mid+3000).length,0);
});
test('An old original post disproves creation today; an empty wall does not prove it',()=>{
  const s=initialState();absentTwice(s);recordBatch(s,[100],[group(100)],at+120000);
  s.records[100].oldestObservedPost=at-86400000;
  assert.equal(verdict(s.records[100],at+180000),'older');
  assert.equal(filterGroups([publicRecord(s.records[100],at+180000)],{dateBasis:'appeared'},at+180000).length,0);
  delete s.records[100].oldestObservedPost;
  // A previously inaccessible old group with deleted posts has the SAME observable sequence as a new one.
  assert.equal(verdict(s.records[100],at+180000),'candidate_today');
  assert.equal(creationTimestamp(publicRecord(s.records[100],at+180000)),null);
});
test('Failed API calls and malformed responses never count as missing observations',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'radar-errors-'));
  try {
    const c=new Collector({dir,api:async()=>{throw Error('Network failure');},clock:()=>at});
    await c.configure({startId:100,width:100,intervalSeconds:60});
    assert.equal((await c.cycle()).status,'error');assert.deepEqual(c.state.records,{});
    c.api=async()=>({wrong:[]});await c.cycle();assert.deepEqual(c.state.records,{});
    c.api=async()=>({groups:[]});await c.cycle();assert.deepEqual(c.state.records,{});
    assert.throws(()=>groupRows({groups:[group(5)]},[100]));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('Persistent cycles retain baseline, detect candidates, check old wall evidence and compare manual controls',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'radar-cycle-'));let time=at,phase=0;
  const api=async(method,p)=>{
    if(method==='groups.getById')return {groups:(phase<2?[group(1),group(101)]:[group(1),group(100),group(101)]).filter(g=>p.group_ids.split(',').includes(String(g.id)))};
    if(method==='wall.get')return {count:1,items:[{owner_id:Number(p.owner_id),date:(at-86400000)/1000}]};
    throw Error('Unexpected method');
  };
  try {
    const c=new Collector({dir,api,clock:()=>time});await c.configure({startId:100,width:100,intervalSeconds:60});
    await c.cycle();phase++;time+=60000;await c.cycle();phase++;time+=60000;await c.cycle();
    assert.equal(c.snapshot().evidence.older,1);assert.equal(c.snapshot().evidence.confirmedCreationDates,0);
    await c.addControl({id:100,createdAt:new Date(at+90000).toISOString(),note:'Test fixture; not live VK'});
    assert.equal(c.snapshot().controls[0].result,'consistent');
    await c.addControl({id:100,createdAt:new Date(at-86400000).toISOString(),note:'Known older fixture'});
    assert.equal(c.snapshot().controls[0].result,'contradiction');
    const loaded=new Collector({dir,api});await loaded.load();assert.equal(loaded.state.cycles,3);
    assert.equal(loaded.state.records[101].appearance.kind,'baseline');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('Movement revisits recent gaps; the new window has no fabricated history',()=>{
  const c=new Collector({dir:'unused',api:()=>{},clock:()=>at+120000});
  c.state.config=configFor({startId:200,width:100,intervalSeconds:60});
  recordBatch(c.state,[100],[],at);
  assert.ok(c.idsForCycle().includes(100));assert.ok(c.idsForCycle().includes(299));
  assert.equal(c.state.records[200],undefined);
});
test('Old dates inside repost content are not evidence against the current group',async()=>{
  const c=new Collector({dir:'unused',clock:()=>at,api:async()=>({count:1,items:[{owner_id:-100,date:at/1000,copy_history:[{date:(at-86400000)/1000}]}]})});
  const rec={id:100,group:{}};await c.inspectWall(rec);assert.equal(rec.oldestObservedPost,at);
});
test('VK transport redacts credentials/errors and uses POST with bounded timeout',async()=>{
  const calls=[];const api=vkClient({getToken:()=> 'private-secret-token',delay:0,fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({error:{error_code:5,error_msg:'private-secret-token'}})};}});
  await assert.rejects(api('groups.getById',{group_ids:'100'}),e=>e.message.includes('5')&&!e.message.includes('private-secret-token'));
  assert.equal(calls[0].opts.method,'POST');assert.ok(!calls[0].url.includes('private-secret-token'));
});
test('Local API blocks cross-origin writes, accepts authorized configuration, and excludes credentials from export',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'radar-http-'));
  const {server}=await createApp({dir,apiOverride:async()=>({groups:[group(1)]})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const status=await (await fetch(url+'/api/status')).json();assert.equal(status.evidence.confirmedCreationDates,0);
    assert.equal((await fetch(url+'/api/config',{method:'POST',body:'{}'})).status,403);
    const headers={'Content-Type':'application/json','X-Radar-CSRF':status.csrf};
    assert.equal((await fetch(url+'/api/config',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(url+'/api/connect',{method:'POST',headers,body:JSON.stringify({token:'private-secret-token'})})).status,200);
    assert.equal((await fetch(url+'/api/config',{method:'POST',headers,body:JSON.stringify({startId:100,width:100,intervalSeconds:60})})).status,200);
    const exported=await (await fetch(url+'/api/export')).text();assert.ok(!exported.includes('private-secret-token'));
    const persisted=await readFile(path.join(dir,'collector.json'),'utf8');assert.ok(!persisted.includes('private-secret-token'));
    assert.equal((await fetch(url+'/api/vk',{method:'POST',headers,body:JSON.stringify({method:'wall.post',params:{}})})).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
