import {groupRows,isIncompleteGroup,isDeletedMarker,isUsableGroup,isClientFitGroup} from './vk-data.js?v=11.35.1';
import {normalizeGroup} from './core.js';

const MAX_ID = 2147479999;
function check(signal) { if (signal?.aborted) throw Error('Поиск остановлен.'); }

// Missing IDs are not a monotone predicate: deleted/private groups leave gaps.
// Probe blocks, retain returned/deactivated IDs as lower-bound evidence and
// describe the result as an estimated frontier, never as a creation timestamp.
export async function findIdFrontier({api, signal, onProgress=()=>{}, onProbe=()=>{}, upperLimit=MAX_ID, probeSize=99, maxRequests=70}) {
  if (!Number.isSafeInteger(upperLimit) || upperLimit < 2 || upperLimit > MAX_ID || !Number.isInteger(probeSize) || probeSize < 1 || probeSize > 99) throw Error('Некорректные границы поиска.');
  let requests=0, highest=1, lastObservedAt=null;
  const startedAt=Date.now();
  async function probe(end) {
    check(signal);
    if (++requests>maxRequests) throw Error('Лимит поиска границы исчерпан. Повторите поиск позднее.');
    const start=Math.max(2,end-probeSize+1);
    const ids=Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i);
    onProgress(`Ищем верхнюю границу ID · запрос ${requests}`);
    const rows=groupRows(await api('groups.getById',{group_ids:[1,...ids].join(','),fields:'name,deactivated,type,is_closed'}),[1,...ids],{allowIncomplete:true});
    check(signal);
    if (!rows.some(g=>g.id===1&&isUsableGroup(g))) throw Error('VK не вернул полноценную контрольную группу ID 1. Подключение не подтверждено; поиск остановлен.');
    // An ID-only row is neither an existing card nor proof of nonexistence.
    // Use readable/deactivated rows for this approximate search only. Observation
    // history handles partial rows separately and never counts them as missing.
    const incompleteIds=rows.filter(isIncompleteGroup).map(g=>g.id);
    // Estimate the global frontier from every usable public row. Filtering by
    // niche here can anchor the search on an old commercial group while newer
    // unrelated communities are ignored.
    const found=rows.filter(g=>g.id!==1&&isUsableGroup(g));
    if (found.length) highest=Math.max(highest,...found.map(g=>g.id));
    lastObservedAt=Date.now();
    onProbe({request:requests,from:start,to:end,returned:found.length,incompleteIds,highestReturned:found.length?Math.max(...found.map(g=>g.id)):null,at:lastObservedAt});
    return found.length>0;
  }
  // Exponential bracketing followed by a bounded binary search; no user seed.
  let low=1, high=Math.min(1024,upperLimit);
  while (await probe(high)) {
    low=high;
    if (high===upperLimit) throw Error('VK возвращает ID вплоть до предела поиска. Надёжно выделить границу не удалось.');
    high=Math.min(upperLimit,high*2);
  }
  while (high-low>1) {
    const mid=low+Math.floor((high-low)/2);
    if (await probe(mid)) low=mid; else high=mid;
  }
  // The frontier can move while requests are in flight. A new returned ID is
  // useful evidence, not an error. Bound catch-up rounds so a busy network
  // cannot keep the search running forever. No claim of a global maximum.
  let settled=false;
  for(let round=0;round<3;round++){
    const anchor=highest;
    for(const distance of [probeSize,probeSize*2,probeSize*4]){
      const end=Math.min(upperLimit,anchor+distance);
      await probe(end);
      if(highest===upperLimit)throw Error('VK возвращает ID вплоть до предела поиска. Надёжно выделить границу не удалось.');
    }
    if(highest===anchor){settled=true;break;}
  }
  if (highest===1) throw Error('Кроме контрольной группы VK ничего не вернул. Начальная граница не найдена.');
  return {id:highest,startedAt,checkedAt:lastObservedAt,requests,settled,method:'block_binary',precision:'estimated'};
}

export async function collectRecentIds({api,topId,count=500,signal,onProgress=()=>{},onBatch=()=>{}}) {
  if (!Number.isSafeInteger(topId)||topId<2||topId>MAX_ID||!Number.isInteger(count)||count<1||count>4800) throw Error('Некорректный диапазон свежих ID.');
  let checked=0, wallChecks=0, wallErrors=0, incompleteCount=0, deletedCount=0;
  const groups=[];
  for(let end=topId;end>=2&&checked<count;) {
    check(signal);
    const size=Math.min(99,count-checked,end-1);
    const ids=Array.from({length:size},(_,i)=>end-i);
    onProgress(`Собираем свежие ID · ${checked} / ${count}`);
    const rows=groupRows(await api('groups.getById',{group_ids:[1,...ids].join(','),fields:'name,deactivated,members_count,city,activity,description,has_photo,cover,can_message'}),[1,...ids],{allowIncomplete:true});
    check(signal);
    if(!rows.some(g=>g.id===1&&isUsableGroup(g)))throw Error('VK не вернул полноценную контрольную группу ID 1. Загрузка остановлена.');
    incompleteCount+=rows.filter(isIncompleteGroup).length;
    deletedCount+=rows.filter(g=>g.id!==1&&(!isClientFitGroup(g)||isDeletedMarker(g))).length;
    const batch=[];
    for(const row of rows.filter(g=>g.id!==1&&isClientFitGroup(g)).sort((a,b)=>b.id-a.id)) {
      check(signal);
      let wall;
      if(wallChecks<20){wallChecks++;try {wall=await api('wall.get',{owner_id:-row.id,count:5,filter:'all'});if(!Array.isArray(wall?.items)||!Number.isInteger(wall.count))throw Error('Некорректная стена');}catch(e){if(e.code===5)throw e;wall=undefined;wallErrors++;}}
      check(signal);
      batch.push({...normalizeGroup(row,wall),source:'Свежие ID · VK API',verifiedAt:Date.now(),verification:'groups.getById',idDiscovery:{method:'block_binary',observedAt:Date.now(),frontier:topId}});
    }
    groups.push(...batch);checked+=size;end-=size;
    await onBatch(batch);
  }
  return {groups,checked,wallChecks,wallErrors,incompleteCount,deletedCount,nextId:topId-checked};
}
