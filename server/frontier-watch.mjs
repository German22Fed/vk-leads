import {cleanGroupName,isUsableGroup,isLeadFitGroup} from '../dist/vk-data.js';

// This is a hypothesis based on ID growth, NOT evidence of registration time.
// A generic tombstone can describe a future ID or a previously hidden/deleted ID.
const genericPlaceholder=row=>/^(delete|deleted|removed|удалено|сообщество удалено)$/iu.test(cleanGroupName(row)) &&
  (!row.deactivated || row.deactivated==='deleted') && !(row.members_count>0);
export function beginFrontierCycle(state){
  state.frontierWatch.cycleFloor=state.frontierWatch.highest;
}
export function observeFrontierBatch({state,ids,rows,from,to}){
  const watch=state.frontierWatch,map=new Map(rows.map(r=>[r.id,r]));
  for(const id of ids){
    if(id<=watch.floorId)continue;
    const row=map.get(id),p=watch.probes[id]??={checks:0,everUsable:false};
    p.checks++;p.lastChecked=to;
    if(isUsableGroup(row)){
      const rec=state.records[id];
      if(!p.everUsable && !p.disqualified && id>watch.cycleFloor &&
        Number.isFinite(p.lastUnavailableFrom) && from-p.lastUnavailableAt>=30000 &&
        from-p.lastUnavailableAt<=3600000 && isLeadFitGroup(row) && row.is_closed!==1 && row.is_closed!==2 && rec){
        // Never reinterpret existing baseline data during migration. This probe
        // belongs to the new watch, established with a fresh frontier snapshot.
        if(rec.firstReturned===to && rec.appearance?.kind==='baseline'){
          rec.appearance={kind:'frontier_candidate',method:'frontier_transition',from:p.lastUnavailableFrom,to,
            lowerId:watch.cycleFloor,previousResponse:p.response,priorChecks:p.checks-1};
          rec.events.push({kind:'frontier_transition',at:to});
        }
      }
      p.everUsable=true;watch.highest=Math.max(watch.highest,id);
      delete p.lastUnavailableFrom;delete p.lastUnavailableAt;
    }else if(!row||genericPlaceholder(row)){
      if(p.everUsable){p.disqualified=true;if(state.records[id])state.records[id].frontierWithdrawn=true;}
      else {p.lastUnavailableFrom=from;p.lastUnavailableAt=to;p.response=row?'placeholder':'omitted';}
    }else{
      // A named deleted/banned group or incomplete response is not a future ID.
      p.disqualified=true;delete p.lastUnavailableFrom;delete p.lastUnavailableAt;
    }
  }
}
export function compactFrontierWatch(state){
  const watch=state.frontierWatch;if(!watch)return;
  for(const id of Object.keys(watch.probes))if(Number(id)<state.config.startId&&!state.records[id])delete watch.probes[id];
}
