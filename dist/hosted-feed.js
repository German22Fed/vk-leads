import {isLeadFitGroup} from './vk-data.js?v=11.48.8';
import {hasCandidateInterval,filterGroups} from './core.js?v=11.48.8';
export function syncPeriodButtons(period,root=document){
  root.querySelectorAll('[data-cloud-period],[data-period]').forEach(b=>{
    const active=(b.dataset.cloudPeriod??b.dataset.period)===period;
    b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
  });
}
export function validateFeed(data,now=Date.now()){
  if(data?.version!==1||!Array.isArray(data.groups)||!['ok','waiting'].includes(data.status))throw Error('Некорректный ответ сборщика.');
  if(data.status==='waiting')return {...data,groups:[],stale:false};
  if(!Number.isFinite(data.updatedAt)||data.updatedAt>now+60000)throw Error('Некорректное время обновления.');
  const age=Math.max(0,now-data.updatedAt),stale=age>6*3600000,degraded=age>3600000;
  const maxAge=stale?3600000:degraded?6*3600000:3600000;
  const seen=new Set();
  return {...data,stale,degraded,groups:stale?[]:data.groups.filter(g=>{
    const a=g.observation?.appearance;
    if(seen.has(g.id)||g.collectorFeed!==true||!isLeadFitGroup(g)||g.available!==true||
       !hasCandidateInterval(g)||!Number.isFinite(a.from)||!Number.isFinite(a.to)||a.from>a.to||a.to>now||
       !Number.isFinite(g.verifiedAt)||now-g.verifiedAt>maxAge||g.verifiedAt>now||
       !Number.isFinite(g.observation?.wallCheckedAt)||now-g.observation.wallCheckedAt>maxAge||g.observation.wallCheckedAt>now||g.observation.wallError||
       (Number.isFinite(g.observation.oldestObservedPost)&&g.observation.oldestObservedPost<a.from)||
       !Number.isFinite(g.members)||g.members>500||g.wallUnavailable!==false)return false;
    seen.add(g.id);return true;
  })};
}
export function feedOutcome(data,count=data.groups.length){
  const code=data.collector?.errorCode;
  if(code==='missing_token')return {kind:'blocked',title:'Сборщик не подключён',message:'В GitHub отсутствует VK_SERVICE_TOKEN. Добавьте сервисный ключ и запустите сборщик. Вход в VK внутри приложения не подключает сервер.',setup:true};
  if(data.collector?.status==='error'&&data.groups.length)return {kind:'warning',title:'Проверка VK задержана',message:`Последний успешный снимок сохранён: ${data.groups.length} карточек доступны. Сборщик повторит проверку автоматически. Причина последнего запуска: ${code==='collection_failed'?'временная ошибка VK или сети':'ошибка запуска'}.`,setup:false};
  if(data.collector?.status==='error')return {kind:'error',title:'Ошибка серверного сбора',message:'Успешного снимка пока нет. Сборщик повторит запуск автоматически; проверьте журнал только если ошибка сохраняется несколько часов.',setup:true};
  if(data.status==='waiting')return {kind:'blocked',title:'Поиск ещё не активирован',message:'Сборщик ещё не опубликовал первую успешную проверку. Добавьте VK_SERVICE_TOKEN в GitHub Secrets и запустите Collect VK communities.',setup:true};
  if(data.stale)return {kind:'error',title:'Сборщик временно недоступен',message:'Последний снимок старше шести часов и больше не используется для выдачи. GitHub Actions продолжит автоматические попытки; откройте журнал, если задержка сохраняется.',setup:true};
  if(data.observation?.checked>0 && data.observation.tracked===0 && !data.observation.frontierProbes)return {kind:'blocked',title:'VK отвечает, но история новых ID не накоплена',message:`Проверено ID: ${data.observation.checked}. Доступных сообществ: ${data.observation.usable}. Ответов об удалённых или недоступных группах: ${data.observation.deleted}. Такие ответы не доказывают, что сообщество ещё не создано, и не попадают в ленту. Сборщик продолжит проверки по расписанию, но появление карточек пока не подтверждено.`,setup:false};
  const delayed=data.degraded;
  return {kind:delayed?'warning':'ready',title:delayed?'Обновление задержано':count?'Свежие кандидаты обновлены':'Подходящих кандидатов пока нет',message:`В выбранном периоде с текущими фильтрами: ${count}. Всего в общей ленте: ${data.groups.length}. Последняя успешная проверка: ${new Date(data.updatedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК.`+(delayed?' Показан последний рабочий снимок; GitHub Actions продолжит обновление автоматически.':'')+(data.observation?` Проверено ID: ${data.observation.checked}; доступны: ${data.observation.usable}; заглушки: ${data.observation.deleted}.`:'')+(count?' Дата регистрации не подтверждена.':' Карточки появятся после подходящего перехода ID и проверки стены. Изменение фильтра не создаёт новые данные.'),setup:false};
}
export function coverageText(data){
  const c=data.coverage;if(!c)return 'Полная статистика охвата появится после следующего запуска сборщика.';
  const n=c.counts;
  return `Охват последнего прохода: ${c.checkedThisPass} ID (${c.scanStart}–${c.scanEnd}). Это часть VK, не все новые сообщества. `+
    (c.gapSeconds!==null?`Пауза между проходами: ${Math.round(c.gapSeconds/60)} мин. `:'')+
    `В сохранённой базе: ${c.tracked}. Готовы к показу: ${n.published}; ждут проверки: ${n.pendingVerification}; не подходят по названию: ${n.irrelevant}; не подходят по аудитории: ${n.audience}; старые посты: ${n.oldPosts}; недоступны/ошибка стены: ${n.unavailable+n.wallError+n.withdrawn}; без интервала: ${n.withoutInterval}; вне последних суток: ${n.olderInterval||0}. `+
    `Пересекают границы периода и не включены в точную подборку: последний час — ${c.periods['1h'].uncertainBoundary}, 1–3 часа — ${c.periods['1-3h'].uncertainBoundary}. `+
    (c.retentionDropped?`Удалено из истории из-за ограничения хранения: ${c.retentionDropped}. `:'')+
    'Количество карточек не равно числу созданных в VK групп. Интервал наблюдения не подтверждает регистрацию.';
}
export function createFeedLoader({fetchImpl=fetch,onData,onState,clock=Date.now,url=new URL('./community-feed.json',import.meta.url),timeoutMs=15000}){
  let pending=null,lastRaw=null;const known=new Set();let addedTotal=0;
  return ()=>{
    if(pending)return pending;
    onState({kind:'loading',title:'Проверяем ленту…',message:'Загружаем последнюю проверку сборщика и применяем выбранный период.'});
    pending=Promise.resolve().then(async()=>{
      try{
        const endpoint=new URL(url);endpoint.searchParams.set('refresh',String(clock()));
        const res=await fetchImpl(endpoint,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
        if(!res.ok)throw Error(res.status===404?'Лента ещё не опубликована. Проверьте запуск сборщика.':'Не удалось загрузить ленту. Повторите попытку.');
        let raw;try{raw=await res.json();}catch{throw Error('Сервер вернул некорректную ленту. Откройте журнал сборщика.');}
        const hadSnapshot=!!lastRaw;
        const older=lastRaw&&raw.updatedAt<lastRaw.updatedAt;
        const data=validateFeed(older?lastRaw:raw,clock());
        const changed=!!lastRaw&&data.updatedAt>lastRaw.updatedAt;
        const added=changed?data.groups.filter(g=>!known.has(g.id)).length:0;
        addedTotal+=added;data.groups.forEach(g=>known.add(g.id));
        if(!older)lastRaw=raw;
        data.refresh={checkedAt:clock(),added,addedTotal,firstLoad:!hadSnapshot,snapshotChanged:changed,olderSnapshotIgnored:!!older};
        const count=onData(data);
        const result=feedOutcome(data,count);if(result.kind==='ready'&&hadSnapshot){result.title=added?'Получены новые карточки':changed?'Сборщик обновил проверку':'Новых данных от сборщика пока нет';result.message=(changed?'Новый серверный снимок. Дополнительных карточек в общей ленте: '+added+'. ':'Снимок не изменился. Кнопка загружает опубликованную ленту; сервер проверяет VK по расписанию. ')+result.message;}onState(result);return result;
      }catch(e){const result={kind:'error',title:'Не удалось обновить подбор',message:e.name==='TimeoutError'||e.name==='AbortError'?'Сервер не ответил за 15 секунд. Нажмите «Обновить подходящие сообщества» ещё раз.':e instanceof TypeError?'Нет соединения с лентой. Проверьте интернет и повторите попытку.':e.message,setup:true};onState(result);return result;}
      finally{pending=null;}
    });
    return pending;
  };
}
export function startFeedRefresh(refresh,{doc=document,win=window,every=setInterval,cancel=clearInterval,clock=Date.now}={}){
  let last=-Infinity;
  const tick=()=>{if(doc.hidden||clock()-last<5000)return;last=clock();void refresh();};
  const timer=every(tick,60000);
  doc.addEventListener('visibilitychange',tick);win.addEventListener('focus',tick);win.addEventListener('online',tick);
  tick();
  return ()=>{cancel(timer);doc.removeEventListener('visibilitychange',tick);win.removeEventListener('focus',tick);win.removeEventListener('online',tick);};
}
export function initHostedFeed(onUpdate,_seed,options){
  const el=document.getElementById('collectorPanel');
  el.innerHTML=`<div class="sectionheading"><div><h2>Постоянный сборщик</h2><p>Работает на GitHub при закрытом приложении. Без ввода ID.</p></div><span id="cloudBadge">Подключение…</span></div>
    <div class="leadPeriodButtons"><button class="secondary" data-cloud-period="">Последние 24 часа</button><button class="secondary" data-cloud-period="1h">Появились за последний час</button><button class="secondary" data-cloud-period="1-3h">Появились за 1–3 часа</button><button class="secondary" data-cloud-period="today">Появились сегодня</button></div>
    <button class="primary" id="cloudRefresh">Обновить подходящие сообщества</button>
    <p id="cloudStatus" role="status" aria-live="polite"></p>
    <p id="cloudRefreshInfo" class="refreshInfo">Автообновление каждую минуту, пока приложение открыто.</p>
    <details><summary>Охват поиска и причины отсева</summary><p id="cloudCoverage"></p></details>
    <div id="cloudSetup" hidden><p>Подключение требуется один раз владельцу приложения. Посетителям ключ не нужен.</p><a class="link" href="https://github.com/German22Fed/vk-leads/settings/secrets/actions" target="_blank" rel="noopener noreferrer">Добавить VK_SERVICE_TOKEN ↗</a> · <a class="link" href="https://github.com/German22Fed/vk-leads/actions/workflows/vk-collector.yml" target="_blank" rel="noopener noreferrer">Запустить сборщик / журнал ошибок ↗</a></div>
    <small>Кандидаты у растущей верхней границы ID: раньше VK возвращал заглушку, теперь — доступное сообщество. Начальная база, повторы и обнаруженные старые посты исключаются. Период — интервал этого перехода, не дата регистрации. Ранее скрытые или восстановленные группы полностью исключить нельзя. Проверки по расписанию примерно раз в 15 минут; возможны задержки.</small>`;
  const status=document.getElementById('cloudStatus'),badge=document.getElementById('cloudBadge'),button=document.getElementById('cloudRefresh');
  const mainButton=document.getElementById('searchBtn'),summary=document.getElementById('searchFeedback');
  syncPeriodButtons(document.getElementById('period').value);
  const refresh=createFeedLoader({onData:data=>{
    document.getElementById('cloudRefreshInfo').textContent=`Лента проверена: ${new Date(data.refresh.checkedAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow'})} МСК. Новых карточек за эту сессию: ${data.refresh.addedTotal}. Автообновление — каждую минуту.`+(data.refresh.olderSnapshotIgnored?' Сервер вернул старый снимок; сохранена более свежая лента.':'');
    document.getElementById('cloudCoverage').textContent=coverageText(data);
    onUpdate({connected:false,groups:data.groups,hosted:true,updatedAt:data.updatedAt,degraded:data.degraded});
    // Period counts are rendered by the app with personal statuses and filters.
    return Number(document.getElementById('listCount').textContent)||0;
  },onState:s=>{
    const loading=s.kind==='loading';button.disabled=mainButton.disabled=loading;
    button.textContent=loading?'Проверяем ленту…':'Обновить подходящие сообщества';mainButton.textContent=loading?'Проверяем ленту…':'Обновить подходящие сообщества';
    badge.textContent=s.title;status.textContent=s.message;document.getElementById('cloudSetup').hidden=!s.setup;
    if(summary){summary.hidden=false;summary.textContent=s.title+'. '+s.message;summary.dataset.state=s.kind;}
  }});
  const search=()=>{document.getElementById('dateBasis').value='appeared';options.onShowCandidates?.(document.getElementById('period').value);return refresh();};
  options.onRegisterSearch?.(search);
  // Period buttons only choose a criterion; refresh happens from the explicit update button.
  el.querySelectorAll('[data-cloud-period]').forEach(b=>b.onclick=()=>options.onShowCandidates?.(b.dataset.cloudPeriod));
  button.onclick=()=>void search();
  return startFeedRefresh(refresh);
}
