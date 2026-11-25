import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedPhotoDate,olderEvidence,startingBusiness,intervalInside} from '../dist/freshness.js';
import {isLeadFitGroup} from '../dist/vk-data.js';
import {normalizeGroup,filterGroups} from '../dist/core.js';
import {Collector,verdict} from '../dist/collector-engine.js';
import {probeAhead} from '../server/continuous.mjs';
const now=Date.UTC(2026,10,25,12),hour=3600000;
test('Community-owned photo is historical evidence; user-owned/repost dates are not',()=>{
 const photo={owner_id:-100,date:(now-7*86400000)/1000};
 const g=normalizeGroup({id:100,name:'Маникюр',crop_photo:{photo}});
 assert.equal(ownedPhotoDate({...photo,owner_id:1},100,now),null);
 assert.equal(ownedPhotoDate({...photo,date:(now+hour)/1000},100,now),null);
 assert.equal(olderEvidence(g,{from:now-hour},null,now),true);
 assert.equal(verdict({group:g,appearance:{kind:'frontier_candidate',from:now-hour,to:now}},now),'older');
 assert.equal(olderEvidence({},{from:now-hour},null,now),false);
});
test('Incomplete tail of a wall cannot pass freshness verification',async()=>{
 const c=new Collector({clock:()=>now,storage:{},api:async(m,p)=>p.offset?{count:20,items:[]}:{count:20,items:[{owner_id:-100,date:now/1000}]}});
 const rec={id:100,group:{}};await c.inspectWall(rec);assert.ok(rec.wallError);assert.equal(rec.wallCheckedAt,undefined);
});
test('Old original photo attachments disqualify even a recently cleaned wall',async()=>{
 const c=new Collector({clock:()=>now,storage:{},api:async()=>({count:1,items:[{owner_id:-100,date:now/1000,attachments:[{type:'photo',photo:{owner_id:-100,date:(now-86400000)/1000}}]}]})});
 const rec={id:100,group:{},appearance:{kind:'frontier_candidate',from:now-hour,to:now}};
 await c.inspectWall(rec);assert.equal(verdict(rec,now),'older');assert.equal(rec.group.freshnessCheckedVersion,1);
});
test('Recent periods contain the entire observation interval, never just discovery time',()=>{
 assert.equal(intervalInside({from:now-2*hour,to:now-1000},{from:now-hour,to:now}),false);
 assert.equal(intervalInside({from:now-hour,to:now},{from:now-hour,to:now}),true);
 assert.equal(intervalInside({from:now-3*hour,to:now-hour},{from:now-3*hour,to:now-hour}),true);
});
test('Starting-business filter excludes established profiles without claiming their age',()=>{
 assert.equal(startingBusiness({members:150,posts:10}),true);
 for(const g of [{members:151,posts:0},{members:1,posts:11},{members:1,posts:null}])assert.equal(startingBusiness(g),false);
 const g={id:100,name:'Ресницы',members:10,posts:30,status:'new'};
 assert.equal(filterGroups([g],{view:'discover',startingOnly:true},now).length,0);
 assert.equal(filterGroups([g],{view:'saved',startingOnly:true,saved:true},now).length,0);
 assert.equal(filterGroups([{...g,saved:true}],{view:'saved',startingOnly:true},now).length,1);
});
test('Forward probes inspect higher IDs but do not publish first-seen older groups as new',async()=>{
 const state={config:{startId:100},frontierWatch:{highest:99,floorId:99},records:{}};
 const api=async(m,p)=>({groups:p.group_ids.split(',').map(Number).map(id=>({id,name:id===1?'Control':id===96099?'Магазин':'delete'}))});
 const result=await probeAhead(state,api,now);
 assert.equal(result.checked,297);assert.equal(result.advanced,true);assert.equal(state.config.startId,96100);assert.equal(state.frontierWatch.floorId,96099);assert.deepEqual(state.records,{});
});
test('Business niches and commercial descriptions broaden leads without accepting random names',()=>{
 for(const name of ['Магазин игрушек Улыбка','Частный детский сад Солнце','Реснички Анны','Ресенницы | Тула','Маникюр','Книжный магазин Лист','Нейропсихолог Анна','Груминг кошки и собаки','Свечи на заказ','Шугаринг Елена','Капкейки на заказ','Lash room','Ремонт часов','Пошив одежды'])assert.equal(isLeadFitGroup({id:100,name}),true,name);
 assert.equal(isLeadFitGroup({id:100,name:'Анна Иванова',description:'Маникюр и педикюр. Запись на услуги, прайс в сообщениях.'}),true);
 for(const name of ['Мама','Ozon','Порно маникюр','AI Creator','Книжный дневник','asdfghjk'])assert.equal(isLeadFitGroup({id:100,name}),false,name);
 assert.equal(isLeadFitGroup({id:100,name:'Мама',description:'Маникюр на заказ'}),false);
 assert.equal(isLeadFitGroup({id:100,name:'Анна Иванова',description:'Люблю смотреть фото маникюра'}),false);
 assert.equal(isLeadFitGroup({id:100,name:'Дроздова дома',description:'Показываю свои будни, истории про ремонт'}),false);
 for(const name of ['вареник','Сладкая шоколадка','Сладкая зефирка'])assert.equal(isLeadFitGroup({id:100,name}),false,name);
});

