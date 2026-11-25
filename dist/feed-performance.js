export const PAGE_SIZE = 36;
export function currentSnapshotRows(rows,ids,updatedAt,now=Date.now()) {
  if(!Number.isFinite(updatedAt)||updatedAt<=0||updatedAt>now+60000||now-updatedAt>6*3600000)return [];
  return rows.filter(g=>ids.has(g.id)&&g.collectorFeed===true&&g.available===true);
}
export function pageSlice(rows, requested = 1) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, Number(requested) || 1));
  return {page,pages,rows:rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),total:rows.length};
}
export function rememberProgress(progress, rows) {
  for(const g of rows) {
    if(!Number.isSafeInteger(g.id))continue;
    if(g.seen || g.saved || (g.status && g.status!=='new') || progress[g.id])
      progress[g.id]={seen:!!g.seen,saved:!!g.saved,status:g.status||'new',statusUpdatedAt:g.statusUpdatedAt||0,firstSeen:g.firstSeen};
  }
  return progress;
}
export function personalArchive(rows) {
  // The server feed is reloadable. Keep only user work and manual imports;
  // omit growing collector diagnostics from the local archive.
  return rows.filter(g=>!g.collectorFeed||g.saved||g.status&&g.status!=='new').map(g=>{
    const {observation,...rest}=g;
    return {...rest,...(observation?{observation:{...observation,events:[]}}:{})};
  });
}
export function mergeHostedSnapshot(existing,incoming,progress,now=Date.now()) {
  rememberProgress(progress,existing);
  const old=new Map(existing.map(g=>[g.id,g]));
  const incomingIds=new Set(incoming.map(g=>g.id));
  const kept=personalArchive(existing).filter(g=>!incomingIds.has(g.id))
    .map(g=>g.collectorFeed?{...g,available:false}:g);
  for(const g of incoming){
    const previous=old.get(g.id),local=progress[g.id];
    kept.push({...g,firstSeen:local?.firstSeen??previous?.firstSeen??g.firstSeen??now,
      seen:local?.seen??previous?.seen??false,saved:local?.saved??previous?.saved??false,
      status:local?.status??previous?.status??'new',statusUpdatedAt:local?.statusUpdatedAt??previous?.statusUpdatedAt??0});
  }
  return kept;
}

