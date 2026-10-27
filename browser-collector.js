import {Collector, initialState} from './collector-engine.js?v=11.17';
import {parseGroups,normalizeGroup} from './core.js';
import {groupRows,isClientFitGroup} from './vk-data.js?v=11.17';
import {findIdFrontier,collectRecentIds} from './id-discovery.js?v=11.17';
const $=id=>document.getElementById(id);
const when=n=>n?new Date(n).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'ещё не было';
export const AUTO_QUERIES=['цветы','пекарня','маникюр','ремонт','мебель','фитнес','кафе','услуги'];

export async function discoverOnce({api,queries=AUTO_QUERIES,count=50,offset=0,seen=new Set(),onProgress=()=>{}}={}) {
  const ids=new Set(), pages=[];
  for(const q of queries){
    onProgress(`Автопоиск: ${q}…`);
    const result=await api('groups.search',{q,count,offset,sort:0});
    if(!Array.isArray(result?.items)) throw Error('VK вернул неожиданный ответ автопоиска.');
    pages.push(result.items.filter(g=>Number.isSafeInteger(g.id)&&g.id>0));
  }
  // Interleave topics so the first topic cannot consume the entire wall-check budget.
  for(let i=0;i<count;i++)for(const page of pages)if(page[i])ids.add(page[i].id);
  if(!ids.size)return [];
  const selected=[...[...ids].filter(id=>!seen.has(id)),...[...ids].filter(id=>seen.has(id))].slice(0,30);
  const rows=groupRows(await api('groups.getById',{group_ids:selected.join(','),fields:'name,screen_name,members_count,city,activity,description,has_photo,cover,can_message,deactivated'}),selected,{allowIncomplete:true});
  const result=[];
  // Check walls for a bounded set so the cards can be ranked by posts and message access.
  for(const group of rows.filter(isClientFitGroup).slice(0,30)){
    let wall;
    try{wall=await api('wall.get',{owner_id:-group.id,count:5,filter:'all'});}catch{}
    result.push({...normalizeGroup(group,wall),source:'Автопоиск VK',verifiedAt:Date.now(),verification:'groups.getById'});
  }
  return result;
}

export function browserStorage(indexedDB, name) {
  let opened;
  const open=()=>opened??=new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('history');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{opened=null;reject(Error('Браузер не разрешил хранение истории наблюдений.'));};
  });
  const run=async(mode,action)=>{
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('history',mode), req=action(tx.objectStore('history'));
      tx.oncomplete=()=>resolve(req.result??null);
      tx.onerror=tx.onabort=()=>reject(Error('Не удалось сохранить историю на устройстве. Наблюдение остановлено.'));
    });
  };
  return {load:()=>run('readonly',s=>s.get('state')),save:state=>run('readwrite',s=>s.put(state,'state'))};
}

export async function initBrowserCollector({api,isConnected,onConnect,onUpdate,onShowCandidates,onReset,onAutoGroups,onFreshGroups,onFreshStart,onSearch,onRegisterAutoStart}) {
  $('collectorPanel').innerHTML=`<div class="sectionheading"><div><h2>Ручной поиск и наблюдение</h2><p>Подбор новых возможностей — прямо в ленте.</p></div><span id="monitorBadge">Остановлено</span></div>
  <p class="collectorHint">Свежие группы без ввода ID: находим примерную верхнюю границу номеров ВК и загружаем сообщества от неё назад. Дата создания этих групп неизвестна. Затем можно наблюдать появление следующих ID.</p>
  <div class="modalrow"><button id="freshStart" class="primary">Найти свежие группы без ID</button><button id="freshStop" class="secondary" disabled>Остановить поиск</button><button id="freshMore" class="secondary" disabled>Ещё 500 ID</button></div>
  <p id="freshStatus" role="status" aria-live="polite">Подключите VK и нажмите «Найти свежие группы без ID». За один ручной запуск проверяется не более 1 000 номеров.</p>
  <button id="freshReport" class="textbtn" disabled>Скачать отчёт поиска (без ключей)</button>
  <details><summary>Дополнительно: поиск по тематикам</summary>
  <p class="collectorHint">Тематический поиск запускается только по вашей кнопке, проверяет ограниченную выдачу VK и добавляет результаты в ленту. Это свежие результаты выдачи, а не подтверждённая дата создания: VK не публикует общий поток новых сообществ.</p>
  <div class="modalrow"><button id="autoStart" class="primary">Запустить тематический поиск</button><button id="autoStop" class="secondary" disabled>Остановить тематический поиск</button><span id="autoStatus" role="status">Остановлено</span></div>
  <button id="manualTopicSearch" class="secondary">Выбрать свои тематики</button>
  </details>
  <p class="collectorHint">Проверяем соседние ID примерно раз в минуту. В ленту попадают группы, которые появились после двух проверок без них. Это интервал появления в API, а не подтверждённая дата создания. Охват ограничен выбранным диапазоном.</p>
  <p id="monitorStatus" role="status" aria-live="polite">Загружаем историю…</p>
  <div class="collectorStats"><span>Проверено ID <b id="monitorChecked">0</b></span><span>Кандидатов сегодня <b id="monitorCandidates">0</b></span><span>Старые публикации <b id="monitorOlder">0</b></span><span>Циклов <b id="monitorCycles">0</b></span></div>
  <details id="monitorSetup"><summary>Ручной ориентир и настройки (необязательно)</summary>
  <label for="monitorSeed">Ссылка или ID сообщества, которое точно создано недавно</label><input class="field" id="monitorSeed" placeholder="https://vk.ru/club…" autocomplete="off">
  <p class="collectorHint">Обычно ориентир определяется автоматически. Здесь можно указать его вручную. Возраст группы по её ID не подтверждается; существующие группы первой проверки считаются исходной базой.</p>
  <div class="collectorGrid"><label>Диапазон<select class="statusselect" id="monitorWidth"><option value="100">100 ID</option><option value="500" selected>500 ID</option></select></label><label>Повторять через<select class="statusselect" id="monitorInterval"><option value="300">5 минут</option><option value="600" selected>10 минут</option><option value="900">15 минут</option></select></label></div>
  <button id="monitorSave" class="secondary">Проверить ориентир и сохранить</button></details>
  <div class="modalrow"><button id="monitorStart" class="primary">Запустить наблюдение</button><button id="monitorStop" class="secondary" disabled>Остановить</button><button id="monitorShow" class="secondary">Показать кандидатов</button></div>
  <p id="monitorAction" role="status" aria-live="polite"></p>
  <p class="collectorHint">Работает, пока Mini App открыт на экране. При сворачивании — пауза. История хранится на этом устройстве; после закрытия нужно подключить VK и запустить наблюдение снова. Запуск наблюдения всегда подтверждается отдельной кнопкой.</p>
  <details><summary>Журнал и новое наблюдение</summary><p id="monitorLast"></p><div class="modalrow"><button class="textbtn" id="monitorExport">Скачать журнал</button><button class="textbtn" id="monitorReset">Начать новую историю</button></div><p>Новая история удалит наблюдения сборщика на этом устройстве. Сохранённые карточки останутся.</p><button class="secondary" id="monitorResetConfirm" hidden>Подтверждаю сброс истории</button></details>`;
  const user=Number(new URLSearchParams(location.search).get('vk_user_id'))||'browser';
  const collector=new Collector({api,storage:browserStorage(window.indexedDB,'radar-monitor-'+user),maxRecords:10000});
  let wanted=false, acting=false, signature='',loaded=false, autoWanted=false, autoBusy=false, autoTimer=null, autoPage=0;
  const autoSeen=new Set();
  let freshBusy=false,freshAbort=null,nextFreshId=null,freshChecked=0,freshReport=null;
  function render(){
    const s=collector.snapshot(), paused=wanted&&document.hidden;
    $('monitorBadge').textContent=paused?'Пауза · приложение скрыто':(freshBusy||autoBusy||s.busy)?'Проверяем':(autoWanted||s.running)?'Наблюдаем':'Остановлено';
    $('monitorStatus').textContent=(s.progress||s.message)+(s.config?` Диапазон: ${s.config.startId}–${s.config.startId+s.config.width-1}.`:' Ориентир будет найден автоматически при запуске.');
    $('monitorChecked').textContent=s.checkedIds;$('monitorCandidates').textContent=s.evidence.candidatesToday;
    $('monitorOlder').textContent=s.evidence.older;$('monitorCycles').textContent=s.cycles;
    $('monitorLast').textContent=`Последняя проверка: ${when(s.runs[0]?.finishedAt)}. ${s.runs[0]?.error||''}`;
    $('monitorStart').disabled=!loaded||acting||s.busy||wanted||freshBusy;
    $('monitorStop').disabled=!wanted&&!s.busy;
    $('autoStart').disabled=autoBusy||autoWanted||freshBusy;
    $('autoStop').disabled=!autoWanted&&!autoBusy;
    $('freshStart').disabled=!loaded||freshBusy||acting||s.busy||s.running||wanted||autoBusy;
    $('freshStop').disabled=!freshBusy;
    $('freshReport').disabled=freshBusy||!freshReport;
    $('freshMore').disabled=freshBusy||acting||s.busy||s.running||wanted||autoBusy||!nextFreshId||nextFreshId<2||freshChecked>=1000;
    $('freshMore').textContent=freshChecked>=1000?'Лимит 1 000 ID достигнут':`Ещё ${Math.min(500,1000-freshChecked)} ID`;
    for(const id of ['monitorSave','monitorSeed','monitorWidth','monitorInterval','monitorReset'])$(id).disabled=!loaded||acting||s.running||s.busy||wanted||freshBusy;
    const next=JSON.stringify([s.cycles,s.checkedIds,s.runs[0]]);
    if(next!==signature&&!s.busy){signature=next;onUpdate({connected:false,groups:s.groups.map(g=>({...g,source:'Наблюдение Mini App'}))});}
  }
  async function action(fn){if(acting)return;acting=true;$('monitorAction').textContent='Выполняем…';render();try{await fn();}catch(e){$('monitorAction').textContent=e.message;}finally{acting=false;render();}}
  async function autoOnce(){
    if(autoBusy||!isConnected()||document.hidden)return;
    autoBusy=true;$('autoStatus').textContent='Ищем в выдаче VK…';render();
    try{const groups=await discoverOnce({api,offset:autoPage*50,seen:autoSeen,onProgress:s=>{$('autoStatus').textContent=s;}});if(!autoWanted)return;groups.forEach(g=>autoSeen.add(g.id));autoPage=(autoPage+1)%5;onAutoGroups(groups);$('autoStatus').textContent=`Автопоиск обновлён: ${groups.length} карточек проверено.`;}
    catch(e){$('autoStatus').textContent=e.message;autoWanted=false;clearInterval(autoTimer);autoTimer=null;}
    finally{autoBusy=false;render();}
  }
  function startAuto(){if(autoWanted)return;if(!isConnected()){onConnect();return;}autoWanted=true;autoOnce();autoTimer=setInterval(autoOnce,600000);render();}
  function stopAuto(){autoWanted=false;clearInterval(autoTimer);autoTimer=null;$('autoStatus').textContent='Автопоиск остановлен.';render();}
  async function findFresh(more=false){
    if(freshBusy||collector.busy||collector.running||wanted||autoBusy)return;
    if(!isConnected()){onConnect();$('freshStatus').textContent='Подключите VK, затем повторите поиск свежих групп.';return;}
    stopAuto();if(!more)onFreshStart?.();freshBusy=true;freshAbort=new AbortController();
      freshReport={version:'11.17',startedAt:Date.now(),kind:more?'next_page':'frontier',probes:[],loadedIds:[]};render();
    const signal=freshAbort.signal,progress=s=>{$('freshStatus').textContent=s;};
    try{
      if(!more){
        nextFreshId=null;freshChecked=0;
        const frontier=await findIdFrontier({api,signal,onProgress:progress,onProbe:p=>freshReport.probes.push(p)});
        freshReport.frontier=frontier;
        nextFreshId=frontier.id;
        await collector.configure({startId:frontier.id+1,width:Number($('monitorWidth').value),intervalSeconds:Number($('monitorInterval').value),advance:true});
        $('monitorSeed').value=String(frontier.id);
      }
      let shown=0;
      freshReport.pageTopId=nextFreshId;
      const result=await collectRecentIds({api,topId:nextFreshId,count:Math.min(500,1000-freshChecked),signal,onProgress:progress,onBatch:batch=>{shown+=batch.length;freshReport.loadedIds.push(...batch.map(g=>g.id));onFreshGroups?.(batch);}});
      freshReport.status='ok';freshReport.checked=result.checked;freshReport.wallErrors=result.wallErrors;freshReport.incompleteCount=result.incompleteCount;freshReport.deletedCount=result.deletedCount;
      nextFreshId=result.nextId;freshChecked+=result.checked;
      progress(`Загружено ${shown} реальных групп. Проверено ${freshChecked} ID. Служебных/удалённых пропущено: ${result.deletedCount}; без названия: ${result.incompleteCount}. Стен проверено: ${result.wallChecks}; недоступно: ${result.wallErrors}. Дата создания не установлена — это свежий снимок по ID. ${freshReport.frontier?.settled===false?'Граница продолжала изменяться — показан снимок на момент проверки. ':''}Для наблюдения следующих появлений запустите его отдельной кнопкой.`);
    }catch(e){freshReport.status=signal.aborted?'cancelled':'error';freshReport.error=e.message;progress(e.message+' Уже загруженные карточки сохранены.');}
    finally{freshReport.finishedAt=Date.now();freshBusy=false;freshAbort=null;render();}
  }
  $('freshStart').onclick=()=>findFresh();$('freshMore').onclick=()=>findFresh(true);
  $('freshStop').onclick=()=>{freshAbort?.abort();$('freshStatus').textContent='Останавливаем после текущего запроса…';};
  $('freshReport').onclick=()=>{if(!freshReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(freshReport,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='vk-leads-search-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('autoStart').onclick=startAuto;$('autoStop').onclick=stopAuto;
  $('manualTopicSearch').onclick=onSearch;
  // A login does not silently run thematic search or overwrite the fresh-ID feed.
  onRegisterAutoStart?.(()=>{});
  try{await collector.load();loaded=true;const c=collector.state.config;if(c){$('monitorSeed').value=String(c.startId-1);$('monitorWidth').value=c.width;$('monitorInterval').value=c.intervalSeconds;}}
  catch(e){$('monitorAction').textContent=e.message;}
  $('monitorSave').onclick=()=>action(async()=>{
    if(!isConnected()){onConnect();throw Error('Сначала подключите VK. Сервисный ключ сюда вводить не нужно.');}
    const parsed=parseGroups($('monitorSeed').value);
    if(parsed.invalid.length||parsed.ids.length!==1)throw Error('Укажите одну ссылку или ID сообщества.');
    const raw=await api('groups.getById',{group_ids:parsed.ids[0]});
    const rows=Array.isArray(raw)?raw:raw?.groups,seed=rows?.[0];
    if(rows?.length!==1||!Number.isSafeInteger(seed?.id)||seed.deactivated)throw Error('VK не вернул доступное сообщество-ориентир.');
    await collector.configure({startId:seed.id+1,width:Number($('monitorWidth').value),intervalSeconds:Number($('monitorInterval').value),advance:true});
    $('monitorAction').textContent='Диапазон сохранён. Возраст ориентира автоматически не подтверждён. Теперь запустите наблюдение.';
  });
  $('monitorStart').onclick=()=>action(async()=>{
    if(!isConnected()){onConnect();throw Error('Подключите VK и затем запустите наблюдение.');}
    if(!collector.state.config){
      freshAbort=new AbortController();freshBusy=true;render();
      try{
        const frontier=await findIdFrontier({api,signal:freshAbort.signal,onProgress:s=>{$('monitorAction').textContent=s;}});
        await collector.configure({startId:frontier.id+1,width:Number($('monitorWidth').value),intervalSeconds:Number($('monitorInterval').value),advance:true});
        $('monitorSeed').value=String(frontier.id);
      }finally{freshBusy=false;freshAbort=null;}
    }
    if(document.hidden)throw Error('Приложение скрыто. Запустите наблюдение после возвращения.');
    collector.start();wanted=true;$('monitorAction').textContent='Первая проверка создаёт исходную базу. Новые кандидаты появятся после последующих проверок.';
  });
  $('monitorStop').onclick=()=>{wanted=false;collector.stop();$('monitorAction').textContent='Наблюдение остановлено. История сохранена.';render();};
  $('monitorShow').onclick=onShowCandidates;
  $('monitorExport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(collector.state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='vk-leads-observations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('monitorReset').onclick=()=>{$('monitorResetConfirm').hidden=false;};
  $('monitorResetConfirm').onclick=()=>action(async()=>{
    if(collector.busy||wanted)throw Error('Сначала остановите наблюдение.');
    const clean=initialState();await collector.storage.save(clean);collector.state=clean;
    onReset();
    nextFreshId=null;freshChecked=0;collector.message='История сброшена. Ориентир определится автоматически.';$('monitorResetConfirm').hidden=true;$('monitorAction').textContent='Новая история готова.';
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){collector.stop();freshAbort?.abort();}render();});
  setInterval(()=>{
    if((wanted||autoWanted)&&!isConnected()){wanted=false;stopAuto();collector.stop();$('monitorAction').textContent='Подключение VK потеряно. Подключитесь и запустите наблюдение снова.';}
    if(wanted&&!collector.running&&!collector.busy){
      if(collector.state.runs[0]?.status==='error'){wanted=false;}
      else if(!document.hidden)collector.start();
    }
    render();
  },1000);
  render();
}
