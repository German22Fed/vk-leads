import {pathToFileURL} from 'node:url';

// Upload completion can precede visibility in the REST API used by deploy-pages.
export async function waitForPagesArtifact({url,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=12}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const response=await fetcher(url,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
      if(response.ok) {
        const data=await response.json();
        if(data.artifacts?.some(a=>a.name==='github-pages'&&!a.expired&&a.size_in_bytes>0))return true;
      }
    } catch { /* Retry transient API errors without logging response details. */ }
    if(attempt<attempts-1)await sleep(5000);
  }
  throw new Error('GitHub Pages artifact is not visible yet. Deployment was not started.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {GITHUB_REPOSITORY,GITHUB_RUN_ID}=process.env;
  if(!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY||'')||!/^\d+$/.test(GITHUB_RUN_ID||''))throw Error('Missing GitHub run context');
  // This repository is public; no additional credentials or permissions needed.
  await waitForPagesArtifact({url:`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts`});
  console.log('Pages artifact is visible; ready to deploy.');
}

