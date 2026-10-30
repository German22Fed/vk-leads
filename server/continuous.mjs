import {Collector, publicRecord, verdict} from '../dist/collector-engine.js';
import {findIdFrontier} from '../dist/id-discovery.js';
import {groupRows, isUsableGroup, isLeadFitGroup} from '../dist/vk-data.js';
import {normalizeGroup} from '../dist/core.js';
import {beginFrontierCycle,observeFrontierBatch,compactFrontierWatch} from './frontier-watch.mjs';

const DAY=86400000, HOUR=3600000;
const candidate=r=>['candidate','frontier_candidate'].includes(r.appearance?.kind);
const fields='name,screen_name,photo_200,deactivated,members_count,city,activity,description,has_photo,cover,can_message';
export function compactState(state,now){
  const rows=Object.values(state.records),keep=new Set(rows.filter(r=>r.id>=state.config.startId).map(r=>r.id));
  for(const r of rows.filter(r=>candidate(r)&&r.appearance.to>=now-7*DAY&&r.group&&isLeadFitGroup(r.group))
    .sort((a,b)=>b.appearance.to-a.appearance.to).slice(0,2000))keep.add(r.id);
  for(const r of rows.filter(r=>!r.everReturned&&r.firstChecked>=now-DAY).sort((a,b)=>b.firstChecked-a.firstChecked).slice(0,500))keep.add(r.id);
  for(const id of Object.keys(state.records))if(!keep.has(Number(id)))delete state.records[id];
  compactFrontierWatch(state);
}
export const eligible=(r, now)=>r.available===true && candidate(r) && !r.frontierWithdrawn &&
  r.group && isLeadFitGroup(r.group) && Number.isFinite(r.group.members) && r.group.members<=500 &&
  r.wallCheckedAt>=now-HOUR && !r.wallError && r.group.wallUnavailable===false &&
  r.group.verifiedAt>=now-HOUR && verdict(r,now)!=='older' && r.appearance.to>=now-7*DAY;

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
  const run=await engine.cycle();
  if(run.status!=='ok')throw Error('Цикл VK не завершён. Предыдущая база сохранена.');
  // Recheck candidates even after the moving window passed them. Oldest checked
  // first prevents one set of candidates starving all the following ones.
  const candidates=Object.values(engine.state.records).filter(r=>candidate(r) && !r.frontierWithdrawn &&
    r.appearance.to>=clock()-7*DAY && r.group && isLeadFitGroup(r.group) && verdict(r,clock())!=='older')
    .sort((a,b)=>(a.group.verifiedAt||0)-(b.group.verifiedAt||0)).slice(0,40);
  if(candidates.length){
    const ids=candidates.map(r=>r.id), requested=[1,...ids];
    const rows=groupRows(await api('groups.getById',{group_ids:requested.join(','),fields}),requested,{allowIncomplete:true});
    if(!rows.some(r=>r.id===1&&isUsableGroup(r)))throw Error('Контрольная группа недоступна. База не изменена.');
    const map=new Map(rows.map(r=>[r.id,r]));
    for(const rec of candidates){
      const row=map.get(rec.id);
      rec.available=isLeadFitGroup(row)&&!row.is_closed;
      if(!rec.available)continue;
      rec.group={...rec.group,...normalizeGroup(row),verifiedAt:clock(),verification:'groups.getById'};
      await engine.inspectWall(rec);
    }
  }
  const now=clock();
  compactState(engine.state,now);
  const groups=Object.values(engine.state.records).filter(r=>eligible(r,now)).map(r=>({
    ...publicRecord(r,now),collectorFeed:true,source:r.appearance.kind==='frontier_candidate'?'Рост ID · кандидат, создание не подтверждено':'Постоянный сборщик VK',
  })).sort((a,b)=>b.observation.appearance.to-a.observation.appearance.to).slice(0,500);
  // Errors can contain transport details. Only structured observation data is persisted.
  for(const r of Object.values(engine.state.records))if(r.wallError)r.wallError='Стена недоступна';
  engine.state.runs=engine.state.runs.slice(0,10).map(({error,...r})=>r);
  return {state:engine.state,feed:{version:1,status:'ok',updatedAt:now,startedAt:engine.state.bootstrap.at,
    observation:{checked:run.checked,returned:run.returned,deleted:run.deleted,usable:run.usable,omitted:run.omitted,incomplete:run.incomplete,tracked:Object.keys(engine.state.records).length,frontierProbes:Object.keys(engine.state.frontierWatch.probes).length,frontierCandidates:groups.filter(g=>g.observation.appearance.kind==='frontier_candidate').length},
    cycles:engine.state.cycles,checkedIds:Object.keys(engine.state.records).length,groups,
    note:'Кандидаты по росту ID и переходу из недоступного ответа в существующее сообщество. Время регистрации не подтверждено; восстановленные или ранее скрытые группы полностью исключить нельзя.'}};
}
