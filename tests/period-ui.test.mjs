import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dialogUrl,DEFAULT_TEMPLATE,messageFor} from '../dist/core.js';
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');

test('A modal opened before auto-refresh updates the current live card and persists its status',()=>{
 const stale={id:42,status:'new'},current={id:42,status:'new',name:'Мебель'};let saves=0,renders=0;
 const ctx=vm.createContext({live:[current],statuses:{sent:'Написали'},persist:()=>saves++,render:()=>renders++,stale});
 vm.runInContext(source.slice(source.indexOf('function setStatus('),source.indexOf('function compose(g)')),ctx);
 vm.runInContext("setStatus(stale,'sent')",ctx);
 assert.equal(current.status,'sent');assert.equal(current.seen,true);assert.ok(current.statusUpdatedAt>0);
 assert.equal(stale.status,'sent');assert.equal(saves,1);assert.equal(renders,1);
});
test('Period buttons leave snapshot mode, preserve criteria, and never scroll',()=>{
 const elements=Object.fromEntries(['period','dateBasis','sort','filterQuery','onlyNew','mainContent','templateView'].map(id=>[id,{value:'',checked:true,hidden:false}]));
 elements.dateBasis.value='id';elements.filterQuery.value='мебель';let renders=0;
 const ctx=vm.createContext({$:id=>elements[id],document:{querySelectorAll:()=>[]},render:()=>renders++});
 vm.runInContext("let view='saved',freshFilter=true,snapshotMode=true;"+source.slice(source.indexOf('function selectPeriod('),source.indexOf('function reset(')),ctx);
 for(const period of ['1h','1-3h','today','1h']){
  vm.runInContext(`selectPeriod('${period}')`,ctx);
  assert.equal(elements.period.value,period);assert.equal(elements.dateBasis.value,'appeared');
  assert.equal(elements.filterQuery.value,'мебель');assert.equal(elements.onlyNew.checked,true);
  assert.equal(vm.runInContext('freshFilter||snapshotMode',ctx),false);
 }
 elements.dateBasis.value='created';vm.runInContext("selectPeriod('today')",ctx);assert.equal(elements.dateBasis.value,'created');assert.equal(renders,5);
});
test('Prepared and empty-chat actions are direct anchors and keep edited full text without API access',()=>{
 const elements={};let markup='',copies=0;
 const ctx=vm.createContext({$:id=>elements[id],esc:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;'),messageFor,dialogUrl,template:DEFAULT_TEMPLATE,setStatus:(g,status)=>{g.status=status;},statuses:{new:'Новое'},copyDraftText:async()=>{copies++;},messageNotice(){},persist(){},render(){},modal:(title,html)=>{markup=html;for(const id of ['copyDraft','draft','draftLink','prepareMessage','openDialog','copyStatus','leadStatus'])elements[id]={};}});
 vm.runInContext(source.slice(source.indexOf('function compose(g)'),source.indexOf('function details(g)')),ctx);
 ctx.g={id:42,name:'Психолог',status:'new'};vm.runInContext('compose(g)',ctx);
 assert.match(markup,/<a[^>]*id="openDialog"[^>]*href="https:\/\/vk.ru\/im\?sel=-42&amp;msg="/);
 assert.match(markup,/<a[^>]*id="prepareMessage"[^>]*href="https:\/\/vk.ru\/im\?sel=-42&amp;msg=/);
 assert.match(markup,/id="draftLink"[^>]*target="_top"/);
 const edited=DEFAULT_TEMPLATE+'\nДополнение & ? #';elements.draft.value=edited;elements.draft.oninput();
 for(const id of ['draftLink','prepareMessage'])assert.equal(new URL(elements[id].href).searchParams.get('msg'),edited);
 for(const id of ['openDialog','prepareMessage','draftLink'])assert.equal(elements[id].onclick(),undefined);
 assert.equal(copies,3); // no preventDefault, no authorization or verification dependency
});
test('Card navigation is synchronous before clipboard and handles blocked popups without claiming delivery',()=>{
 const order=[],notices=[];let allow=true;
 const ctx=vm.createContext({window:{open(url){order.push(new URL(url).searchParams.get('sel'));return allow?{}:null;}},dialogUrl,messageNotice:s=>notices.push(s),copyDraftText:async()=>order.push('copy')});
 vm.runInContext(source.slice(source.indexOf('function openConversationNow('),source.indexOf('function compose(g)')),ctx);
 assert.equal(vm.runInContext("openConversationNow({id:42},'Текст')",ctx),true);
 assert.deepEqual(order,['-42','copy']);allow=false;
 assert.equal(vm.runInContext("openConversationNow({id:42},'Текст')",ctx),false);
 assert.match(notices.at(-1),/не подтвердил/);
});
