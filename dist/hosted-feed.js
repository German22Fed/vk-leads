import {isLeadFitGroup} from './vk-data.js?v=11.36';
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
export function initHostedFeed(onUpdate,_seed,options){
  const el=document.getElementById('collectorPanel');
  el.innerHTML=`<div class="sectionheading"><div><h2>Постоянный сборщик</h2><p>Работает на GitHub при закрытом приложении. Без ввода ID.</p></div><span id="cloudBadge">Подключение…</span></div>
    <div class="leadPeriodButtons"><button class="secondary" data-cloud-period="1h">Появились за последний час</button><button class="secondary" data-cloud-period="1-3h">Появились за 1–3 часа</button><button class="secondary" data-cloud-period="today">Появились сегодня</button></div>
    <button class="primary" id="cloudRefresh">Обновить подходящие сообщества</button>
    <p id="cloudStatus" role="status" aria-live="polite"></p>
    <small>Начальная база, повторы, удалённые группы и группы с обнаруженными старыми постами исключаются. Период означает появление ID в API, а не точную дату регистрации. Проверки по расписанию примерно раз в 15 минут; возможны задержки.</small>`;
  let busy=false;
  const status=document.getElementById('cloudStatus'),badge=document.getElementById('cloudBadge'),button=document.getElementById('cloudRefresh');
  async function refresh(){
    if(busy)return;busy=true;button.disabled=true;
    try{
      const res=await fetch(new URL('./community-feed.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!res.ok)throw Error('Лента сборщика пока не опубликована.');
      const data=validateFeed(await res.json());
      onUpdate({connected:false,groups:data.groups,hosted:true});
      badge.textContent=data.status==='waiting'?'Ожидает ключ VK':data.stale?'Данные устарели':'Общая лента подключена';
      status.textContent=data.status==='waiting'?'Сбор ещё не активирован. Владелец должен добавить VK_SERVICE_TOKEN в GitHub Secrets и запустить workflow Collect VK communities.':
        `Последняя успешная проверка: ${new Date(data.updatedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК. Циклов: ${data.cycles}. Карточек в ленте: ${data.groups.length}. `+
        (data.stale?'Больше часа нет успешных обновлений; карточки временно скрыты. Проверьте GitHub Actions.':data.groups.length?'Лента обновляется автоматически.':'Подходящих кандидатов пока нет. После первого запуска нужна история минимум двух проверок отсутствия ID.');
    }catch(e){badge.textContent='Ошибка обновления';status.textContent=e.message;}
    finally{busy=false;button.disabled=false;}
  }
  el.querySelectorAll('[data-cloud-period]').forEach(b=>b.onclick=()=>{options.onShowCandidates?.(b.dataset.cloudPeriod);void refresh();});
  button.onclick=()=>{options.onShowCandidates?.(document.getElementById('period').value||'today');void refresh();};
  void refresh();
  setInterval(()=>{if(!document.hidden)void refresh();},60000);
}
