const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Users often paste the complete `access_token=...` value copied from a URL or
// wrap the token in quotes. VK accepts only the raw value, so normalize those
// harmless wrappers before validation while still rejecting embedded whitespace.
export function normalizeAccessToken(value) {
  let token = String(value ?? '').trim();
  token = token.replace(/^['"]|['"]$/g, '');
  const match = token.match(/^(?:access_token|token)=([^&\s]+)$/i);
  return (match ? match[1] : token).trim();
}

export class VkError extends Error {
  constructor(code, message = '', method = '') {
    const hints = {
      5: 'Ключ недействителен или истёк. Создайте новый ключ доступа VK и вставьте его полностью без пробелов.',
      15: 'VK запретил этому ключу вызов метода. Это не означает, что ключ неверный. Для поиска попробуйте пользовательскую авторизацию через «Подключение VK» внутри Mini App; доступ проверяется отдельно.',
      27: 'VK отклонил авторизацию сообщества. Проверьте тип и действительность ключа. Для сборщика используется ключ приложения, а для входа в Mini App — кнопка «Подключение VK».'
    };
    const detail = String(message || '').replace(/\s+/g, ' ').trim();
    super(`VK API: ошибка ${code}${detail ? ` — ${detail}` : ''}${method ? ` (${method})` : ''}. ${hints[code] || 'Проверьте ключ и доступ к методу.'}`);
    this.code = code; this.method = method;
  }
}
// Fixed upstream and redacted errors: credentials never enter URLs, logs or exports.
export function vkClient({ getToken, fetchImpl = fetch, delay = 450 }) {
  let queue = Promise.resolve(), last = 0;
  return (method, params = {}) => {
    const call = queue.then(async () => {
      const token = getToken();
      if (!token) throw Error('Нужен ключ VK API. Подключите его в панели сборщика.');
      await pause(Math.max(0, delay - (Date.now() - last)));
      last = Date.now();
      let response, data;
      try {
        response = await fetchImpl(`https://api.vk.com/method/${method}`, {
          method: 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
          body: new URLSearchParams({ ...params, access_token: token, v: '5.199' })
        });
        if (!response.ok) throw Error();
        data = await response.json();
      } catch { throw Error('VK API недоступен: ошибка соединения или ответа. Проверка не засчитана.'); }
      if (data.error) {
        const message = String(data.error.error_msg || '').replace(token, '[ключ скрыт]');
        throw new VkError(Number(data.error.error_code) || 'unknown', message, method);
      }
      if (!Object.hasOwn(data, 'response')) throw Error('VK API вернул неизвестный формат. Проверка не засчитана.');
      return data.response;
    });
    queue = call.catch(() => {});
    return call;
  };
}

export {groupRows} from '../dist/vk-data.js';
