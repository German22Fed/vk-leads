import {pathToFileURL} from 'node:url';

// Queue one successor after success; concurrency serializes scheduled recovery.
// Cancelling a run skips this step. Disabling the workflow stops the chain.
export async function continueCollector({repository,token,fetcher=fetch}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!token)throw Error('Missing continuation context');
  const response=await fetcher(`https://api.github.com/repos/${repository}/actions/workflows/vk-collector.yml/dispatches`,{
    method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw Error(`Cannot queue collector successor (HTTP ${response.status})`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await continueCollector({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
  console.log('One successor monitoring session queued.');
}
