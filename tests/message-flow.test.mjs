import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showPreparedMessage,prepareConversation} from '../dist/message-flow.js';
import {DEFAULT_TEMPLATE} from '../dist/core.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const controller=app.slice(app.indexOf('let messagePending=false;'),app.indexOf('function compose(g)'));
function harness(verifyGroup,showPreparedMessage){
 const elements={messageStatus:{isConnected:true},prepareMessage:{isConnected:true},openDialog:{isConnected:true}};
 const context=vm.createContext({live:[],statuses:{new:"",opened:""},$:id=>elements[id],verifyGroup,prepareConversation:args=>prepareConversation({...args,bridge:{supportsAsync:async()=>true,send:async()=>{const result=await showPreparedMessage();return {result:result.status==='confirmed'};}}}),copyDraftText:async()=>({status:'copied'}),reserveDialogWindow:()=>null,openDialogTarget:async()=>assert.fail('Unexpected fallback'),toast:()=>{},auth:{bridge:{},token:''},errorText:e=>e.message,persist:()=>{},render:()=>{}});
 vm.runInContext(controller,context);
 return {context,elements};
}
test('Repeated clicks share one pending verification and one native request',async()=>{
 let resolve,checks=0,requests=0;
 const wait=new Promise(r=>{resolve=r;});
 const {context,elements}=harness(async()=>{checks++;await wait;return {ok:true};},async()=>{requests++;return {status:'confirmed'};});
 const g={id:123,status:'new'};
 const first=context.prepareNativeMessage(g,'Text');
 await context.prepareNativeMessage(g,'Text');
 assert.equal(checks,1);assert.equal(elements.prepareMessage.disabled,true);
 resolve();await first;
 assert.equal(requests,1);assert.equal(g.status,'opened');assert.equal(elements.prepareMessage.disabled,false);
});
test('Closed or unverified community never reaches the native message request',async()=>{
 const {context,elements}=harness(async()=>({ok:false,reason:'Сообщения закрыты'}),async()=>assert.fail('Must not open'));
 await context.prepareNativeMessage({id:123,status:'new'},'Text');
 assert.equal(elements.messageStatus.textContent,'Сообщения закрыты');
 assert.equal(elements.prepareMessage.disabled,false);
});

test('Native message box receives the complete KG Design letter and the community as recipient', async () => {
  let payload;
  const bridge = {supportsAsync:async method => method === 'VKWebAppShowMessageBox', send:async (method, data) => {
    assert.equal(method, 'VKWebAppShowMessageBox'); payload=data; return {result:true};
  }};
  assert.deepEqual(await showPreparedMessage(bridge,123,DEFAULT_TEMPLATE), {status:'confirmed'});
  assert.equal(payload.peer_id,-123);
  assert.equal(payload.message,DEFAULT_TEMPLATE);
  assert.match(payload.message,/KG Design/);
  assert.deepEqual(payload.message.match(/https:\/\/vk\.ru\/\S+/g),[
    'https://vk.ru/club240234680','https://vk.ru/club239999236',
    'https://vk.ru/remonthomee','https://vk.ru/club239566795'
  ]);
});
test('Unsupported client does not attempt an API send or a native message', async () => {
  const bridge={supportsAsync:async()=>false,send:async()=>assert.fail('Must not send')};
  assert.deepEqual(await showPreparedMessage(bridge,123,'Текст'),{status:'unsupported'});
  assert.deepEqual(await showPreparedMessage(null,123,'Текст'),{status:'unsupported'});
});
test('Cancellation and unknown result never claim confirmed delivery', async () => {
  for(const result of [{result:false},{}]) {
    const bridge={supportsAsync:async()=>true,send:async()=>result};
    assert.deepEqual(await showPreparedMessage(bridge,123,'Текст'),{status:'cancelled'});
  }
});
test('Native errors are not retried or replaced with another send', async () => {
  let calls=0;
  const error=Error('User cancelled');
  const bridge={supportsAsync:async()=>true,send:async()=>{calls++;throw error;}};
  await assert.rejects(showPreparedMessage(bridge,123,'Текст'),error);
  assert.equal(calls,1);
});
test('Empty messages and invalid community IDs fail before contacting VK', async () => {
  const bridge={supportsAsync:async()=>assert.fail('Must not call VK')};
  await assert.rejects(showPreparedMessage(bridge,-123,'Текст'));
  await assert.rejects(showPreparedMessage(bridge,123,'  '));
});

test('Unsupported host automatically opens one dialog after verification and copy',async()=>{
 const events=[];
 const result=await prepareConversation({bridge:null,groupId:123,text:DEFAULT_TEMPLATE,
  verify:async()=>{events.push('verified');return {ok:true};},copy:Promise.resolve({status:'copied'}),
  openDialog:async()=>{events.push('opened');return true;}});
 assert.deepEqual(events,['verified','opened']);assert.deepEqual(result,{status:'dialog',copied:true});
});
test('Copy failure still allows opening; blocked popup does not claim a dialog opened',async()=>{
 const result=await prepareConversation({bridge:null,groupId:123,text:DEFAULT_TEMPLATE,verify:async()=>({ok:true}),copy:Promise.resolve({status:'manual'}),openDialog:async()=>false});
 assert.deepEqual(result,{status:'link-required',copied:false});
});
test('Cancellation or native error never opens a second dialog',async()=>{
 for(const failure of [false,true]){
  const action=prepareConversation({bridge:{supportsAsync:async()=>true,send:async()=>{if(failure)throw Error('Native rejected');return {result:false};}},groupId:123,text:DEFAULT_TEMPLATE,verify:async()=>({ok:true}),openDialog:async()=>assert.fail('Duplicate action')});
  if(failure)await assert.rejects(action,/Native rejected/);else assert.equal((await action).status,'cancelled');
 }
});
test('Rejected verification cannot invoke either native or link route',async()=>{
 const result=await prepareConversation({bridge:{supportsAsync:async()=>assert.fail('Unverified recipient')},groupId:123,text:DEFAULT_TEMPLATE,verify:async()=>({ok:false,reason:'Closed'}),openDialog:async()=>assert.fail('Unverified recipient')});
 assert.deepEqual(result,{status:'blocked',reason:'Closed'});
});
