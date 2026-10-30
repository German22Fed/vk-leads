import {deadline} from './vk-connection.js?v=11.35.1';

// Call directly from a click, not after verification or a supportsAsync request.
export async function copyPreparedText(text,{bridge,clipboard,legacyCopy=()=>false,selectText=()=>{},timeout=4000}={}){
  if(typeof text!=='string'||!text.trim())return {status:'empty'};
  if(bridge?.send){
    try{
      const result=await deadline(bridge.send('VKWebAppCopyText',{text}),timeout,'Копирование VK не ответило.');
      if(result?.result===true)return {status:'copied',method:'vk'};
    }catch{}
  }
  try{
    if(clipboard?.writeText){
      await deadline(clipboard.writeText(text),timeout,'Буфер обмена не ответил.');
      return {status:'copied',method:'clipboard'};
    }
  }catch{}
  // Older WebViews may lack the modern clipboard API. Select the textarea
  // inside the active modal rather than an element outside its focus scope.
  try{if(legacyCopy(text)===true)return {status:'copied',method:'selection'};}catch{}
  selectText();
  return {status:'manual'};
}

// The host owns the confirmation and the sender identity. Never replace this
// with messages.send using a community token or an external user's token.
export async function showPreparedMessage(bridge, groupId, text) {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw Error('Некорректное сообщество.');
  if (typeof text !== 'string' || !text.trim()) throw Error('Добавьте текст сообщения.');
  if (!bridge?.send || !bridge?.supportsAsync) return {status:'unsupported'};
  let supported;
  try {
    supported = await deadline(bridge.supportsAsync('VKWebAppShowMessageBox'), 5000, 'Нет ответа VK.');
  } catch {
    return {status:'unsupported'};
  }
  if (!supported) return {status:'unsupported'};
  // Preserve every character, paragraph and link, including long templates.
  // Do not fall back or retry after this call: the user may have cancelled,
  // or the host may have accepted the message without returning a response.
  const result = await deadline(bridge.send('VKWebAppShowMessageBox', {
    peer_id: -groupId, message: text,
  }), 120000, 'VK не подтвердил результат. Проверьте диалог перед повтором, чтобы не отправить письмо дважды.');
  return {status:result?.result === true ? 'confirmed' : 'cancelled'};
}

// Fall back only when no native message operation has started. Cancellation,
// rejection or an uncertain native response must never initiate another action.
export async function prepareConversation({bridge,groupId,text,verify,copy,openDialog,onProgress=()=>{}}){
  if(!Number.isSafeInteger(groupId)||groupId<=0)throw Error('Некорректное сообщество.');
  if(typeof text!=='string'||!text.trim())throw Error('Добавьте текст сообщения.');
  onProgress('checking');
  const checked=await verify();
  if(!checked.ok)return {status:'blocked',reason:checked.reason};
  onProgress('native');
  const native=await showPreparedMessage(bridge,groupId,text);
  if(native.status!=='unsupported')return native;
  onProgress('opening');
  let copied={status:'manual'};
  try{copied=await copy;}catch{}
  const opened=await openDialog();
  return {status:opened?'dialog':'link-required',copied:copied?.status==='copied'};
}
