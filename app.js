import {VkConnection,errorText} from './vk-connection.js?v=11.31';
import {showPreparedMessage} from './message-flow.js?v=11.31';
import {getBridge} from './vk-start.js?v=11.31';
import {initCollector,collectorRequest} from './collector-ui.js?v=11.31';
import {DEFAULT_TEMPLATE,parseGroups,score,mergeGroups,filterGroups,messageFor,dialogUrl,normalizeGroup,timeWindow,creationTimestamp,searchPlan} from './core.js?v=11.31';
import {groupRows,isUsableGroup,isClientFitGroup,isLeadFitGroup} from './vk-data.js?v=11.31';
const CONFIGURED_APP_ID=54829568;
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeImage=s=>{try{return new URL(s).protocol==='https:'?esc(s):'';}catch{return '';}};
const date=n=>new Date(n).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'})+' МСК';
let toastTimer,view='discover',mode='live',busy=false,runCancelled=false,autoTimer,autoFeedShown=false,freshFilter=false,snapshotMode=false,freshSessionIds=new Set(),freshObservationStartedAt=0,lastSearchAt=0,lastDialogOpenAt=0;
const auth = new VkConnection({getBridge,onChange:()=>renderConnection()});
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
function write(key,data){try{localStorage.setItem(key,JSON.stringify(data));return true;}catch{toast('Не удалось сохранить данные в браузере. Сделайте экспорт базы.');return false;}}
let settings=read('radar.settings',{}), template=read('radar.template',DEFAULT_TEMPLATE);
if(read('radar.template.version','')!=='grm-studio-v1'){template=DEFAULT_TEMPLATE;write('radar.template',template);write('radar.template.version','grm-studio-v1');}
const isVerifiedGroup=g=>isLeadFitGroup(g)&&Number.isFinite(g?.verifiedAt);
const isFreshLead=g=>isVerifiedGroup(g)&&Number.isFinite(g?.members)&&g.members<=10000;
let live=read('radar.live',[]);if(!Array.isArray(live))live=[];live=live.filter(g=>isVerifiedGroup(g));
const demo=[];
let serverConnected=false;
const groups=()=>mode==='demo'?demo:live;
const persist=()=>write('radar.'+mode,groups());
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000);}
function filters(){return {view,query:$('filterQuery').value.trim(),onlyNew:$('onlyNew').checked,exact:$('exact').checked,canMessage:$('canMessage').checked,period:$('period').value,dateBasis:$('dateBasis').value,minHours:$('minHours').value,maxHours:$('maxHours').value,allowDemo:mode==='demo',sort:$('sort').value};}
const statuses={new:'Не обработано',opened:'Диалог открыт',sent:'Предложение отправлено',replied:'Ответили',client:'Клиент',hidden:'Не подходит'};
function render(){
 const all=groups(), f=filters(), baseList=filterGroups(all,snapshotMode&&f.dateBasis==='discovered'?{...f,period:''}:f), list=freshFilter&&view==='discover'?baseList.filter(g=>freshSessionIds.has(g.id)):baseList;
 const created=f.dateBasis==='created',appeared=f.dateBasis==='appeared',byId=f.dateBasis==='id';
 $('recentTitle').textContent=byId?'Новые по снимку VK':created?'Подтверждённая дата создания':appeared||snapshotMode?'Новые сообщества':'Недавно обнаруженные';
 $('recentPill').textContent=byId?'Без точной даты':$('period').selectedOptions[0].textContent;
 $('customRange').hidden=byId||f.period!=='custom';
 $('period').disabled=byId;
 document.querySelectorAll('[data-period]').forEach(b=>{b.disabled=byId;});
 const invalid=!byId&&timeWindow(f.period,Date.now(),f.minHours,f.maxHours)===null;
 document.querySelector('.recentIntro').textContent=byId?'Свежий снимок VK без подтверждённой даты создания.':'Выберите, когда сообщество появилось в наблюдении. «Сегодня» — с 00:00 по Москве.';
 $('rangeError').hidden=!invalid;
 document.querySelectorAll('[data-period]').forEach(b=>{const active=b.dataset.period===f.period;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
 const unknown=all.filter(g=>creationTimestamp(g,mode==='demo')===null).length;
 $('creationNotice').textContent=snapshotMode&&f.dateBasis==='discovered'?'Свежий снимок VK загружен сейчас. После накопления наблюдений периоды будут показывать сообщества, появившиеся именно в выбранном интервале.':appeared?'Показываем сообщества, которые стали доступны VK в выбранном периоде наблюдения. Точную дату создания VK не передаёт; старые публикации исключают старые группы.':created?(mode==='demo'?'Демо: время создания вымышленное. Фильтры показывают, как будет работать подбор при наличии точных дат.':('Источник точного времени создания пока не подключён. Без подтверждённой даты: '+unknown+'.')):'Учитывается первое обнаружение в этой базе. Сообщество могло быть создано раньше.';
 if(byId)$('creationNotice').textContent='Показан свежий снимок VK. Точная дата создания неизвестна.';
 $('emptyTitle').textContent=appeared?'Подходящих новых сообществ пока нет':invalid?'Проверьте диапазон часов':created&&mode==='live'?'Нет подтверждённых дат в этом диапазоне':'В этом диапазоне сообществ не найдено';
 $('emptyText').textContent=freshFilter&&view==='discover'?'Нажмите кнопку периода, чтобы обновить подбор. Повторы скрываются.':snapshotMode?'Измените направление поиска или повторите проверку VK.':appeared?'Нажмите «Найти подходящие сообщества» и оставьте Mini App открытым для наблюдения VK.':created&&mode==='live'?'Точная дата создания не подтверждена VK.':'Измените период или направление поиска.';
 $('totalStat').textContent=all.length;$('newStat').textContent=all.filter(g=>!g.seen&&g.status!=='hidden').length;$('newChip').textContent=$('newStat').textContent;$('matchStat').textContent=all.filter(g=>g.posts>=2&&g.posts<=3&&g.avatar===true&&g.cover===true&&g.status!=='hidden').length;$('workStat').textContent=all.filter(g=>!['new','hidden'].includes(g.status)).length;$('savedCount').textContent=all.filter(g=>g.saved).length;$('listCount').textContent=list.length;
 $('demoBanner').hidden=mode!=='demo';renderConnection();
 $('cards').innerHTML=list.map(g=>{const s=score(g);const pic=safeImage(g.photo),cover=safeImage(g.coverUrl);return `<article class="card" data-id="${g.id}"><div class="cover" style="background:${g.demo?g.bg:'#e8edf5'};color:${g.demo?g.ink:'#7d8ea8'}">${cover?`<img src="${cover}" alt="Обложка сообщества" loading="lazy" referrerpolicy="no-referrer">`:`<div class="coverart"><div>${esc(g.art||'сообщество')}<span>${esc(g.artSub||'ВКонтакте')}</span></div></div>`}${created&&creationTimestamp(g,mode==='demo')!==null?'<span class="newbadge">◷ ДАТА СОЗДАНИЯ'+(g.demo?' · ДЕМО':'')+'</span>':!g.seen?'<span class="newbadge">● НОВОЕ ДЛЯ ВАС</span>':''}<button class="bookmark ${g.saved?'selected':''}" data-action="save" aria-label="${g.saved?'Убрать из сохранённых':'Сохранить'}">${g.saved?'★':'☆'}</button></div><div class="cardbody"><div class="identity"><div class="avatar" ${g.demo?`style="background:${g.bg};color:${g.ink}"`:''}>${pic?`<img src="${pic}" alt="" loading="lazy" referrerpolicy="no-referrer">`:esc(g.monogram||g.name[0])}</div><div><h3 title="${esc(g.name)}">${esc(g.name)}</h3><p>${esc(g.category)} · ${esc(g.city)}</p></div></div><div class="numbers"><span>♧ <b>${g.members??'—'}</b> подписчиков</span><span>▤ <b>${g.posts??'—'}</b> поста / постов</span></div><div class="tags"><span class="tag good">✓ Проверено VK · ${date(g.verifiedAt)}</span><span class="tag ${g.avatar?'good':''}">${g.avatar===null?'?':g.avatar?'✓':'−'} Аватарка</span><span class="tag ${g.cover?'good':''}">${g.cover===null?'?':g.cover?'✓':'−'} Обложка</span><span class="tag ${g.canMessage?'good':''}">${g.canMessage===null?'?':g.canMessage?'✓':'−'} Сообщения</span></div><div class="priority"><span>✧</span>${s.value>=80?'Высокий приоритет':s.value>=50?'Есть потенциал':'Нужна оценка'}<b>${s.value} / 100</b></div><p class="reason">${esc(g.posts>=2&&g.posts<=3?'Мало публикаций — повод предложить единый стиль':g.wallUnavailable?'Стена недоступна: число постов не определено':'Проверьте, что можно улучшить в оформлении')}</p><div class="cardactions"><button class="messagebtn" data-action="message" ${g.demo||g.canMessage===false?'disabled':''}>↗ &nbsp; ${g.canMessage===false?'Сообщения закрыты':g.canMessage===true?'Написать в ВК':'Проверить и открыть диалог'}</button><button class="details" data-action="details">Подробнее</button></div><div class="cardfoot"><span>${appeared?'Обнаружено в выбранном периоде':(created?'Создано':'Найдено')+' '+date(created?creationTimestamp(g,mode==='demo'):g.firstSeen)} · ${esc(statuses[g.status]||g.status)}</span><button data-action="hide">Не подходит</button></div></div></article>`;}).join('');$('empty').hidden=list.length>0;
}
function modal(title,html){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;if(!$('modal').open)$('modal').showModal();}
function deleteLocalData(){
  ['radar.live','radar.settings','radar.template'].forEach(key=>localStorage.removeItem(key));
  const user=Number(new URLSearchParams(location.search).get('vk_user_id'))||'browser';
  try{indexedDB.deleteDatabase('radar-monitor-'+user);}catch{}
  live=[];settings={};template=DEFAULT_TEMPLATE;mode='live';freshSessionIds=new Set();persist();render();toast('Локальные данные удалены с этого устройства.');
}
function legalModal(){modal('Документы и поддержка',`<h3>Политика конфиденциальности</h3><p>VK Leads обрабатывает только открытые данные сообществ, которые возвращает VK API: название, ссылка, описание, число подписчиков, публикации и доступность сообщений. Токен авторизации VK хранится только в памяти текущей сессии и не записывается в экспорт.</p><p>Карточки, фильтры и шаблон сообщения сохраняются локально в браузере. Данные не продаются, не передаются третьим лицам и не используются для автоматической рассылки.</p><h3>Пользовательское соглашение</h3><p>Вы запускаете поиск и открываете каждый диалог вручную. Приложение не отправляет сообщения автоматически. Вы обязуетесь соблюдать правила VK, уважать отказ от контакта, не отправлять массовые или повторяющиеся предложения и проверять содержание сообщения перед открытием диалога.</p><p>Время «впервые найдено» означает момент обнаружения в вашей локальной базе и не подтверждает дату создания сообщества.</p><h3>Поддержка</h3><p><a class="link" href="https://github.com/German22Fed/vk-leads/issues" target="_blank" rel="noopener noreferrer">Сообщить об ошибке или запросить помощь на GitHub ↗</a></p><p class="modalnote">Для удаления локальных карточек, фильтров и истории нажмите кнопку ниже. Выход из VK также удаляет токен из памяти после перезагрузки.</p><button class="secondary" id="deleteLocalData">Удалить локальные данные</button>`);$('deleteLocalData').onclick=()=>{if(confirm('Удалить карточки, фильтры и историю с этого устройства?'))deleteLocalData();};}
$('closeModal').onclick=()=>$('modal').close();
document.querySelectorAll('#legalNav,#legalBtn').forEach(el=>el.onclick=legalModal);
function reset(){for(const id of ['onlyNew','exact','canMessage'])$(id).checked=false;$('filterQuery').value='';$('period').value='';$('dateBasis').value='discovered';render();}
for(const id of ['filterQuery','period','sort','onlyNew','exact','canMessage','dateBasis','minHours','maxHours'])$(id).addEventListener(['filterQuery','minHours','maxHours'].includes(id)?'input':'change',render);
document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{$('period').value=b.dataset.period;render();});
$('resetFilters').onclick=reset;$('emptyReset').onclick=reset;
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===el));$('crumb').textContent=el.textContent.trim().replace(/^[^А-Я]+/,'');$('mainContent').hidden=view==='templates';$('templateView').hidden=view!=='templates';if(view==='templates')$('templateText').value=template;if(view==='pipeline'||view==='saved')reset();render();});
$('saveTemplate').onclick=()=>{const v=$('templateText').value.trim();if(!v)return toast('Введите текст предложения.');template=v;write('radar.template',v);toast('Шаблон сохранён');};
$('readAll').onclick=()=>{const ids=new Set(filterGroups(groups(),filters()).map(g=>g.id));groups().forEach(g=>{if(ids.has(g.id))g.seen=true;});persist();render();toast('Показанные сообщества отмечены просмотренными');};
$('cards').onclick=e=>{const b=e.target.closest('button[data-action]');if(!b)return;const g=groups().find(x=>x.id===Number(b.closest('[data-id]').dataset.id));if(!g)return;
 if(b.dataset.action==='save'){g.saved=!g.saved;persist();render();return;}
 if(b.dataset.action==='hide'){g.status='hidden';persist();render();toast('Убрано из ленты. Вернуть можно в разделе «В работе».');return;}
 g.seen=true;persist();render();if(b.dataset.action==='message'){compose(g);void prepareNativeMessage(g,$('draft').value);}else details(g);
};
async function verifyGroup(g){if(g.demo)return {ok:false,reason:'Демо-сообщество нельзя открыть в VK.'};try{const raw=await api('groups.getById',{group_ids:String(g.id),fields:'name,screen_name,deactivated,can_message,has_photo,cover'});const rows=groupRows(raw,[g.id],{allowIncomplete:true});const row=rows.find(x=>x.id===g.id);if(!isUsableGroup(row)){live=live.filter(x=>x.id!==g.id);persist();render();return {ok:false,reason:'VK больше не возвращает это сообщество. Карточка удалена из выдачи.'};}Object.assign(g,{name:row.name,screenName:row.screen_name||g.screenName,canMessage:row.can_message===undefined?null:!!row.can_message,verifiedAt:Date.now(),verification:'groups.getById'});persist();render();if(g.canMessage===null)return {ok:false,reason:'VK не вернул доступность сообщений. Повторите проверку или откройте страницу сообщества.'};if(!g.canMessage)return {ok:false,reason:'Сообщество существует, но сообщения в нём закрыты.'};return {ok:true};}catch(e){return {ok:false,reason:'Не удалось подтвердить сообщество через VK: '+e.message};}}
async function openVerifiedDialog(g,text){const wait=15000-(Date.now()-lastDialogOpenAt);if(wait>0){toast(`Подождите ${Math.ceil(wait/1000)} сек. перед следующим открытием диалога.`);return;}const check=await verifyGroup(g);if(!check.ok){toast(check.reason);return;}const long=text.length>1800;let copied=false;try{if(long&&navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);copied=true;}catch{}}const url=dialogUrl(g,long?'':text);lastDialogOpenAt=Date.now();if(auth.bridge?.send){try{await auth.bridge.send('VKWebAppOpenLink',{link:url});}catch{const w=window.open(url,'_blank');if(!w)throw Error('Браузер заблокировал окно.');w.opener=null;}}else{const w=window.open(url,'_blank');if(!w)throw Error('Браузер заблокировал окно.');w.opener=null;}if(g.status==='new')g.status='opened';persist();render();if(long)toast(copied?'Длинный текст GRM Studio скопирован. Вставьте его в открывшийся диалог VK.':'Диалог VK открыт. Скопируйте текст кнопкой «Скопировать текст» и вставьте его в диалог.');}catch(e){toast('Не удалось открыть диалог VK: '+String(e.message||e).slice(0,180));}}
let messagePending=false;
async function prepareNativeMessage(g,text){
 if(messagePending){toast('Дождитесь ответа окна VK.');return;}
 const status=$('messageStatus'),button=$('prepareMessage'),fallback=$('openDialog');
 const show=s=>{if(status?.isConnected)status.textContent=s;else toast(s);};
 if(!text.trim()){show('Добавьте текст сообщения.');return;}
 messagePending=true;if(button)button.disabled=true;if(fallback)fallback.disabled=true;
 try{
  show('Проверяем сообщество…');
  const check=await verifyGroup(g);if(!check.ok){show(check.reason);return;}
  show('Передаём письмо в VK. Подтвердите отправку в окне VK — текст и ссылки уже заполнены.');
  const result=await showPreparedMessage(auth.bridge,g.id,text);
  if(result.status==='unsupported'){
   show('Эта версия VK не поддерживает окно с готовым письмом. Мгновенная отправка от личной страницы недоступна. Используйте «Открыть диалог вручную» и «Скопировать текст».');
  }else if(result.status==='confirmed'){
   if(g.status==='new')g.status='opened';persist();render();
   show('VK завершил работу с окном сообщения. Проверить отправку можно в диалоге; статус работы отмечается вручную.');
  }else show('Отправка не подтверждена. Текст письма сохранён в этом окне.');
 }catch(e){show('VK не подтвердил отправку: '+errorText(e,auth.token));}
 finally{messagePending=false;if(button?.isConnected)button.disabled=!!g.demo;if(fallback?.isConnected)fallback.disabled=!!g.demo;}
}
function compose(g){modal('Готовое письмо в VK',`<p><b>${esc(g.name)}</b></p><label for="draft">Готовое сообщение GRM Studio</label><textarea id="draft" rows="18">${esc(messageFor(g,template))}</textarea><div class="modalnote">Передаём весь текст и ссылки в окно сообщения VK от текущего пользователя. Если ваше устройство поддерживает эту функцию, копировать и вставлять письмо не потребуется. Отправку вы подтверждаете в VK.</div><p id="messageStatus" role="status" aria-live="polite">Письмо готово. Можно отредактировать его перед передачей в VK.</p><div class="modalrow"><button class="primary" id="prepareMessage" ${g.demo?'disabled':''}>Написать готовое письмо</button><button class="secondary" id="openDialog" ${g.demo?'disabled':''}>Открыть диалог вручную ↗</button><button class="secondary" id="copyDraft">Скопировать текст</button></div>${!g.demo?`<p style="margin-top:14px"><a class="link" target="_blank" rel="noopener noreferrer" href="https://vk.ru/club${g.id}">Открыть сообщество ↗</a></p>`:''}<label for="leadStatus">Статус работы (отмечается вручную)</label><select id="leadStatus" class="statusselect">${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${g.status===k?'selected':''}>${v}</option>`).join('')}</select>`);
 $('copyDraft').onclick=async()=>{try{await navigator.clipboard.writeText($('draft').value);toast('Текст скопирован');}catch{$('draft').select();toast('Выделен текст: скопируйте его вручную');}};
 $('openDialog').onclick=()=>void openVerifiedDialog(g,$('draft').value);
 $('prepareMessage').onclick=()=>void prepareNativeMessage(g,$('draft').value);
 $('leadStatus').onchange=e=>{g.status=e.target.value;persist();render();};
}
function details(g){const s=score(g);modal(g.name,`<p>${esc(g.description||g.category)}</p><p>Впервые найдено: <b>${date(g.firstSeen)}</b><br>Дата создания: <b>${creationTimestamp(g,mode==='demo')!==null?date(creationTimestamp(g,mode==='demo'))+(g.demo?' (вымышленная)':''):'не подтверждена'}</b><br>Источник: ${esc(g.source)}${g.latestPost?`<br>Последняя доступная публикация: ${date(g.latestPost*1000)}`:''}</p>${g.observation?`<div class="modalnote">Проверок ID: ${g.observation.checks}. Не вернулся в ответе: ${g.observation.missingChecks} раз.<br>Результат: ${esc({baseline:'Исходная база, возраст неизвестен',candidate_today:'Кандидат за сегодня; создание не подтверждено',candidate_other_day:'Кандидат вне сегодняшнего интервала',older:'Есть публикация до интервала появления — группа старше'}[g.observation.verdict])}${g.observation.appearance?.kind==='candidate'?'<br>Интервал: '+date(g.observation.appearance.from)+' — '+date(g.observation.appearance.to):''}${g.observation.oldestObservedPost?'<br>Самая ранняя найденная публикация: '+date(g.observation.oldestObservedPost):''}${g.observation.wallError?'<br>Стена: '+esc(g.observation.wallError):''}</div>`:''}<h3>Почему приоритет ${s.value} из 100</h3><ul>${s.reasons.map(r=>`<li>${esc(r)}</li>`).join('')||'<li>Недостаточно признаков — оцените сообщество вручную.</li>'}</ul><p>Наличие аватарки и обложки не говорит о качестве дизайна или готовности купить услугу.</p><div class="modalrow"><button id="detailCompose" class="primary">Подготовить предложение</button>${!g.demo?`<a class="secondary" target="_blank" rel="noopener noreferrer" href="https://vk.ru/club${g.id}">Посмотреть в ВК ↗</a>`:''}</div>`);$('detailCompose').onclick=()=>compose(g);}
function renderConnection(){
 const s=auth.state, waiting=['connecting','authorizing','checking'].includes(s.status);
 const label=auth.connected?'VK подключён':waiting?'Подключение VK…':s.status==='error'?'VK не подключён: ошибка':'VK не подключён';
 const elapsed=waiting?' · '+Math.floor((Date.now()-s.since)/1000)+' с':'';
 $('connectionText').textContent=label;
 $('connectionSummary').textContent=label;
 $('connectionDetail').textContent=s.detail+elapsed+(serverConnected?' Локальный сборщик подключён отдельно.':'');
 $('connectionBanner').dataset.state=s.status;
 $('connectionAction').textContent=auth.connected?'Проверить подключение':waiting?'Показать состояние':'Подключение VK';
 if($('authState')){$('authState').textContent=label;$('authState').className='modalnote '+(auth.connected?'success':s.status==='error'?'error':'');}
 if($('authStatus')){$('authStatus').textContent=s.detail+elapsed;$('authStatus').className=s.status==='error'?'error':auth.connected?'success':'';}
 if($('connectVK')){$('connectVK').disabled=waiting;$('connectVK').textContent=waiting?'Подключаем…':auth.connected?'Проверить снова':'Подключить через VK';}
 if($('appId'))$('appId').disabled=waiting;
 if(auth.connected)startAutoSearch();
}
function settingsModal(){
 const launchAppId=Number(new URLSearchParams(location.search).get('vk_app_id')), appId=launchAppId||CONFIGURED_APP_ID;
 const appLink=`<a class="link" href="https://vk.ru/app${appId}" target="_blank" rel="noopener noreferrer">Открыть Mini App внутри VK ↗</a>`;
 modal('Подключение VK',`<div id="authState" class="modalnote" role="status"></div><p id="authStatus" aria-live="polite"></p><p>Нажмите кнопку ниже и подтвердите разрешение в окне VK. Поиск и открытие диалога выполняются только после вашего действия. Сервисный ключ здесь не нужен.</p><label for="appId">ID Mini App (если открыто не из VK)</label><input class="field" id="appId" inputmode="numeric" value="${appId||''}" placeholder="Подставится при запуске внутри VK"><div class="modalrow"><button id="connectVK" class="primary">Подключить через VK</button><button id="liveMode" class="secondary">Закрыть</button></div><p style="margin-top:16px">${appLink}</p><p class="modalnote">Вход действует до перезагрузки страницы. Статус всегда виден над лентой. Локальный сборщик — отдельная функция для компьютера; для поиска внутри VK он не требуется.</p>`);
 renderConnection();
 $('connectVK').onclick=async()=>{
  const id=Number($('appId').value)||CONFIGURED_APP_ID;settings.appId=id;write('radar.settings',settings);
  try{await auth.connect(id,Number(new URLSearchParams(location.search).get('vk_app_id')));mode='live';render();}catch{renderConnection();}
 };
 $('liveMode').onclick=()=>{$('modal').close();};
}
$('settingsBtn').onclick=settingsModal;$('connectBanner').onclick=settingsModal;$('connectionAction').onclick=settingsModal;
setInterval(()=>{if(['connecting','authorizing','checking'].includes(auth.state.status))renderConnection();},1000);
async function api(method,params){
 if(auth.connected)return auth.call(method,params);
 if(serverConnected)return (await collectorRequest('vk',{method,params})).response;
 throw Error('Нет подключения к VK. Нажмите «Подключение VK» над лентой.');
}
function searchModal(){
 const saved=settings.leadFilters||{};
 const presets={
  all:'салон красоты парикмахерская барбершоп косметология маникюр брови ресницы массаж эпиляция\nмебель мебель на заказ кухни кухни на заказ шкафы диваны интерьер дизайн декор шторы\nремонт строительство монтаж электрика сантехника окна двери потолки клининг\nпсихолог психология психотерапевт коуч консультант юрист бухгалтер риэлтор недвижимость\nмагазин одежда обувь аксессуары цветы подарки техника шоурум бутик\nкафе ресторан пекарня кондитерская доставка еды кофе бар суши пицца\nфитнес спорт йога танцы студия бассейн туризм отель фотограф\nклиника стоматология врач здоровье ветеринар аптека массаж\nагентство студия школа курсы детский центр услуги мастерская производство',
  fashion:'одежда магазин одежды обувь аксессуары сумки шоурум бутик ювелир',
  beauty:'салон красоты парикмахерская барбершоп косметология маникюр брови массаж',
  food:'кафе ресторан бар пекарня кондитерская доставка еды кофе суши пицца',
  services:'ремонт строительство агентство студия школа мастерская услуги клининг монтаж',
  experts:'психолог психотерапевт коуч юрист бухгалтер риэлтор консультант тренер эксперт',
  home:'мебель кухни шкафы интерьер дизайн ремонт окна двери шторы декор',
  health:'клиника стоматология врач здоровье фитнес йога массаж ветеринар',
  events:'фотограф фотостудия видеограф свадьба ведущий праздник туризм отель',
  local:'магазин цветы подарки автосервис автомойка такси прокат доставка'
 };
 const defaultMinus='казино, ставки, букмекер, крипто, форекс, инвестиции, накрутка, подписчики, бот, парсер, игра, гейминг, киберспорт, аниме, мемы, новости, политика, знакомства, 18+, эротика, vpn, торрент, ozon, озон, wildberries, вайлдберриз, авито, алиэкспресс, маркетплейс';
 modal('Поиск клиентов для дизайна',`<p class="modalintro">Подбираем реальные публичные сообщества через VK API. Вы сами выбираете направление, оцениваете карточку и вручную решаете, открывать ли диалог.</p>
 <label for="leadDirection">Направление</label><select class="statusselect" id="leadDirection"><option value="all">Все направления — расширенный каталог</option><option value="fashion">Одежда и обувь</option><option value="beauty">Красота и здоровье</option><option value="food">Еда и заведения</option><option value="services">Услуги и локальный бизнес</option><option value="experts">Эксперты и личные бренды</option><option value="home">Дом, мебель и ремонт</option><option value="health">Здоровье и спорт</option><option value="events">Фото, события и туризм</option><option value="local">Магазины и локальные услуги</option><option value="custom">Свои ключевые слова</option></select>
 <label for="searchQuery">Ключевые слова в названии сообщества</label><textarea class="field" id="searchQuery" rows="4" placeholder="по одному слову или фразе на строку">${esc(saved.query||presets.all)}</textarea>
 <label for="searchMinus">Исключить слова и фразы</label><textarea class="field" id="searchMinus" rows="3" placeholder="казино, ставки, крипто, 18+">${esc(saved.minus||defaultMinus)}</textarea>
 <div class="leadgrid"><label>Подписчиков от<input class="field" id="membersMin" type="number" min="0" value="${esc(saved.membersMin??10)}"></label><label>до<input class="field" id="membersMax" type="number" min="0" value="${esc(saved.membersMax??2000)}"></label><label>Публикаций от<input class="field" id="postsMin" type="number" min="0" value="${esc(saved.postsMin??0)}"></label><label>до<input class="field" id="postsMax" type="number" min="0" value="${esc(saved.postsMax??3)}"></label><label>Город или регион<input class="field" id="regionQuery" placeholder="например, Москва" value="${esc(saved.region||'')}"></label><label>Последний пост не старше, дней<input class="field" id="lastPostDays" type="number" min="0" value="${esc(saved.lastPostDays??0)}"></label><label>Результатов<select class="statusselect" id="searchLimit"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label></div>
 <label class="checkline"><input type="checkbox" id="onlyRecent" ${saved.recentHours?'checked':''}> Только впервые найденные за последние 24 часа</label>
 <label class="checkline"><input type="checkbox" id="onlyOpportunities" ${saved.opportunities!==false?'checked':''}> Приоритет: до 3 публикаций или отсутствует обложка/аватарка</label>
 <p class="modalnote">«Впервые найдено» — время обнаружения в вашей базе. VK не передаёт универсальную точную дату создания сообщества. Автоматические фоновые запросы отключены.</p>
 <div class="modalrow"><button class="primary" id="runSearch" ${busy?'disabled':''}>Запустить поиск</button><button class="secondary" id="stopSearch">Остановить</button></div><p id="searchStatus" style="margin-top:15px" aria-live="polite"></p>`);
 $('leadDirection').value=saved.direction||'all';
 $('searchLimit').value=String(saved.limit||50);
 $('leadDirection').onchange=e=>{if(e.target.value!=='custom')$('searchQuery').value=presets[e.target.value];};
 $('runSearch').onclick=async()=>{if(!(auth.connected||serverConnected)){return settingsModal();}const wait=15000-(Date.now()-lastSearchAt);if(wait>0)return toast(`Подождите ${Math.ceil(wait/1000)} сек. перед новым поиском.`);const query=$('searchQuery').value.trim();if(!query)return toast('Добавьте хотя бы одно ключевое слово.');const options={minus:$('searchMinus').value,region:$('regionQuery').value,membersMin:Number($('membersMin').value||0),membersMax:Number($('membersMax').value||0),postsMin:Number($('postsMin').value||0),postsMax:Number($('postsMax').value||0),lastPostDays:Number($('lastPostDays').value||0),recentHours:$('onlyRecent').checked?24:0,opportunities:$('onlyOpportunities').checked};const limit=Number($('searchLimit').value);try{searchPlan(query,limit);}catch(e){return toast(e.message);}settings.query=query;settings.leadFilters={...options,direction:$('leadDirection').value,limit};write('radar.settings',settings);lastSearchAt=Date.now();await search(query,limit,options);};
 $('stopSearch').onclick=()=>{runCancelled=true;progress('Поиск остановится после текущего запроса.');};
}
 $('searchBtn').onclick=searchModal;
function progress(s){$('feedStatus').textContent=s;if($('searchStatus'))$('searchStatus').textContent=s;}
async function enrich(ids){let collected=[],failed=0;const raw=await api('groups.getById',{group_ids:ids.join(','),fields:'name,screen_name,members_count,city,activity,description,has_photo,cover,can_message,deactivated'});const rows=groupRows(raw,ids,{allowIncomplete:true});for(const g of rows){if(runCancelled)break;if(!isLeadFitGroup(g))continue;let wall;try{wall=await api('wall.get',{owner_id:-g.id,count:5,filter:'all'});}catch(e){if(!(auth.connected||serverConnected))throw e;failed++;}collected.push({...normalizeGroup(g,wall),verifiedAt:Date.now(),verification:'groups.getById'});progress(`Проверено ${collected.length} из ${rows.length}. Недоступных стен: ${failed}.`);}return {collected,failed};}
function leadTerms(value){return String(value||'').split(/[\n,;]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);}
function leadFit(g,options){
 const hay=`${g.name||''} ${g.category||''} ${g.description||''} ${g.city||''}`.toLowerCase();
 if(!isLeadFitGroup(g))return false;
 if(leadTerms(options.minus).some(term=>hay.includes(term)))return false;
 if(options.region&&!(g.city||'').toLowerCase().includes(options.region.toLowerCase()))return false;
 if(Number.isFinite(options.membersMin)&&options.membersMin>0&&(g.members===null||g.members<options.membersMin))return false;
 if(Number.isFinite(options.membersMax)&&options.membersMax>0&&(g.members===null||g.members>options.membersMax))return false;
 if(Number.isFinite(options.postsMin)&&g.posts!==null&&g.posts<options.postsMin)return false;
 if(Number.isFinite(options.postsMax)&&options.postsMax>0&&(g.posts===null||g.posts>options.postsMax))return false;
 if(Number.isFinite(options.lastPostDays)&&options.lastPostDays>0&&(g.latestPost===null||Date.now()-g.latestPost*1000>options.lastPostDays*86400000))return false;
 if(options.opportunities&&!(g.posts!==null&&g.posts<=3||g.avatar===false||g.cover===false))return false;
 return true;
}
async function search(query,limit,options={}){
 if(busy)return;busy=true;runCancelled=false;
 if($('runSearch'))$('runSearch').disabled=true;$('searchBtn').disabled=true;
 let processed=0,newCount=0,failed=0;
 try{
  const plan=searchPlan(query,limit), exhausted=new Set(), unique=new Set();
  mode='live';render();
  freshFilter=false;
  for(const page of plan){
   if(runCancelled)break;if(exhausted.has(page.q))continue;
   progress('Ищем: '+page.q+'. Уже собрано '+unique.size+' разных сообществ…');
   const result=await api('groups.search',{...page,sort:0});
   if(!Array.isArray(result?.items))throw Error('Неожиданный ответ поиска ВК.');
   if(result.items.length<page.count)exhausted.add(page.q);
   for(const g of result.items)unique.add(g.id);
  }
  const ids=[...unique], before=new Set(live.map(g=>g.id));
  for(let offset=0;offset<ids.length&&!runCancelled;offset+=100){
   const result=await enrich(ids.slice(offset,offset+100));
   const now=Date.now(), known=new Map(live.map(g=>[g.id,g]));
   result.collected=result.collected.map(g=>({...g,firstSeen:known.get(g.id)?.firstSeen||now})).filter(g=>leadFit(g,options)&&(!options.recentHours||now-(g.firstSeen||now)<=options.recentHours*3600000));
   failed+=result.failed;processed+=result.collected.length;
   newCount+=result.collected.filter(g=>!before.has(g.id)).length;
   live=mergeGroups(live,result.collected);persist();render();
  }
  progress((runCancelled?'Остановлено. ':'')+'Проверено: '+processed+'. Впервые найдено: '+newCount+'. Стен недоступно: '+failed+'. Даты создания не подтверждены.');
  toast('Новых сообществ в базе: '+newCount);
 }catch(e){progress(e.message+' Уже обработано и сохранено: '+processed+'.');toast(e.message);}
 finally{busy=false;$('searchBtn').disabled=false;if($('runSearch'))$('runSearch').disabled=false;}
}
function importModal(){modal('Импорт сообществ',`<p>Вставьте ссылки или ID из вашей подборки, в том числе из приложения-источника. По одному на строке. До 100 сообществ за раз.</p><textarea id="importText" rows="6" placeholder="https://vk.ru/club123456\npublic654321\nshort_name"></textarea><button id="doImport" class="primary">Проверить и добавить</button><p id="importStatus" style="margin-top:15px" aria-live="polite">Для загрузки данных требуется подключение ВК.</p>`);$('doImport').onclick=async()=>{const parsed=parseGroups($('importText').value);if(parsed.invalid.length)return $('importStatus').textContent='Не удалось распознать: '+parsed.invalid.slice(0,4).join(', ');if(!parsed.ids.length||parsed.ids.length>100)return $('importStatus').textContent='Добавьте от 1 до 100 ссылок или ID.';if(!(auth.connected||serverConnected))return $('importStatus').textContent='Сначала подключите ВК через настройки. Ваш текст останется до закрытия окна.';if(busy)return $('importStatus').textContent='Дождитесь завершения текущего поиска.';busy=true;runCancelled=false;$('doImport').disabled=true;$('importStatus').textContent='Загружаем данные…';try{const {collected,failed}=await enrich(parsed.ids);live=mergeGroups(live,collected.map(g=>({...g,source:'Импорт ссылок'})));mode='live';freshFilter=false;persist();render();if($('importStatus'))$('importStatus').textContent=`Добавлено / обновлено: ${collected.length}. Стен недоступно: ${failed}.`;}catch(e){if($('importStatus'))$('importStatus').textContent=e.message;}finally{busy=false;if($('doImport'))$('doImport').disabled=false;}};}
$('importNav').onclick=importModal;
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,mode,exportedAt:new Date().toISOString(),groups:groups()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`vk-leads-${mode}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const launchId=Number(new URLSearchParams(location.search).get('vk_app_id'));if(launchId>0){settings.appId=launchId;mode='live';write('radar.settings',settings);}
render();
setInterval(()=>{if(!document.hidden&&view!=='templates')render();},60000);

let collectorSignature='';
let startAutoSearch=()=>{};
initCollector(s=>{serverConnected=s.connected;if(freshFilter&&freshObservationStartedAt){for(const g of s.groups||[]){const appearedAt=g.observation?.appearance?.to;if(g.observation?.appearance?.kind==='candidate'&&Number.isFinite(appearedAt)&&appearedAt>=freshObservationStartedAt)freshSessionIds.add(g.id);}}const signature=JSON.stringify(s.groups);if(signature!==collectorSignature){collectorSignature=signature;live=mergeGroups(live,(s.groups||[]).filter(isVerifiedGroup));mode='live';persist();}render();},()=>live.filter(g=>isVerifiedGroup(g)).map(g=>g.id),{
 api,isConnected:()=>auth.connected,onConnect:settingsModal,onSearch:searchModal,
 onFreshStart:()=>{freshSessionIds=new Set();freshObservationStartedAt=Date.now();freshFilter=true;mode='live';render();},
 onAutoGroups:groups=>{const filtered=groups.filter(isVerifiedGroup),before=new Set(live.map(g=>g.id));live=mergeGroups(live,filtered);mode='live';freshFilter=false;if(filtered.length){snapshotMode=true;$('dateBasis').value='discovered';autoFeedShown=true;}persist();render();toast(`Проверка VK: ${filtered.filter(g=>!before.has(g.id)).length} новых подходящих карточек добавлено в ленту.`);},
 onFreshGroups:groups=>{const filtered=groups.filter(isFreshLead);filtered.forEach(g=>freshSessionIds.add(g.id));live=mergeGroups(live,filtered);mode='live';view='discover';freshFilter=true;snapshotMode=true;$('dateBasis').value='id';$('sort').value='id';document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));persist();render();$('feedStatus').textContent='Свежий снимок VK: повторы скрыты, крупные старые сообщества исключены.';},
 onRegisterAutoStart:fn=>{startAutoSearch=fn;if(auth.connected)fn();},
  onShowCandidates:(period='today')=>{view='discover';$('dateBasis').value='appeared';$('period').value=period;$('sort').value='new';$('filterQuery').value='';snapshotMode=false;freshFilter=false;for(const id of ['onlyNew','exact','canMessage'])$(id).checked=false;document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));render();},
 onReset:()=>{live=live.map(g=>{if(g.source!=='Наблюдение Mini App')return g;const {observation,...rest}=g;return rest;});persist();render();}
});
