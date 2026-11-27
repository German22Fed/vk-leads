import test from 'node:test';
import assert from 'node:assert/strict';
import {watchCollector,saveCheckpoint} from '../server/watch-collector.mjs';
import {continueCollector} from '../server/continue-collector.mjs';
import {newestFeed,liveFeedResolver,LIVE_FEED_URL} from '../dist/hosted-feed.js';

test('Live feed pins a validated commit and limits metadata requests; API failure falls back safely',async()=>{
 let now=0,calls=0,fail=false;const sha='a'.repeat(40);
 const resolve=liveFeedResolver({clock:()=>now,fetchImpl:async()=>{calls++;return {ok:!fail,json:async()=>({ref:'refs/heads/main',object:{sha}})};}});
 assert.equal(await resolve(),LIVE_FEED_URL.replace('/main/',`/${sha}/`));
 now=60000;await resolve();assert.equal(calls,1);
 now=180000;fail=true;assert.equal(await resolve(),LIVE_FEED_URL);assert.equal(calls,2);
 const unsafe=liveFeedResolver({fetchImpl:async()=>({ok:true,json:async()=>({ref:'refs/heads/main',object:{sha:'https://wrong.test'}})})});
 assert.equal(await unsafe(),LIVE_FEED_URL);
});
import {retryVkReads} from '../server/retry-reads.mjs';

test('Transient read failures retry with backoff; access denial and writes do not retry',async()=>{
 let calls=0;const delays=[];
 const read=retryVkReads(async()=>{if(++calls<3)throw {code:6};return {ok:true};},{sleep:async ms=>delays.push(ms)});
 assert.deepEqual(await read('groups.getById',{}),{ok:true});assert.deepEqual(delays,[1000,3000]);
 for(const [method,code] of [['wall.get',15],['groups.getById',5],['messages.send',6]]){
  let n=0;await assert.rejects(retryVkReads(async()=>{n++;throw {code};},{sleep:async()=>{}})(method,{}));assert.equal(n,1);
 }
});

test('Monitoring publishes each pass, preserves cadence and ends without an unbounded loop',async()=>{
 let now=0;const starts=[],published=[],beats=[];
 const r=await watchCollector({minutes:15,clock:()=>now,sleep:async ms=>now+=ms,
 collect:async()=>{starts.push(now);now+=120000;},heartbeat:async h=>beats.push(h),publish:async()=>published.push(now)});
 assert.deepEqual(starts,[0,300000,600000]);assert.equal(r.passes,3);assert.equal(now,900000);
 assert.deepEqual(published,[120000,420000,720000]);assert.equal(beats[2].nextCheckAt,900000);
});
test('Failed collection never publishes a success heartbeat or continues rapidly',async()=>{
 let beat=0,pub=0;
 await assert.rejects(watchCollector({minutes:1,clock:()=>0,collect:async()=>{throw Error('failed');},heartbeat:async()=>beat++,publish:async()=>pub++}));
 assert.equal(beat,0);assert.equal(pub,0);
 await assert.rejects(watchCollector({minutes:500}),/Invalid/);
});
test('Slow passes do not overlap and a short final pass may finish before exit',async()=>{
 let now=0,calls=0;await watchCollector({minutes:10,clock:()=>now,sleep:async ms=>now+=ms,collect:async()=>{calls++;now+=420000;},heartbeat:async()=>{},publish:async()=>{}});
 assert.equal(calls,2);assert.equal(now,840000);
});
test('Publishing rebases concurrent code changes and retries a rejected push',async()=>{
 const commands=[];let pushes=0;
 await saveCheckpoint({run:async(_,args)=>{commands.push(args.join(' '));if(args[0]==='diff')throw {code:1};if(args[0]==='push'&&++pushes===1)throw Error('race');}});
 assert.equal(pushes,2);assert.equal(commands.filter(s=>s==='rebase origin/main').length,2);
 assert.ok(!commands.some(s=>s.includes('--force')));
});
test('Continuation queues one main-branch run and does not leak tokens on failure',async()=>{
 let calls=0;
 await continueCollector({repository:'German22Fed/vk-leads',token:'test-only',fetcher:async(url,opts)=>{
  calls++;assert.match(url,/vk-collector.yml\/dispatches$/);assert.deepEqual(JSON.parse(opts.body),{ref:'main'});assert.equal(opts.headers.Authorization,'Bearer test-only');return {ok:true};
 }});assert.equal(calls,1);
 await assert.rejects(continueCollector({repository:'German22Fed/vk-leads',token:'test-only',fetcher:async()=>({ok:false,status:403})}),e=>e.message.includes('403')&&!e.message.includes('test-only'));
});
test('Live checkpoint wins over stale Pages data, with a valid fallback on failure',async()=>{
 const now=10000000000,feed=at=>({version:1,status:'ok',updatedAt:at,groups:[]});
 let data=await newestFeed({urls:['https://example.org/live','https://example.org/pages'],now,timeoutMs:1000,fetchImpl:async u=>({ok:true,json:async()=>feed(u.pathname==='/live'?now:now-3600000)})});
 assert.equal(data.updatedAt,now);assert.equal(data.feedSource,'https://example.org/live');
 data=await newestFeed({urls:['https://example.org/live','https://example.org/pages'],now,timeoutMs:1000,fetchImpl:async u=>{if(u.pathname==='/live')throw Error('offline');return {ok:true,json:async()=>feed(now-1000)};}});
 assert.equal(data.updatedAt,now-1000);
 data=await newestFeed({urls:['https://example.org/live','https://example.org/pages'],now,timeoutMs:1000,fetchImpl:async u=>({ok:true,json:async()=>feed(u.pathname==='/live'?now+86400000:now)})});
 assert.equal(data.updatedAt,now,'future-dated malformed feed cannot override a valid snapshot');
});
