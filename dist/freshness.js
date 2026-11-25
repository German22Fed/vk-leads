// These are exclusion signals, never a registration timestamp.
export const FRESHNESS_VERSION=1;
export function ownedPhotoDate(photo,id,now=Date.now()) {
  const at=photo?.date*1000;
  return photo?.owner_id===-id&&Number.isFinite(at)&&at>0&&at<=now?at:null;
}
export function olderEvidence(group,appearance,oldestPost,now=Date.now()) {
  if(!Number.isFinite(appearance?.from))return false;
  return [oldestPost,group?.oldestOwnedPhotoAt].some(at=>Number.isFinite(at)&&at>0&&at<=now&&at+1000<appearance.from);
}
export function startingBusiness(group) {
  return Number.isFinite(group.members)&&group.members<=150&&Number.isInteger(group.posts)&&group.posts<=10;
}
export function intervalInside(appearance,window) {
  return !!window&&Number.isFinite(appearance?.from)&&Number.isFinite(appearance?.to)&&appearance.from<=appearance.to&&appearance.from>=window.from&&appearance.to<=window.to;
}

