export const DEFAULT_TEMPLATE="Здравствуйте! 👋\n\nМеня зовут Герман. Я развиваю GRM Studio — digital-студию, которая помогает бизнесу профессионально выглядеть в интернете, выделяться среди конкурентов и развиваться онлайн.\n\nМы занимаемся дизайном, оформлением социальных сетей, созданием сайтов, чат-ботов, рекламных материалов, настройкой таргетированной рекламы и продвижением.\n\nУСЛУГИ И СТОИМОСТЬ\n\nВКонтакте\n\n• Оформление сообщества — 2 000 ₽\n• Расширенное оформление сообщества — 3 000 ₽\n• Оформление личной страницы — 1 500 ₽\n\nВ оформление сообщества могут входить:\n\n• обложка;\n• аватар;\n• меню;\n• оформление услуг;\n• карточки;\n• единый фирменный стиль.\n\nСостав работ согласуем с учётом вашей ниши, задач и пожеланий.\n\nСайты\n\n• Создание лендинга или сайта — 8 000 ₽\n\nРазрабатываем современный адаптивный дизайн для компьютера и смартфона, продумываем структуру страницы и добавляем удобные кнопки для связи с клиентами.\n\nЧат-боты\n\n• Разработка чат-бота — 6 000 ₽\n\nОформление других площадок\n\n• Оформление профиля на «Авито» — 1 500 ₽\n• Оформление профиля Instagram — 1 200 ₽\n• Оформление аккаунта YouTube — 1 000 ₽\n\nКонтент и дизайн\n\n• Карточка товара — 200–350 ₽ за штуку\n• Создание поста — 500–1 000 ₽ за пост\n\nРеклама и продвижение\n\n• Настройка таргетированной рекламы — 2 500 ₽\n• Настройка или продвижение в «Яндекс Картах» — 2 500 ₽\n\nВ GRM Studio мы не используем шаблонный подход. Каждый дизайн создаётся под конкретную нишу, целевую аудиторию и задачи бизнеса.\n\nМы можем комплексно оформить ваш проект — от сообщества и сайта до чат-бота, рекламы и продвижения.\n\nНаша задача — не просто сделать красиво, а создать профессиональную визуальную подачу, которая вызывает доверие и помогает бренду выглядеть заметнее.\n\nПРИМЕРЫ НАШИХ РАБОТ\n\nhttps://vk.ru/talanteliay_saratov\n\nhttps://vk.ru/desertschita\n\nhttps://vk.ru/grm_studio\n\nhttps://vk.ru/club231701229\n\nhttps://vk.ru/club238903472\n\nЕсли вам нужно оформить сообщество, создать сайт или чат-бота, запустить рекламу или комплексно обновить визуал бизнеса — напишите и расскажите о своей задаче. Я подскажу подходящий вариант и сориентирую по объёму работ.\n\nБуду рад обсудить ваш проект!\n\nОПЛАТА — ПОСЛЕ ВЫПОЛНЕНИЯ РАБОТЫ.";
export function parseGroups(text){
 const tokens=text.trim().split(/[\s,;]+/).filter(Boolean), ids=[], invalid=[];
 for(let token of tokens){try{if(/^https?:\/\//i.test(token)){const u=new URL(token);if(!['vk.ru','vk.com','www.vk.ru','www.vk.com','m.vk.com','m.vk.ru'].includes(u.hostname))throw Error();token=u.pathname.replace(/^\/+|\/+$/g,'');}token=token.replace(/^(club|public)(?=\d+$)/,'');if(!/^(?:[1-9]\d*|[a-zA-Z][a-zA-Z0-9_.]{2,63})$/.test(token)||/^(app|id)\d+$/.test(token))throw Error();ids.push(token);}catch{invalid.push(token);}}
 return {ids:[...new Set(ids)],invalid};
}
export function score(g){let n=0;const reasons=[];if(g.posts>=2&&g.posts<=3){n+=40;reasons.push('2–3 публикации — можно предложить стартовый комплект');}if(g.avatar===true&&g.cover===true){n+=20;reasons.push('Есть базовое оформление — можно обсудить единый стиль');}if(g.members>0&&g.members<=500){n+=20;reasons.push('Небольшая аудитория');}if(g.canMessage===true){n+=20;reasons.push('Сообщения сообщества доступны');}return {value:n,reasons};}
export function mergeGroups(existing,incoming,now=Date.now()) {const map=new Map(existing.map(g=>[g.id,g]));for(const g of incoming){const prev=map.get(g.id);map.set(g.id,{...prev,...g,firstSeen:prev?.firstSeen??now,seen:prev?.seen??false,status:prev?.status??'new',saved:prev?.saved??false,checkedAt:now});}return [...map.values()];}
const HOUR=3600000;
export function timeWindow(period,now=Date.now(),minHours=0,maxHours=3){
 if(!period)return {from:0,to:now};
 if(period==='today'){const moscow=now+3*HOUR;return {from:Math.floor(moscow/86400000)*86400000-3*HOUR,to:now};}
 if(period==='custom'){
  if(minHours===''||maxHours==='')return null;
  const min=Number(minHours),max=Number(maxHours);
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<=min||max>87600)return null;
  return {from:now-max*HOUR,to:now-min*HOUR};
 }
 const ranges={'1h':[0,1],'3h':[0,3],'1-3h':[1,3],'5h':[0,5],'24h':[0,24],'7d':[0,168],'30d':[0,720],'1':[0,24],'7':[0,168],'30':[0,720]};
 const range=ranges[period];return range?{from:now-range[1]*HOUR,to:now-range[0]*HOUR}:null;
}
// A creation timestamp is accepted only from an adapter with explicit provenance.
// VK search, firstSeen, first post and community ID never establish creation time.
export function creationTimestamp(g,allowDemo=false){const c=g.creation;if(!c||!Number.isFinite(c.at)||c.at<=0||c.precision!=='second')return null;if(c.kind==='demo')return allowDemo&&g.demo===true?c.at:null;return c.kind==='confirmed'&&typeof c.source==='string'&&c.source.trim()?c.at:null;}
export function filterGroups(groups,f,now=Date.now()){
 const window=timeWindow(f.period,now,f.minHours,f.maxHours);
 const timestamp=g=>f.dateBasis==='created'?creationTimestamp(g,f.allowDemo===true):f.dateBasis==='appeared'?g.observation?.appearance?.to:g.firstSeen;
 return groups.filter(g=>{
 if(f.dateBasis==='id'&&!g.idDiscovery)return false;
 if(f.view==='saved'&&!g.saved)return false;
 if(f.view==='pipeline'&&g.status==='new')return false;
 if(f.view!=='pipeline'&&g.status==='hidden')return false;
 if(f.onlyNew&&g.seen)return false;
 if(f.exact&&!(g.posts>=2&&g.posts<=3&&g.avatar===true&&g.cover===true))return false;
 if(f.canMessage&&g.canMessage!==true)return false;
 if(f.query&&!`${g.name} ${g.city||''} ${g.category||''}`.toLowerCase().includes(f.query.toLowerCase()))return false;
 if(f.dateBasis==='appeared'){const o=g.observation,a=o?.appearance;if(!window||!['candidate_today','candidate_other_day'].includes(o?.verdict)||a?.kind!=='candidate'||!Number.isFinite(a.from)||!Number.isFinite(a.to)||a.from>a.to||a.from<window.from||a.to>window.to||g.available!==true)return false;}
 if(f.dateBasis!=='id'&&(f.period||f.dateBasis==='created')){const at=timestamp(g);if(!window||!Number.isFinite(at)||at<window.from||at>window.to)return false;}
 return true;
 }).sort((a,b)=>f.sort==='id'?b.id-a.id:f.sort==='new'?(timestamp(b)||0)-(timestamp(a)||0):score(b).value-score(a).value);}
export function searchPlan(text,limit){
 const queries=[...new Set(text.split(/[\n;,]+/).map(s=>s.trim()).filter(Boolean))];
 if(!queries.length||queries.length>10)throw Error('Укажите от 1 до 10 тематик через запятую.');
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Лимит поиска должен быть от 1 до 1000.');
 const plan=[];const budget=queries.map((_,i)=>Math.floor(limit/queries.length)+(i<limit%queries.length?1:0));
 for(let offset=0;offset<1000;offset+=100)queries.forEach((q,i)=>{if(budget[i]>offset)plan.push({q,offset,count:Math.min(100,budget[i]-offset)});});
 return plan;
}
export function messageFor(g,template){return template.replaceAll('{name}',g.name);}
export function dialogUrl(g,text){if(!Number.isSafeInteger(g.id)||g.id<=0)throw Error('Некорректный ID');return `https://vk.ru/im?sel=-${g.id}&msg=${encodeURIComponent(text)}`;}
export function normalizeGroup(g,wall){return {id:g.id,name:g.name,screenName:g.screen_name,city:g.city?.title||'Город не указан',category:g.activity||'Сообщество',members:g.members_count??null,posts:wall?.count??null,avatar:g.has_photo===undefined?null:!!g.has_photo,photo:g.photo_200||'',cover:g.cover?.enabled===undefined?null:!!g.cover.enabled,coverUrl:g.cover?.images?.at(-1)?.url||'',canMessage:g.can_message===undefined?null:!!g.can_message,description:g.description||'',latestPost:wall?.items?.filter(p=>!p.is_pinned).sort((a,b)=>b.date-a.date)[0]?.date??null,source:'VK API',wallUnavailable:!wall};}
