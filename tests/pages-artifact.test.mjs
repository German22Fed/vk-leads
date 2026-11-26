import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPagesArtifact} from '../server/wait-pages-artifact.mjs';
test('Pages deployment waits for uploaded artifact metadata to become visible',async()=>{
  let calls=0,waits=0;
  await waitForPagesArtifact({url:'https://example.test',sleep:async()=>waits++,fetcher:async()=>({ok:true,json:async()=>({artifacts:++calls===3?[{name:'github-pages',size_in_bytes:100,expired:false}]:[]})})});
  assert.equal(calls,3);assert.equal(waits,2);
});
test('Readiness uses job authorization and reports status without exposing credentials',async()=>{
 let auth;
 await assert.rejects(waitForPagesArtifact({url:'https://example.test',token:'test-only-value',attempts:1,fetcher:async(_,options)=>{
   auth=options.headers.Authorization;return {ok:false,status:403};
 }}),e=>e.message.includes('403')&&!e.message.includes('test-only-value'));
 assert.equal(auth,'Bearer test-only-value');
});
test('Pages readiness retries network errors and rejects expired or unrelated artifacts',async()=>{
  let calls=0;
  await assert.rejects(waitForPagesArtifact({url:'https://example.test',attempts:3,sleep:async()=>{},fetcher:async()=>{
    if(++calls===1)throw Error('network');
    return {ok:true,json:async()=>({artifacts:[{name:'github-pages',expired:true,size_in_bytes:10},{name:'other',expired:false,size_in_bytes:10}]})};
  }}),/not visible/);
  assert.equal(calls,3);
});
