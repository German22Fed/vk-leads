import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {browserBridge, startVkLaunch} from '../dist/vk-connection.js';

const startup = await readFile(new URL('../dist/vk-start.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

test('The deployed entry initializes VK before any click, independently of the main application, and reuses Init for auth', async () => {
  const calls = [], status = {dataset:{}};
  const bridge = {send:async method => {calls.push(method);return {result:true};}};
  const win = {parent:{}, vkBridge:bridge};
  const doc = {readyState:'complete', getElementById:() => status};
  // Execute the actual startup module body, even if app.js never loads.
  const context = vm.createContext({browserBridge:() => browserBridge(win,doc), startVkLaunch:get => startVkLaunch(get,win), document:doc});
  vm.runInContext(startup.replace(/^import .*;\r?\n/m,'').replaceAll('export const ', 'var '), context);
  await context.launchReady;
  await Promise.resolve();
  assert.deepEqual(calls, ['VKWebAppInit']);
  assert.equal(status.dataset.state,'ready');
  await context.getBridge();
  assert.deepEqual(calls, ['VKWebAppInit']);
  const launchSrc=html.split('</head>')[0].match(/src="(vk-start.js\?v=[\d.]+)"/)?.[1];
  assert.ok(launchSrc);
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes(`import {getBridge} from './${launchSrc}'`));
});

test('Opening the ordinary public website does not request VK initialization or authorization', async () => {
  const win={vkBridge:{send(){throw Error('Library presence must not trigger initialization');}}};win.parent=win;
  let called=false;
  const state=await startVkLaunch(()=>{called=true;},win);
  assert.equal(called,false);assert.equal(state.status,'standalone');
});

test('Native iOS launch initializes even without an iframe', async () => {
  const calls=[];
  const win={webkit:{messageHandlers:{VKWebAppInit:{}}},vkBridge:{send:async method=>{calls.push(method);return {result:true};}}};
  win.parent=win;
  assert.equal((await startVkLaunch(browserBridge(win,{}),win)).status,'ready');
  assert.deepEqual(calls,['VKWebAppInit']);
});

test('Embedded VK Bridge marks a standalone-looking WebView as VK-hosted', async () => {
  const win = {
    parent: null,
    vkBridge: {
      isEmbedded: () => true,
      send: async () => ({result:true}),
    },
    location: {hostname:'german22fed.github.io', search:''},
    navigator: {userAgent:'Mozilla/5.0'},
  };
  win.parent = win;
  const {isVkHost} = await import('../dist/vk-connection.js');
  assert.equal(isVkHost(win), true);
  assert.equal((await startVkLaunch(browserBridge(win, {}), win)).status, 'ready');
});

test('VK launch markers in hash or referrer keep message actions in VK', async () => {
  const {isVkHost} = await import('../dist/vk-connection.js');
  const base = {parent:null, location:{hostname:'german22fed.github.io', search:'', hash:''}, navigator:{userAgent:'Mozilla/5.0'}};
  base.parent = base;
  assert.equal(isVkHost({...base, location:{...base.location, hash:'#vk_app_id=54829568&vk_platform=mobile_android'}}), true);
  assert.equal(isVkHost({...base, document:{referrer:'https://vk.ru/app54829568'}}), true);
});

test('Host initialization failure is visible, does not pretend to authorize, and can be retried', async () => {
  let fail=true;
  const win={parent:{},vkBridge:{send:async()=>{if(fail)throw Error('Host unavailable');return {result:true};}}};
  const get=browserBridge(win,{});
  const first=await startVkLaunch(get,win);
  assert.equal(first.status,'error');assert.match(first.detail,/Host unavailable/);
  fail=false;
  assert.equal((await startVkLaunch(get,win)).status,'ready');
});
