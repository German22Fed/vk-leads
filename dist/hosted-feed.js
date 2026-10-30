import {isLeadFitGroup} from './vk-data.js?v=11.37';
export function validateFeed(data,now=Date.now()){
  if(data?.version!==1||!Array.isArray(data.groups)||!['ok','waiting'].includes(data.status))throw Error('Некорректный ответ сборщика.');
  if(data.status==='waiting')return {...data,groups:[],stale:false};
  if(!Number.isFinite(data.updatedAt)||data.updatedAt>now+60000)throw Error('Некорректное время обновления.');
  const stale=now-data.updatedAt>3600000;
  const seen=new Set();
  return {...data,stale,groups:stale?[]:data.groups.filter(g=>{
    const a=g.observation?.appearance;
    if(seen.has(g.id)||g.collectorFeed!==true||!isLeadFitGroup(g)||g.available!==true||
       a?.kind!=='candidate'||!Number.isFinite(a.from)||!Number.isFinite(a.to)||a.from>a.to||a.to>now||
       !['candidate_today','candidate_other_day'].includes(g.observation.verdict)||
       !Number.isFinite(g.verifiedAt)||now-g.verifiedAt>3600000||g.verifiedAt>now||
       !Number.isFinite(g.members)||g.members>500||g.wallUnavailable!==false)return false;
    seen.add(g.id);return true;
  })};
}
export function feedOutcome(data,count=data.groups.length){
  const code=data.collector?.errorCode;
  if(code==='missing_token')return {kind:'blocked',title:'Сборщик не подключён',message:'В GitHub отсутствует VK_SERVICE_TOKEN. Добавьте сервисный ключ и запустите сборщик. Вход в VK внутри приложения не подключает сервер.',setup:true};
  if(data.collector?.status==='error')return {kind:'error',title:'Ошибка серверного сбора',message:'Последняя проверка VK завершилась ошибкой. Проверьте ключ и доступ к groups.getById / wall.get в журнале сборщика. Новые данные не получены.',setup:true};
  if(data.status==='waiting')return {kind:'blocked',title:'Поиск ещё не активирован',message:'Сборщик ещё не опубликовал первую успешную проверку. Добавьте VK_SERVICE_TOKEN в GitHub Secrets и запустите Collect VK communities.',setup:true};
  if(data.stale)return {kind:'error',title:'Сборщик давно не обновлялся',message:'Больше часа нет успешных проверок. Устаревшие карточки скрыты. Откройте журнал сборщика.',setup:true};
  return {kind:'ready',title:count?'Подбор обновлён':'Подходящих сообществ пока нет',message:`В выбранном периоде с текущими фильтрами: ${count}. Всего в общей ленте: ${data.groups.length}. Последняя успешная проверка: ${new Date(data.updatedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК.`+(count?'':' Первые результаты появятся после накопления наблюдений. Изменение фильтра не создаёт новые данные.'),setup:false};
}
export function createFeedLoader({fetchImpl=fetch,onData,onState,clock=Date.now,url=new URL('./community-feed.json',import.meta.url),timeoutMs=15000}){
  let pending=null;
  return ()=>{
    if(pending)return pending;
    onState({kind:'loading',title:'Проверяем ленту…',message:'Загружаем последнюю проверку сборщика и применяем выбранный период.'});
    pending=Promise.resolve().then(async()=>{
      try{
        const endpoint=new URL(url);endpoint.searchParams.set('refresh',String(clock()));
        const res=await fetchImpl(endpoint,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
        if(!res.ok)throw Error(res.status===404?'Лента ещё не опубликована. Проверьте запуск сборщика.':'Не удалось загрузить ленту. Повторите попытку.');
        let raw;try{raw=await res.json();}catch{throw Error('Сервер вернул некорректную ленту. Откройте журнал сборщика.');}
        const data=validateFeed(raw,clock());
        const count=onData(data);
        const result=feedOutcome(data,count);onState(result);return result;
      }catch(e){const result={kind:'error',title:'Не удалось обновить подбор',message:e.name==='TimeoutError'||e.name==='AbortError'?'Сервер не ответил за 15 секунд. Нажмите «Найти сообщества» ещё раз.':e instanceof TypeError?'Нет соединения с лентой. Проверьте интернет и повторите попытку.':e.message,setup:true};onState(result);return result;}
      finally{pending=null;}
    });
    return pending;
  };
}
export function initHostedFeed(onUpdate,_seed,options){
  const el=document.getElementById('collectorPanel');
  el.innerHTML=`<div class="sectionheading"><div><h2>Постоянный сборщик</h2><p>Работает на GitHub при закрытом приложении. Без ввода ID.</p></div><span id="cloudBadge">Подключение…</span></div>
    <div class="leadPeriodButtons"><button class="secondary" data-cloud-period="1h">Появились за последний час</button><button class="secondary" data-cloud-period="1-3h">Появились за 1–3 часа</button><button class="secondary" data-cloud-period="today">Появились сегодня</button></div>
    <button class="primary" id="cloudRefresh">Обновить подходящие сообщества</button>
    <p id="cloudStatus" role="status" aria-live="polite"></p>
    <div id="cloudSetup" hidden><p>Подключение требуется один раз владельцу приложения. Посетителям ключ не нужен.</p><a class="link" href="https://github.com/German22Fed/vk-leads/settings/secrets/actions" target="_blank" rel="noopener noreferrer">Добавить VK_SERVICE_TOKEN ↗</a> · <a class="link" href="https://github.com/German22Fed/vk-leads/actions/workflows/vk-collector.yml" target="_blank" rel="noopener noreferrer">Запустить сборщик / журнал ошибок ↗</a></div>
    <small>Начальная база, повторы, удалённые группы и группы с обнаруженными старыми постами исключаются. Период означает появление ID в API, а не точную дату регистрации. Проверки по расписанию примерно раз в 15 минут; возможны задержки.</small>`;
  const status=document.getElementById('cloudStatus'),badge=document.getElementById('cloudBadge'),button=document.getElementById('cloudRefresh');
  const mainButton=document.getElementById('searchBtn'),summary=document.getElementById('searchFeedback');
  const refresh=createFeedLoader({onData:data=>{onUpdate({connected:false,groups:data.groups,hosted:true});return Number(document.getElementById('listCount').textContent)||0;},onState:s=>{
    const loading=s.kind==='loading';button.disabled=mainButton.disabled=loading;
    button.textContent=loading?'Проверяем ленту…':'Обновить подходящие сообщества';mainButton.textContent=loading?'Проверяем ленту…':'Найти сообщества';
    badge.textContent=s.title;status.textContent=s.message;document.getElementById('cloudSetup').hidden=!s.setup;
    if(summary){summary.hidden=false;summary.textContent=s.title+'. '+s.message;summary.dataset.state=s.kind;}
  }});
  const search=()=>{document.getElementById('dateBasis').value='appeared';options.onShowCandidates?.(document.getElementById('period').value||'today');return refresh();};
  options.onRegisterSearch?.(search);
  el.querySelectorAll('[data-cloud-period]').forEach(b=>b.onclick=()=>{options.onShowCandidates?.(b.dataset.cloudPeriod);void search();});
  button.onclick=()=>void search();
  void refresh();
  setInterval(()=>{if(!document.hidden)void refresh();},60000);
}
