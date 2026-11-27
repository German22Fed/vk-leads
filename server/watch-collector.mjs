import {readFile,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));

// One bounded session, one writer. Publication does not depend on Pages builds.
export async function watchCollector({collect,publish,heartbeat,clock=Date.now,sleep=pause,minutes=50,cadenceMs=300000}){
  if(!Number.isFinite(minutes)||minutes<1||minutes>50)throw Error('Invalid monitoring duration');
  const started=clock(),deadline=started+minutes*60000;let passes=0;
  while(clock()<deadline){
    const passStart=clock();
    await collect();passes++;
    const next=clock()+Math.max(0,cadenceMs-(clock()-passStart));
    await heartbeat({mode:'watch',sessionStartedAt:started,sessionEndsAt:deadline,pass:passes,lastSuccessAt:clock(),targetIntervalSeconds:cadenceMs/1000,nextCheckAt:Math.min(next,deadline)});
    await publish();
    if(clock()>=deadline)break;
    await sleep(Math.min(Math.max(0,next-clock()),deadline-clock()));
  }
  return {passes,started,finished:clock()};
}

export async function saveCheckpoint({run=exec}={}){
  await run('git',['add','dist/community-feed.json']);
  await run('git',['add','-f','collector-data/state.json']);
  let changed=false;
  try{await run('git',['diff','--cached','--quiet']);}catch(e){if(e.code===1)changed=true;else throw Error('Cannot inspect collector changes');}
  if(!changed)return;
  await run('git',['commit','-m','Refresh live collector checkpoint']);
  // Rebase preserves concurrent code edits; genuine conflicts stop publication.
  for(let attempt=0;attempt<3;attempt++){
    await run('git',['fetch','origin','main']);
    await run('git',['rebase','origin/main']);
    try{await run('git',['push','origin','HEAD:main']);return;}catch{if(attempt===2)throw Error('Checkpoint publication failed');}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    await exec('git',['config','user.name','VK Leads Collector']);
    await exec('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
    const result=await watchCollector({minutes:Number(process.env.MONITOR_MINUTES||50),
      collect:async()=>{await exec(process.execPath,['server/run-continuous.mjs'],{timeout:15*60000,maxBuffer:1024*1024});},
      heartbeat:async health=>{const file='dist/community-feed.json';const feed=JSON.parse(await readFile(file,'utf8'));feed.monitor=health;await writeFile(file+'.tmp',JSON.stringify(feed));await rename(file+'.tmp',file);},
      publish:async()=>{await saveCheckpoint();console.log('Verified feed and checkpoint published.');}
    });
    console.log(`Monitoring session finished: ${result.passes} passes.`);
  }catch{console.error('Monitoring stopped; last successful checkpoint is preserved. Check VK access or repository publication.');process.exitCode=1;}
}
