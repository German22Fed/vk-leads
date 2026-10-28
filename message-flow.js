import {deadline} from './vk-connection.js?v=11.31';

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
