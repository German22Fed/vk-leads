import {Collector, publicRecord, verdict} from '../dist/collector-engine.js';
import {findIdFrontier} from '../dist/id-discovery.js';
import {groupRows, isUsableGroup, isLeadFitGroup} from '../dist/vk-data.js';
import {normalizeGroup} from '../dist/core.js';
import {beginFrontierCycle,observeFrontierBatch,compactFrontierWatch} from './frontier-watch.mjs';

const DAY=86400000, HOUR=3600000;
// Keep a wider moving window and a larger verification queue so one delayed
// GitHub run does not leave the UI with a tiny handful of cards. The public
// feed still publishes only verified, deduplicated candidates.
export const RECHECK_LIMIT=800;
export const SCAN_WIDTH=12000;
const candidate=r=>['candidate','frontier_candidate'].includes(r.appearance?.kind);
const fields='name,screen_name,photo_200,deactivated,members_count,city,activity,description,has_photo,cover,can_message';
export function selectRechecks(records,now,limit=RECHECK_LIMIT){
  const day=Math.floor((now+10800000)/DAY)*DAY-10800000;
  const bucket=r=>r.appearance.from>=now-HOUR?0:r.appearance.from>=now-3*HOUR?1:r.appearance.from>=day?2:3;
  const pending=Object.values(records).filter(r=>candidate(r)&&!r.frontierWithdrawn&&r.appearance.from>=now-DAY&&
    r.group&&isLeadFitGroup(r.group)&&Number.isFinite(r.group.members)&&r.group.members<=500&&verdict(r,now)!=='older'&&
    !(r.available&&r.group.wallUnavailable!==true&&r.group.verifiedAt>now-40*60000&&r.wallCheckedAt>now-40*60000&&!r.wallError));
  // Reserve work for each time bucket, then give unused capacity back. A surge
  // in the last hour must not starve the 1–3h or today's queue indefinitely.
  const complete=r=>Number(r.group.avatar===true&&r.group.cover===true);
  const queues=Array.from({length:4},(_,b)=>pending.filter(r=>bucket(r)===b).sort((a,b)=>complete(a)-complete(b)||(a.wallCheckedAt||0)-(b.wallCheckedAt||0)));
  const selected=[];
  for(let b=0;b<4;b++)selected.push(...queues[b].splice(0,Math.floor(limit*[.375,.375,.2,.05][b])));
  for(const q of queues)selected.push(...q.splice(0,Math.max(0,limit-selected.length)));
  return selected;
}
export function scanIds(state){
  const start=state.config.startId,end=Math.min(2147483647,start+SCAN_WIDTH-1);
  return Array.from({length:end-start+1},(_,i)=>start+i);
}
export function compactState(state,now){
  const rows=Object.values(state.records),keep=new Set(rows.filter(r=>r.id>=state.config.startId).map(r=>r.id));
  const recent=rows.filter(r=>candidate(r)&&r.appearance.to>=now-(isLeadFitGroup(r.group)?7*DAY:DAY));
  const retained=recent.sort((a,b)=>b.appearance.to-a.appearance.to).slice(0,10000);
  state.retentionDropped=(state.retentionDropped||0)+recent.filter(r=>!retained.includes(r)&&!keep.has(r.id)).length;
  for(const r of retained)keep.add(r.id);
  for(const r of rows.filter(r=>!r.everReturned&&r.firstChecked>=now-DAY).sort((a,b)=>b.firstChecked-a.firstChecked).slice(0,500))keep.add(r.id);
  for(const id of Object.keys(state.records))if(!keep.has(Number(id)))delete state.records[id];
  compactFrontierWatch(state);
}
export const eligible=(r, now)=>r.available===true && candidate(r) && !r.frontierWithdrawn &&
  r.group && isLeadFitGroup(r.group) && Number.isFinite(r.group.members) && r.group.members<=500 &&
  r.wallCheckedAt>=now-HOUR && !r.wallError && r.group.wallUnavailable===false &&
  r.group.verifiedAt>=now-HOUR && verdict(r,now)!=='older' && r.appearance.from>=now-DAY;

// Work on an isolated copy: a failed network cycle must not replace the checkpoint.
export async function collectOnce({previous=null,api,clock=Date.now,discover=findIdFrontier}){
  const startedAt=clock();
  const engine=new Collector({api,clock,onBatch:observeFrontierBatch,storage:{load:async()=>previous?structuredClone(previous):null,save:async()=>{}}});
  await engine.load();
  if(!engine.state.config || !engine.state.frontierWatch){
    const frontier=await discover({api});
    await engine.configure({startId:frontier.id+1,width:2000,intervalSeconds:900,advance:true});
    engine.state.bootstrap={id:frontier.id,at:clock()};
    engine.state.lastFrontierCheck=clock();
    engine.state.frontierWatch={version:1,floorId:frontier.id,highest:frontier.id,startedAt:clock(),probes:{}};
  }
  // Recover after long downtime or a wrongly estimated early gap. Newly skipped
  // IDs remain unknown/baseline, never retroactively labelled as appeared.
  if(startedAt-(engine.state.lastFrontierCheck||0)>6*HOUR){
    const frontier=await discover({api});
    if(frontier.id>=engine.state.config.startId+engine.state.config.width){
      await engine.configure({...engine.state.config,startId:frontier.id+1});
      engine.state.resyncs=(engine.state.resyncs||0)+1;
      engine.state.frontierWatch={version:1,floorId:frontier.id,highest:frontier.id,startedAt:clock(),probes:{}};
    }
    engine.state.lastFrontierCheck=clock();
  }
  compactState(engine.state,startedAt);
  beginFrontierCycle(engine.state);
  engine.idsForCycle=()=>scanIds(engine.state);
  const scanStart=engine.state.config.startId;
  const previousRun=engine.state.runs[0];
  const run=await engine.cycle();
  if(run.status!=='ok')throw Error('Цикл VK не завершён. Предыдущая база сохранена.');
  // Revisit provisional names after the scan window has moved on. Keep the
  // original appearance evidence; renaming never resets a group's age.
  const renames=Object.values(engine.state.records).filter(r=>candidate(r)&&!r.frontierWithdrawn&&r.appearance.to>=clock()-DAY&&r.group&&!isLeadFitGroup(r.group)&&r.group.verifiedAt<clock()-15*60000)
    .sort((a,b)=>a.group.verifiedAt-b.group.verifiedAt).slice(0,500);
  for(let offset=0;offset<renames.length;offset+=99){
    const batch=renames.slice(offset,offset+99),ids=[1,...batch.map(r=>r.id)];
    const rows=groupRows(await api('groups.getById',{group_ids:ids.join(','),fields}),ids,{allowIncomplete:true});
    if(!rows.some(r=>r.id===1&&isUsableGroup(r)))throw Error('Контрольная группа недоступна. База не изменена.');
    const map=new Map(rows.map(r=>[r.id,r]));
    for(const rec of batch){const row=map.get(rec.id);rec.available=isUsableGroup(row)&&!row.is_closed;
      if(rec.available)rec.group={...rec.group,...normalizeGroup(row),verifiedAt:clock(),verification:'groups.getById'};
    }
  }
  const candidates=selectRechecks(engine.state.records,clock());
  if(candidates.length){
    for(let offset=0;offset<candidates.length;offset+=99){
    const batch=candidates.slice(offset,offset+99);
    const ids=batch.map(r=>r.id), requested=[1,...ids];
    const rows=groupRows(await api('groups.getById',{group_ids:requested.join(','),fields}),requested,{allowIncomplete:true});
    if(!rows.some(r=>r.id===1&&isUsableGroup(r)))throw Error('Контрольная группа недоступна. База не изменена.');
    const map=new Map(rows.map(r=>[r.id,r]));
    for(const rec of batch){
      const row=map.get(rec.id);
      rec.available=isLeadFitGroup(row)&&!row.is_closed;
      if(!rec.available)continue;
      rec.group={...rec.group,...normalizeGroup(row),verifiedAt:clock(),verification:'groups.getById'};
      await engine.inspectWall(rec);
    }
    }
  }
  const now=clock();
  compactState(engine.state,now);
  const groups=Object.values(engine.state.records).filter(r=>eligible(r,now)).map(r=>({
    ...publicRecord(r,now),collectorFeed:true,source:r.appearance.kind==='frontier_candidate'?'Рост ID · кандидат, создание не подтверждено':'Постоянный сборщик VK',
  })).sort((a,b)=>b.observation.appearance.to-a.observation.appearance.to);
  const diagnostics=coverageReport(engine.state,now,groups);
  // Errors can contain transport details. Only structured observation data is persisted.
  for(const r of Object.values(engine.state.records))if(r.wallError)r.wallError='Стена недоступна';
  engine.state.runs=engine.state.runs.slice(0,10).map(({error,...r})=>r);
  return {state:engine.state,feed:{version:1,status:'ok',updatedAt:now,startedAt:engine.state.bootstrap.at,
    observation:{checked:run.checked,returned:run.returned,deleted:run.deleted,usable:run.usable,omitted:run.omitted,incomplete:run.incomplete,tracked:Object.keys(engine.state.records).length,frontierProbes:Object.keys(engine.state.frontierWatch.probes).length,frontierCandidates:groups.filter(g=>g.observation.appearance.kind==='frontier_candidate').length},
    verification:{limit:RECHECK_LIMIT,attempted:candidates.length,published:groups.length},
    coverage:{...diagnostics,scanStart,scanEnd:scanStart+run.checked-1,checkedThisPass:run.checked,
      gapSeconds:previousRun?Math.round((run.startedAt-previousRun.finishedAt)/1000):null,
      retentionDropped:engine.state.retentionDropped||0,allVkCovered:false},
    cycles:engine.state.cycles,checkedIds:Object.keys(engine.state.records).length,groups,
    note:'Кандидаты по росту ID и переходу из недоступного ответа в существующее сообщество. Время регистрации не подтверждено; восстановленные или ранее скрытые группы полностью исключить нельзя.'}};
}

export function coverageReport(state,now,groups){
  const rows=Object.values(state.records),counts={withoutInterval:0,olderInterval:0,withdrawn:0,irrelevant:0,audience:0,oldPosts:0,unavailable:0,wallError:0,pendingVerification:0,published:0};
  for(const r of rows){
    const reason=!candidate(r)?'withoutInterval':r.appearance.from<now-DAY?'olderInterval':r.frontierWithdrawn?'withdrawn':!isLeadFitGroup(r.group)?'irrelevant':
      !Number.isFinite(r.group.members)||r.group.members>500?'audience':verdict(r,now)==='older'?'oldPosts':!r.available?'unavailable':
      r.wallError?'wallError':eligible(r,now)?'published':'pendingVerification';
    counts[reason]++;
  }
  const periods={};
  const day=Math.floor((now+10800000)/DAY)*DAY-10800000;
  for(const [key,from,to] of [['1h',now-HOUR,now],['1-3h',now-3*HOUR,now-HOUR],['today',day,now]]){
    const overlaps=groups.filter(g=>g.observation.appearance.to>=from&&g.observation.appearance.from<=to);
    periods[key]={published:overlaps.filter(g=>g.observation.appearance.from>=from&&g.observation.appearance.to<=to).length,
      uncertainBoundary:overlaps.filter(g=>g.observation.appearance.from<from||g.observation.appearance.to>to).length};
  }
  return {counts,periods,tracked:rows.length};
}

