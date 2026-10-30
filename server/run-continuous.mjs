import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {vkClient,normalizeAccessToken} from './vk.mjs';
import {collectOnce} from './continuous.mjs';

// CLI emits fixed diagnostics only; never API bodies, tokens or request params.
const token=normalizeAccessToken(process.env.VK_SERVICE_TOKEN);
if(!token){console.error('Добавьте VK_SERVICE_TOKEN в GitHub Actions Secrets. Сбор не запущен.');process.exitCode=1;}
else try{
  let previous=null;
  try{previous=JSON.parse(await readFile('collector-data/state.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const {state,feed}=await collectOnce({previous,api:vkClient({getToken:()=>token,delay:600})});
  await mkdir('collector-data',{recursive:true});
  await writeFile('collector-data/state.tmp',JSON.stringify(state));
  await writeFile('dist/community-feed.tmp',JSON.stringify(feed));
  await rename('collector-data/state.tmp','collector-data/state.json');
  await rename('dist/community-feed.tmp','dist/community-feed.json');
  console.log(`Цикл ${feed.cycles}: проверено ID ${feed.checkedIds}, подходящих карточек ${feed.groups.length}.`);
}catch{console.error('Сбор не завершён. Проверьте доступ ключа к groups.getById и wall.get. Предыдущая опубликованная лента сохранена.');process.exitCode=1;}
