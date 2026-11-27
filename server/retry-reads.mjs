const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Retry read-only transient failures. Authorization, permission and parameter
// errors are never worked around; the caller receives the original failure.
export function retryVkReads(api,{sleep=pause}={}){
  return async(method,params)=>{
    for(let attempt=0;;attempt++){
      try{return await api(method,params);}catch(e){
        if(!['groups.getById','wall.get'].includes(method)||attempt>=2||(e.code!==undefined&&![6,10].includes(e.code)))throw e;
        await sleep([1000,3000][attempt]);
      }
    }
  };
}
