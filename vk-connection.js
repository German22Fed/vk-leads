import {isUsableGroup} from './vk-data.js?v=11.25';

export function errorText(error, secret = '') {
  const data = error?.error_data || error?.error || error?.data || error;
  const nested = data?.error || data;
  const code = nested?.error_code ?? data?.error_code;
  let text = nested?.error_msg || nested?.error_reason || nested?.message || error?.message || 'VK отклонил запрос без описания.';
  if (typeof text !== 'string') text = 'VK отклонил запрос без описания.';
  if (secret) text = text.split(secret).join('[ключ скрыт]');
  text = text.replace(/vk1\.[a-zA-Z0-9_.-]+/g, '[ключ скрыт]');
  return `${code !== undefined ? `Ошибка VK ${code}: ` : ''}${text}`;
}

export function deadline(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
}

export function isVkHost(win = window) {
  const host = String(win.location?.hostname || '').toLowerCase();
  const ua = String(win.navigator?.userAgent || '').toLowerCase();
  const query = new URLSearchParams(win.location?.search || '');
  return win.parent !== win || Boolean(win.vkBridge || win.AndroidBridge || win.webkit?.messageHandlers?.VKWebAppClose || win.webkit?.messageHandlers?.VKWebAppInit || win.ReactNativeWebView) || /(^|\.)vk\.(ru|com)$/.test(host) || /vk(?:androidapp|[_-]ios|webapp)/.test(ua) || Boolean(query.get('vk_app_id') || query.get('vk_platform') || query.get('vk_user_id'));
}

// Host initialization is separate from user authorization and must happen at launch.
export async function startVkLaunch(getBridge, win = window) {
  if (!isVkHost(win)) return {status:'standalone', detail:'Открыт сайт. Для подключения аккаунта откройте Mini App внутри VK.'};
  try {
    await getBridge();
    return {status:'ready', detail:'Запуск внутри VK подтверждён. Доступ к аккаунту подключается отдельно кнопкой «Подключение VK».'};
  } catch (error) {
    return {status:'error', detail:'VK не подтвердил запуск: ' + errorText(error)};
  }
}

export function browserBridge(win = window, doc = document) {
  let ready;
  return () => {
    if (ready) return ready;
    ready = (async () => {
      if (!isVkHost(win)) throw Error('Страница открыта как обычный сайт. Откройте это Mini App внутри VK и подключитесь там.');
      if (!win.vkBridge) await deadline(new Promise((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = new URL('./vk-bridge.min.js', doc.baseURI).href;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(Error('Не удалось загрузить VK Bridge. Обновите Mini App.')); };
        doc.head.append(script);
      }), 12000, 'VK Bridge не загрузился за 12 секунд. Обновите Mini App.');
      const bridge = win.vkBridge;
      if (!bridge?.send) throw Error('VK Bridge недоступен. Обновите приложение.');
      await deadline(bridge.send('VKWebAppInit'), 12000, 'VK не подтвердил запуск за 12 секунд. Откройте Mini App из VK, а не прямую ссылку на сайт.');
      return bridge;
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
}

export class VkConnection {
  constructor({getBridge, onChange = () => {}, timeout = 20000, authTimeout = 60000, delay = 400}) {
    this.getBridge = getBridge; this.onChange = onChange;
    this.timeout = timeout; this.authTimeout = authTimeout; this.delay = delay;
    this.state = {status:'disconnected', detail:'Подключение к VK ещё не выполнено.'};
    this.token = ''; this.bridge = null; this.pending = null;
    this.lastCall = 0; this.queue = Promise.resolve();
  }
  get connected() { return this.state.status === 'connected'; }
  set(status, detail) { this.state = {status, detail, since:Date.now()}; this.onChange(this.state); }
  connect(appId, launchId = 0) {
    if (this.pending) return this.pending;
    this.token = '';
    this.pending = this.performConnect(appId, launchId).finally(() => { this.pending = null; });
    return this.pending;
  }
  async performConnect(appId, launchId) {
    let candidate = '';
    try {
      const suppliedAppId = Number(appId);
      if (Number.isSafeInteger(suppliedAppId) && suppliedAppId > 0 && launchId && Number(launchId) !== suppliedAppId) throw Error(`VK запустил приложение ${launchId}, а в настройках указано ${suppliedAppId}.`);
      this.set('connecting', '1/4 · Проверяем запуск внутри VK…');
      this.bridge = await deadline(this.getBridge(), this.timeout, 'Нет ответа VK Bridge. Откройте приложение внутри VK и повторите подключение.');
      let resolvedAppId = suppliedAppId;
      let bridgeLaunchId = 0;
      if (!(Number.isSafeInteger(resolvedAppId) && resolvedAppId > 0)) {
        try {
          const launch = await deadline(this.bridge.send('VKWebAppGetLaunchParams'), 10000, 'VK не вернул параметры запуска.');
          const params = launch?.params || launch || {};
          bridgeLaunchId = Number(params.vk_app_id || params.app_id || 0);
        } catch {}
      }
      const queryLaunchId = Number(new URLSearchParams(globalThis.location?.search || '').get('vk_app_id') || 0);
      resolvedAppId = Number.isSafeInteger(resolvedAppId) && resolvedAppId > 0 ? resolvedAppId : (bridgeLaunchId || Number(launchId) || queryLaunchId);
      const actualLaunchId = bridgeLaunchId || Number(launchId) || queryLaunchId;
      if (!Number.isSafeInteger(resolvedAppId) || resolvedAppId <= 0) throw Error('VK не передал ID Mini App. Откройте приложение через кнопку «Запустить» в VK.');
      if (actualLaunchId && actualLaunchId !== resolvedAppId) throw Error(`VK запустил приложение ${actualLaunchId}, а в настройках указано ${resolvedAppId}.`);
      appId = resolvedAppId;
      this.set('authorizing', '2/4 · Ожидаем разрешение VK. Подтвердите доступ в окне VK (до 60 секунд).');
      const result = await deadline(this.bridge.send('VKWebAppGetAuthToken', {app_id:appId, scope:'groups,wall'}), this.authTimeout, 'VK не выдал разрешение за 60 секунд. Закройте лишние окна авторизации и повторите.');
      if (!result?.access_token) throw Error('VK не выдал токен доступа. Подключение не выполнено.');
      candidate = result.access_token;
      this.set('checking', '3/4 · Разрешение получено. Проверяем чтение сообщества…');
      const raw = await this.request('groups.getById', {group_ids:'1',fields:'name,deactivated'}, candidate);
      const rows = Array.isArray(raw) ? raw : raw?.groups;
      if (!Array.isArray(rows) || !rows.some(g => g.id === 1 && isUsableGroup(g))) throw Error('VK не вернул полноценное контрольное сообщество. Доступ не подтверждён.');
      this.set('checking', '4/4 · Проверяем доступ к поиску сообществ…');
      let searchAvailable=true;
      try {
        const search = await this.request('groups.search', {q:'дизайн', count:1}, candidate);
        if (!Array.isArray(search?.items)) throw Error('VK вернул неожиданный ответ поиска. Подключение не подтверждено.');
      } catch(error) {
        if(error.code!==15)throw error;
        searchAvailable=false;
      }
      this.token = candidate;
      this.set('connected', searchAvailable?'VK подключён. Чтение сообществ и поиск проверены реальными запросами.':'VK подключён для чтения ID. Поиск по тематикам запрещён VK (ошибка 15). Наблюдение ID доступно; доступ к стенам проверяется отдельно.');
    } catch(error) {
      this.token = '';
      const message = errorText(error, candidate);
      this.set('error', message);
      throw Error(message);
    }
  }
  async request(method, params, token) {
    const task = this.queue.then(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, this.delay-(Date.now()-this.lastCall))));
      this.lastCall = Date.now();
      let result;
      try {
        result = await deadline(this.bridge.send('VKWebAppCallAPIMethod', {method, params:{...params, access_token:token, v:'5.199'}}), this.timeout, `VK не ответил на ${method}. Проверьте соединение и повторите.`);
        if (result?.error) throw result.error;
        if (!result || !Object.hasOwn(result, 'response')) throw Error(`VK вернул некорректный ответ ${method}.`);
      } catch(error) {
        const data = error?.error_data?.error || error?.error_data || error?.error || error;
        const message = `${method}: ${errorText(error, token)}`;
        if (Number(data?.error_code) === 5 && this.connected) {
          this.token = ''; this.set('error', message + ' Подключитесь заново.');
        }
        throw Object.assign(Error(message),{code:Number(data?.error_code)||null});
      }
      return result.response;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  call(method, params) {
    if (!this.connected || !this.token) return Promise.reject(Error('VK не подключён. Нажмите «Подключение VK».'));
    return this.request(method, params, this.token);
  }
}
