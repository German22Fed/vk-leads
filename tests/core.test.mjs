import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGroups,mergeGroups,filterGroups,normalizeGroup,dialogUrl,messageFor,score,timeWindow,creationTimestamp,searchPlan} from '../dist/core.js';
test('Import accepts VK communities and rejects other sites and app URLs',()=>{assert.deepEqual(parseGroups('https://vk.ru/club12 public12 cafe_name https://evil.test/club1 https://vk.ru/app7929954'),{ids:['12','cafe_name'],invalid:['https://evil.test/club1','app7929954']});});
test('Repeated scan preserves first discovery, read status and sales pipeline',()=>{const old=[{id:1,name:'Old',firstSeen:10,seen:true,saved:true,status:'sent'}];const merged=mergeGroups(old,[{id:1,name:'Renamed'},{id:2,name:'New'}],100);assert.equal(merged.length,2);assert.deepEqual(merged[0],{...old[0],name:'Renamed',checkedAt:100});assert.equal(merged[1].firstSeen,100);assert.equal(merged[1].seen,false);});
test('Exact filter excludes unknown fields and more than three posts',()=>{const seed={status:'new',firstSeen:Date.now(),posts:3,avatar:true,cover:true};const out=filterGroups([{...seed,id:1},{...seed,id:2,posts:4},{...seed,id:3,cover:null}],{exact:true});assert.deepEqual(out.map(g=>g.id),[1]);});
test('New-only excludes read records and hidden leads',()=>assert.deepEqual(filterGroups([{id:1,seen:false,status:'new'},{id:2,seen:true,status:'new'},{id:3,seen:false,status:'hidden'}],{onlyNew:true}).map(x=>x.id),[1]));
test('Unavailable wall is unknown rather than zero',()=>{const g=normalizeGroup({id:1,name:'Group'},undefined);assert.equal(g.posts,null);assert.equal(g.cover,null);assert.equal(g.canMessage,null);assert.equal(g.wallUnavailable,true);});
test('Message is encoded without injecting URL parameters',()=>{const g={id:123,name:'Flowers & Co'};const msg=messageFor(g,'Hi {name}');const u=new URL(dialogUrl(g,msg));assert.equal(u.searchParams.get('sel'),'-123');assert.equal(u.searchParams.get('msg'),msg);assert.throws(()=>dialogUrl({id:-1},msg));});
test('Design need ranks missing assets above completed styling; unknowns earn no points',()=>{assert.equal(score({posts:2,avatar:false,cover:false,members:20,canMessage:true}).value,100);assert.equal(score({posts:2,avatar:true,cover:true,members:20,canMessage:true}).value,40);assert.equal(score({posts:null,members:null,canMessage:null}).value,0);});

test('Handled leads never return to discovery after a server refresh but remain in pipeline',()=>{
 const rows=['new','opened','sent','replied','client','hidden'].map((status,id)=>({id,status,seen:false}));
 const updated=mergeGroups(rows,rows.map(g=>({id:g.id,name:'Updated',status:'new'})));
 assert.deepEqual(filterGroups(updated,{view:'discover'}).map(g=>g.id),[0]);
 assert.deepEqual(filterGroups(updated,{view:'pipeline'}).map(g=>g.id),[1,2,3,4,5]);
});
test('Design filter hides both existing assets without treating unknown as good design',()=>{
 const rows=[{id:1,avatar:true,cover:true},{id:2,avatar:true,cover:false},{id:3,avatar:null,cover:null}];
 assert.deepEqual(filterGroups(rows,{view:'discover',needsDesign:true}).map(g=>g.id).sort(),[2,3]);
 assert.equal(filterGroups(rows,{view:'discover',needsDesign:false}).length,3);
});
test('Unbounded discovery is still limited to observed transitions within 24 hours',()=>{
 const now=10000000000;
 const rows=[1,25].map((hours,id)=>({id,available:true,status:'new',observation:{verdict:'candidate_today',appearance:{kind:'candidate',from:now-hours*3600000,to:now-hours*3600000+1000}}}));
 assert.deepEqual(filterGroups(rows,{view:'discover',dateBasis:'appeared',period:''},now).map(g=>g.id),[0]);
});
const clock=Date.parse('2026-10-21T01:30:00+03:00'),hour=3600000;
const created=(id,h,extra={})=>({id,firstSeen:clock,creation:{at:clock-h*hour,precision:'second',kind:'confirmed',source:'Test fixture'},...extra});
test('Creation filter uses exact 1–3 hour range, never first discovery',()=>{
 const list=[created(1,.2),created(2,1),created(3,2),created(4,3),created(5,3.01),{id:6,firstSeen:clock},created(7,-1)];
 assert.deepEqual(filterGroups(list,{dateBasis:'created',period:'1-3h'},clock).map(g=>g.id),[2,3,4]);
});
test('Today starts at Moscow midnight and differs from rolling 24 hours',()=>{
 assert.equal(timeWindow('today',clock).from,Date.parse('2026-10-21T00:00:00+03:00'));
 const rows=[created(1,1),created(2,2)];
 assert.deepEqual(filterGroups(rows,{dateBasis:'created',period:'today'},clock).map(g=>g.id),[1]);
 assert.equal(filterGroups(rows,{dateBasis:'created',period:'24h'},clock).length,2);
});
test('Last hour, five hours and custom fractions keep correct boundaries',()=>{
 const rows=[created(1,.25),created(2,1),created(3,2),created(4,5),created(5,5.1)];
 assert.deepEqual(filterGroups(rows,{dateBasis:'created',period:'1h'},clock).map(g=>g.id),[1,2]);
 assert.deepEqual(filterGroups(rows,{dateBasis:'created',period:'5h'},clock).map(g=>g.id),[1,2,3,4]);
 assert.deepEqual(filterGroups(rows,{dateBasis:'created',period:'custom',minHours:.2,maxHours:.5},clock).map(g=>g.id),[1]);
});
test('Invalid or empty custom bounds do not broaden results',()=>{
 for(const [min,max] of [[3,1],[-1,3],['',3],[1,''],[1,1],[0,Infinity],[0,87601]])assert.equal(timeWindow('custom',clock,min,max),null);
 assert.deepEqual(filterGroups([created(1,2)],{dateBasis:'created',period:'custom',minHours:3,maxHours:1},clock),[]);
});
test('Creation requires provenance and second precision; demo cannot enter live results',()=>{
 assert.equal(creationTimestamp({firstSeen:clock,latestPost:clock/1000,start_date:clock/1000}),null);
 const demo=created(1,1,{demo:true});demo.creation.kind='demo';
 assert.equal(creationTimestamp(demo),null);assert.equal(creationTimestamp(demo,true),clock-hour);
 assert.equal(creationTimestamp({creation:{at:clock,kind:'confirmed',precision:'day',source:'fixture'}}),null);
 assert.equal(creationTimestamp({creation:{at:clock,kind:'confirmed',precision:'second',source:''}}),null);
 assert.equal(normalizeGroup({id:1,name:'Group',start_date:clock/1000,est_date:'21.10.2026'},{}).creation,undefined);
});
test('Discovery mode remains independently available and excludes future timestamps',()=>{
 const rows=[{id:1,firstSeen:clock-hour/2},{id:2,firstSeen:clock-2*hour},{id:3,firstSeen:clock+1}];
 assert.deepEqual(filterGroups(rows,{dateBasis:'discovered',period:'1h'},clock).map(g=>g.id),[1]);
});
test('Freshest sorting uses the selected date rather than discovery order',()=>{
 const a=created(1,3,{firstSeen:clock}),b=created(2,1,{firstSeen:clock-5*hour});
 assert.deepEqual(filterGroups([a,b],{dateBasis:'created',period:'5h',sort:'new'},clock).map(g=>g.id),[2,1]);
});
test('Multiple topics receive bounded fair search pages without duplicate topics',()=>{
 const plan=searchPlan('цветы, ремонт; цветы\nкафе',1000);
 assert.equal(plan.reduce((sum,p)=>sum+p.count,0),1000);
 assert.deepEqual([...new Set(plan.map(p=>p.q))],['цветы','ремонт','кафе']);
 assert.ok(plan.every(p=>p.count<=100&&p.offset<1000));
 assert.equal(plan.filter(p=>p.q==='цветы').reduce((s,p)=>s+p.count,0),334);
 assert.equal(searchPlan('цветы',1000).length,10);
 assert.throws(()=>searchPlan('',100));assert.throws(()=>searchPlan('цветы',1001));
});
