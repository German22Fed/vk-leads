import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSlice,rememberProgress,personalArchive,mergeHostedSnapshot} from '../dist/feed-performance.js';
import {isAdultGroup,isLeadFitGroup} from '../dist/vk-data.js';
const row=id=>({id,name:'Мебель на заказ',status:'new',collectorFeed:true,available:true,firstSeen:10});
test('Pagination reaches every result exactly once with bounded DOM work',()=>{
 const rows=Array.from({length:10001},(_,i)=>row(i+1)),ids=[];
 for(let n=1;n<=pageSlice(rows).pages;n++){const p=pageSlice(rows,n);assert.ok(p.rows.length<=36);ids.push(...p.rows.map(g=>g.id));}
 assert.deepEqual(ids,rows.map(g=>g.id));assert.equal(pageSlice(rows,9999).page,pageSlice(rows).pages);
 assert.deepEqual(pageSlice([],5),{page:1,pages:1,rows:[],total:0});
});
test('Refresh prunes expired untouched cards but preserves work and deduplication',()=>{
 const progress={},old=[row(1),{...row(2),saved:true},{...row(3),status:'sent',seen:true},{...row(4),seen:true}];
 const first=mergeHostedSnapshot(old,[row(5)],progress);
 assert.deepEqual(first.map(g=>g.id),[2,3,5]);assert.equal(first[0].available,false);
 const second=mergeHostedSnapshot(first,[row(3),row(4),row(5)],progress);
 assert.equal(second.find(g=>g.id===3).status,'sent');assert.equal(second.find(g=>g.id===4).seen,true);
 assert.equal(new Set(second.map(g=>g.id)).size,second.length);
});
test('Progress survives migration, reload, manual status changes and un-saving',()=>{
 const old=[{...row(42),saved:true,status:'sent',seen:true,statusUpdatedAt:99}];
 const progress=JSON.parse(JSON.stringify(rememberProgress({},old)));
 const archived=personalArchive(old);assert.equal(archived.length,1);
 let list=mergeHostedSnapshot(archived,[row(42)],progress);assert.equal(list[0].status,'sent');assert.equal(list[0].firstSeen,10);
 list[0].saved=false;list[0].seen=false;list[0].status='new';rememberProgress(progress,list);
 list=mergeHostedSnapshot([], [row(42)],JSON.parse(JSON.stringify(progress)));
 assert.equal(list[0].saved,false);assert.equal(list[0].seen,false);assert.equal(list[0].status,'new');
});
test('Automatic feed data does not grow the personal archive',()=>{
 const rows=Array.from({length:20000},(_,i)=>row(i+1));assert.equal(personalArchive(rows).length,0);assert.deepEqual(rememberProgress({},rows),{});
 const manual={...row(30000),collectorFeed:false};assert.deepEqual(personalArchive([manual]),[manual]);
});
test('Classification cache invalidates on changed content and availability',()=>{
 const g=row(42);assert.equal(isLeadFitGroup(g),true);assert.equal(isAdultGroup(g),false);
 g.description='Порно видео';assert.equal(isAdultGroup(g),true);assert.equal(isLeadFitGroup(g),false);
 g.description='Мебель на заказ';assert.equal(isAdultGroup(g),false);assert.equal(isLeadFitGroup(g),true);
 g.contentSafety={blocked:true};assert.equal(isAdultGroup(g),true);assert.equal(isLeadFitGroup(g),false);
 g.contentSafety.blocked=false;assert.equal(isLeadFitGroup(g),true);
 g.deactivated='deleted';assert.equal(isLeadFitGroup(g),false);
});

