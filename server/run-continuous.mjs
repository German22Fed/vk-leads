import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {vkClient,normalizeAccessToken} from './vk.mjs';
import {collectOnce} from './continuous.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// CLI emits fixed diagnostics only; never API bodies, tokens or request params.
export async function runContinuous({token=normalizeAccessToken(process.env.VK_SERVICE_TOKEN),dir=process.cwd(),log=console}={}){
const file=name=>path.join(dir,name);
async function publishFailure(errorCode){
  let feed={version:1,status:'waiting',groups:[]};
  try{feed=JSON.parse(await readFile(file('dist/community-feed.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  feed.collector={status:'error',errorCode,attemptedAt:Date.now()};
  await mkdir(file('dist'),{recursive:true});
  await writeFile(file('dist/community-feed.tmp'),JSON.stringify(feed));
  await rename(file('dist/community-feed.tmp'),file('dist/community-feed.json'));
}
if(!token){await publishFailure('missing_token');log.error('Добавьте VK_SERVICE_TOKEN в GitHub Actions Secrets. Сбор не запущен.');return 1;}
else try{
  let previous=null;
  try{previous=JSON.parse(await readFile(file('collector-data/state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const {state,feed}=await collectOnce({previous,api:vkClient({getToken:()=>token,delay:600})});
  await mkdir(file('collector-data'),{recursive:true});
  await writeFile(file('collector-data/state.tmp'),JSON.stringify(state));
  await writeFile(file('dist/community-feed.tmp'),JSON.stringify(feed));
  await rename(file('collector-data/state.tmp'),file('collector-data/state.json'));
  await rename(file('dist/community-feed.tmp'),file('dist/community-feed.json'));
  log.log(`Цикл ${feed.cycles}: проверено ID ${feed.observation.checked}, доступны ${feed.observation.usable}, заглушки ${feed.observation.deleted}, подходящих карточек ${feed.groups.length}.`);return 0;
}catch{await publishFailure('collection_failed');log.error('Сбор не завершён. Проверьте доступ ключа к groups.getById и wall.get. Предыдущие данные сохранены; состояние ошибки опубликовано.');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runContinuous();
