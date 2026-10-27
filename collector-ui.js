import {initBrowserCollector} from './browser-collector.js?v=11.14';
import {findIdFrontier,collectRecentIds} from './id-discovery.js?v=11.14';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = n => n ? new Date(n).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК' : '—';
let csrf = '', update = () => {};
const local = location.hostname === '127.0.0.1' && location.protocol === 'http:';
export async function collectorRequest(route, input) {
  if (!local) throw Error('Локальный сборщик доступен только на компьютере по адресу http://127.0.0.1:4173. Для поиска здесь подключитесь через VK.');
  const res = await fetch('/api/'+route, {signal:AbortSignal.timeout(40000), ...(input === undefined ? {cache:'no-store'} : {
    method:'POST',headers:{'Content-Type':'application/json','X-Radar-CSRF':csrf},body:JSON.stringify(input)
  })});
  if (!res.headers.get('content-type')?.includes('application/json')) throw Error('Сервер сборщика не отвечает: получена веб-страница вместо ответа API.');
  const data = await res.json();
  if (!res.ok) throw Error(data.error || 'Локальный сервер недоступен.');
  return data;
}
export function initCollector(onUpdate, seedIds, browserOptions) {
  if (!local) {
    void initBrowserCollector({...browserOptions,onUpdate}).catch(e=>{const message=document.createElement('p');message.setAttribute('role','alert');message.textContent='Не удалось запустить панель наблюдения: '+e.message;$('collectorPanel').append(message);});
    return;
  }
  $('collectorPanel').innerHTML = `
    <div class="sectionheading"><div><h2>Сборщик новых ID <span>Эксперимент</span></h2><p>Реальные запросы ВК и история проверок на вашем компьютере.</p></div><span id="collectorBadge">Проверяю сервер…</span></div>
    <p id="collectorStatus" role="status">Подключение к локальному сборщику…</p>
    <div class="collectorStats"><span>Проверено ID <b id="collectorChecked">0</b></span><span>Кандидатов за сегодня <b id="collectorCandidates">0</b></span><span>Найдены старые посты <b id="collectorOlder">0</b></span><span>Завершено циклов <b id="collectorCycles">0</b></span></div>
    <details id="collectorSetup" open><summary>Подключение и диапазон поиска</summary>
      <label for="collectorKey">Сервисный ключ приложения VK API</label><input type="password" class="field" id="collectorKey" autocomplete="off" placeholder="Сервисный ключ приложения">
      <p class="collectorHint">Берите его в кабинете Mini App: «Разработка → Ключи доступа → Сервисный ключ». Не используйте «Защищённый ключ» и ключ из настроек сообщества «Работа с API». Ключ передаётся только локальному серверу, хранится в памяти до остановки сервера и не записывается в базу или экспорт.</p>
      <div class="modalrow"><button class="primary" id="collectorConnect" disabled>Проверить и подключить</button><button class="secondary" id="collectorDisconnect">Отключить ключ</button></div><p id="collectorAction" role="status" aria-live="polite"></p>
      <div class="collectorGrid"><label>Начальный ID<input type="number" class="field" id="collectorStart" min="1" placeholder="ID недавно созданного сообщества"></label><label>Размер диапазона<select class="statusselect" id="collectorWidth"><option value="100">100 ID</option><option value="500" selected>500 ID</option><option value="1000">1 000 ID</option><option value="2000">2 000 ID</option></select></label><label>Повторять через<select class="statusselect" id="collectorInterval"><option value="60">1 минуту</option><option value="120" selected>2 минуты</option><option value="300">5 минут</option></select></label></div>
      <label><input type="checkbox" id="collectorAdvance" checked> Сдвигать диапазон вперёд по мере появления ID</label>
      <p class="collectorHint">Нужен начальный ID рядом с новыми сообществами. Поиск по тематикам не определяет последний ID во всём ВК. Пропущенные номера позади диапазона перепроверяются в течение 24 часов, не более 500 за цикл.</p>
      <div class="modalrow"><button class="primary" id="collectorAutoSeed">Найти свежие группы без ID</button><button class="secondary" id="collectorAutoStop" disabled>Остановить поиск</button><button class="secondary" id="collectorSeed">Взять максимальный ID из базы</button><button class="secondary" id="collectorSave">Сохранить диапазон</button></div><p id="collectorAutoStatus" role="status"></p>
    </details>
    <div class="modalrow"><button class="primary" id="collectorRun">Запустить сборщик</button><button class="secondary" id="collectorOnce">Проверить один раз</button><button class="secondary" id="collectorStop">Остановить</button><button class="textbtn" id="collectorExport">Скачать журнал JSON ↓</button></div>
    <p class="collectorHint">Работает при закрытой вкладке, пока запущен локальный сервер и компьютер не спит. После перезапуска сервера подключите ключ снова.</p>
    <details><summary>Как проверяем, действительно ли сообщество новое</summary><p>Кандидат — ID, который не вернулся минимум в двух успешных проверках, а затем появился. Недоступность не доказывает, что сообщества не существовало. Для «сегодня» весь интервал наблюдения должен попадать в московские сутки. Старый пост опровергает создание сегодня; отсутствие старых постов его не подтверждает.</p>
    <p>Для контрольного опыта: начните сбор и дождитесь двух проверок. Затем самостоятельно создайте тестовое сообщество в ВК. Если его ID входит в проверявшийся диапазон, запишите здесь фактическое время создания. Это ручные контрольные данные, не официальный источник дат для остальных групп.</p>
    <div class="collectorGrid"><label>ID контрольной группы<input class="field" id="controlId" type="number" min="1"></label><label>Создана (МСК)<input class="field" id="controlAt" type="datetime-local"></label></div><label>Как подтверждено время<input class="field" id="controlNote" placeholder="Например, создал самостоятельно и записал время"></label><button class="secondary" id="controlSave">Сравнить с наблюдениями</button><div id="controlResults"></div></details>
    <details><summary>Последние проверки</summary><div id="collectorRuns">Проверок ещё нет.</div></details>`;
  let first = true, polling = false, available = false, acting = false, frontierAbort=null;
  update = async () => {
    if (polling) return;
    polling = true;
    try {
      const s = await collectorRequest('status'); csrf = s.csrf; available = true;
      $('collectorBadge').textContent = s.connected ? 'Ключ подключён · чтение ID и стен' : 'Нужен ключ VK API';
      $('collectorStatus').textContent = s.progress || s.message;
      $('collectorChecked').textContent = s.checkedIds;
      $('collectorCandidates').textContent = s.evidence.candidatesToday;
      $('collectorOlder').textContent = s.evidence.older;
      $('collectorCycles').textContent = s.cycles;
      for(const id of ['collectorRun','collectorOnce']) $(id).disabled = acting || !s.connected || !s.config || s.running || s.busy;
      $('collectorAutoSeed').disabled=acting||!s.connected||s.running||s.busy;
      $('collectorAutoStop').disabled=!frontierAbort;
      $('collectorStop').disabled = !s.running && !s.busy;
      $('collectorSave').disabled = acting || s.running || s.busy;
      $('collectorConnect').disabled = acting || s.running || s.busy;
      if(first && s.config) {
        $('collectorStart').value=s.config.startId; $('collectorWidth').value=s.config.width;
        $('collectorInterval').value=s.config.intervalSeconds; $('collectorAdvance').checked=s.config.advance;
      }
      $('collectorStatus').textContent += s.config ? ` Диапазон: ${s.config.startId}–${s.config.startId+s.config.width-1}.` : '';
      $('collectorRuns').innerHTML = s.runs.slice(0,6).map(r=>`<p>${when(r.startedAt)} · ${r.checked} ID · ${esc({ok:'успешно',error:'ошибка',stopped:'остановлено'}[r.status]||r.status)}${r.error?' · '+esc(r.error):''}</p>`).join('') || 'Проверок ещё нет.';
      const labels={not_observed:'ID ещё не встречен',consistent:'Время совпало с интервалом наблюдения',contradiction:'Противоречие: время вне интервала',no_prior_observation:'Не было двух проверок до появления'};
      $('controlResults').innerHTML=s.controls.map(c=>`<p>club${c.id}: ${esc(labels[c.result])}. Указано пользователем: ${when(c.createdAt)}.</p>`).join('');
      first = false; onUpdate(s);
    } catch(e) {
      available = false;
      $('collectorBadge').textContent = 'Сервер не подключён';
      $('collectorStatus').textContent = 'Запустите start-radar.cmd из папки приложения. Для сборщика нужен локальный сервер; статическая публикация его не запускает.';
      $('collectorAction').textContent = e.message;
      $('collectorConnect').disabled = true;
      onUpdate({connected:false,groups:[]});
      for(const id of ['collectorRun','collectorOnce','collectorStop']) $(id).disabled=true;
    } finally { polling = false; }
  };
  async function action(fn) {
    if(acting)return;
    acting=true;$('collectorConnect').disabled=true;
    $('collectorAction').className='';
    $('collectorAction').textContent = 'Выполняю…';
    try { if(!available) throw Error('Сначала запустите локальный сервер.'); await fn(); $('collectorAction').textContent='Готово'; $('collectorAction').className='success'; }
    catch(e) { $('collectorAction').textContent = e.message; $('collectorAction').className='error'; }
    finally {acting=false;await update();}
  }
  $('collectorConnect').onclick=()=>action(async()=>{const value=$('collectorKey').value.trim();$('collectorKey').value='';await collectorRequest('connect',{token:value});});
  $('collectorDisconnect').onclick=()=>action(()=>collectorRequest('disconnect',{}));
  $('collectorSave').onclick=()=>action(()=>collectorRequest('config',{startId:$('collectorStart').value,width:$('collectorWidth').value,intervalSeconds:$('collectorInterval').value,advance:$('collectorAdvance').checked}));
  $('collectorSeed').onclick=()=>{const ids=seedIds();if(!ids.length){$('collectorAction').textContent='В базе ещё нет реальных ID. Введите ID известного сообщества или подключите ключ и выполните поиск по тематикам.';return;}$('collectorStart').value=Math.max(...ids)+1;$('collectorAction').textContent='Подставлен ID после максимального в вашей базе. Это не подтверждённая граница новых групп ВК.';};
  $('collectorAutoSeed').onclick=()=>action(async()=>{
    frontierAbort=new AbortController();$('collectorAutoStop').disabled=false;$('collectorAutoSeed').disabled=true;
    const progress=s=>{$('collectorAutoStatus').textContent=s;};
    const api=async(method,params)=>(await collectorRequest('vk',{method,params})).response;
    try{
      const f=await findIdFrontier({api,signal:frontierAbort.signal,onProgress:progress});
      const startId=f.id+1;
      await collectorRequest('config',{startId,width:Number($('collectorWidth').value),intervalSeconds:Number($('collectorInterval').value),advance:true});
      $('collectorStart').value=startId;
      const r=await collectRecentIds({api,topId:f.id,count:500,signal:frontierAbort.signal,onProgress:progress,onBatch:b=>browserOptions.onFreshGroups?.(b)});
      progress(`Загружено ${r.groups.length} групп рядом с найденной границей ID. Дата создания неизвестна. Диапазон наблюдения настроен автоматически.`);
    }catch(e){progress(e.message);throw e;}
    finally{frontierAbort=null;$('collectorAutoStop').disabled=true;}
  });
  $('collectorAutoStop').onclick=()=>frontierAbort?.abort();
  $('collectorRun').onclick=()=>action(()=>collectorRequest('start',{}));
  $('collectorOnce').onclick=()=>action(()=>collectorRequest('scan',{}));
  $('collectorStop').onclick=()=>action(()=>collectorRequest('stop',{}));
  $('controlSave').onclick=()=>action(()=>collectorRequest('control',{id:$('controlId').value,createdAt:$('controlAt').value?$('controlAt').value+':00+03:00':'',note:$('controlNote').value}));
  $('collectorExport').onclick=()=>action(async()=>{const data=await collectorRequest('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='vk-leads-observations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  void update(); setInterval(()=>{if(!document.hidden)void update();},4000);
}
