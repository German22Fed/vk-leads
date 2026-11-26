import {pathToFileURL} from 'node:url';

// Upload completion can precede visibility in the REST API used by deploy-pages.
export async function waitForPagesArtifact({url,token,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=36}) {
  let lastStatus='network';
  const headers={Accept:'application/vnd.github+json',...(token?{Authorization:`Bearer ${token}`}:{})};
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const response=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)});
      lastStatus=response.status||'unknown';
      if(response.ok) {
        const data=await response.json();
        if(data.artifacts?.some(a=>a.name==='github-pages'&&!a.expired&&a.size_in_bytes>0))return true;
      }
    } catch { /* Retry transient API errors without logging response details. */ }
    if(attempt<attempts-1)await sleep(5000);
  }
  throw new Error(`GitHub Pages artifact is not visible yet (last HTTP status: ${lastStatus}). Deployment was not started.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {GITHUB_REPOSITORY,GITHUB_RUN_ID}=process.env;
  if(!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY||'')||!/^\d+$/.test(GITHUB_RUN_ID||''))throw Error('Missing GitHub run context');
  // Use the job's read-only Actions permission rather than a shared anonymous
  // runner quota. Never print credentials or API response bodies.
  await waitForPagesArtifact({url:`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts`,token:process.env.GITHUB_TOKEN});
  console.log('Pages artifact is visible; ready to deploy.');
}
