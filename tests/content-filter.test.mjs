import test from 'node:test';
import assert from 'node:assert/strict';
import {isLeadFitGroup,isAdultGroup,inspectContent} from '../dist/vk-data.js';
import {normalizeGroup,filterGroups} from '../dist/core.js';
import {Collector} from '../dist/collector-engine.js';
import {compactState,eligible} from '../server/continuous.mjs';

test('Adult text is blocked across names, descriptions and mixed alphabets',()=>{
 for(const text of ['Порно студия','Студия porn','Массаж эротический','Салон эскорт','Студия хентай','Магазин XXX','Салон п о р н о','Студия pоrn','Салон интим услуг','NSFW фото','Слив интимных фото','OnlyFans']){
   assert.equal(isAdultGroup({name:text}),true,text);
   assert.equal(isLeadFitGroup({id:1,name:'Салон красоты',description:text}),false,text);
 }
});
test('Ordinary businesses, healthcare and substring collisions survive',()=>{
 for(const name of ['Психолог сексолог Мария','Клиника сексуального здоровья','Студия Сливки','Магазин Секстант','Музыкальная школа Гармония','Груминг кошек и собак','Ателье Анна','Грузоперевозки Саратов','Beauty Nails','Перетяжка диванов','Студия аэродизайна','Бурение скважин']){
   assert.equal(isAdultGroup({name}),false,name);
   assert.equal(isLeadFitGroup({id:1,name}),true,name);
 }
});
test('Post and attachment text checked without persisting original text',()=>{
 const g={id:12,name:'Студия Анна'};
 const items=[{text:'Запись в салон',copy_history:[{text:'порно видео'}]},{attachments:[{type:'video',video:{title:'XXX'}}]}];
 const content=inspectContent(g,items);
 assert.equal(content.blocked,true);assert.equal(content.reason,'adult_posts');
 assert.equal(JSON.stringify(content).includes('порно'),false);
 assert.equal(isLeadFitGroup({...g,contentSafety:content}),false);
 assert.equal(normalizeGroup(g,{count:1,items}).contentSafety.blocked,true);
 assert.equal(filterGroups([{...g,contentSafety:content}],{}).length,0);
});
test('Collector checks wall content before publishing a candidate',async()=>{
 const now=Date.UTC(2026,10,20,12),rec={id:12,available:true,appearance:{kind:'candidate',from:now-60000,to:now},group:{id:12,name:'Массаж Анна',members:3,verifiedAt:now}};
 const engine=new Collector({clock:()=>now,storage:{},api:async()=>({count:1,items:[{owner_id:-12,date:now/1000,text:'Эротический массаж'}]})});
 await engine.inspectWall(rec);
 assert.equal(rec.group.contentSafety.blocked,true);assert.equal(eligible(rec,now),false);
});
test('Retention keeps qualified leads ahead of a larger generic backlog',()=>{
 const now=Date.UTC(2026,10,20,12),state={config:{startId:999999},records:{}};
 for(let id=1;id<=21000;id++)state.records[id]={id,everReturned:true,appearance:{kind:'candidate',from:now-1000,to:now-id},group:{id,name:id===21000?'Мебель на заказ':'Новая группа'}};
 compactState(state,now);assert.equal(Object.keys(state.records).length,20000);assert.ok(state.records[21000]);
});

