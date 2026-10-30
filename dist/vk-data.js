export const cleanGroupName = row => typeof row?.name === 'string' ? row.name.trim() : '';
export const hasGroupName = row => cleanGroupName(row).length > 0;

// VK can return a lightweight placeholder for a removed or unavailable public
// page. It may have no `deactivated` flag and a literal name such as
// "delete", so checking only for a non-empty name would create fake cards.
const deletedNames = new Set([
  'delete', 'deleted', 'removed', 'blocked',
  'удалено', 'удалён', 'удаленная страница', 'удалённая страница',
  'страница удалена', 'сообщество удалено'
]);
export const isDeletedMarker = row => {
  const name = cleanGroupName(row).toLowerCase().replace(/\s+/g, ' ');
  const rawStatus = row?.deactivated;
  const deactivated = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  return (typeof rawStatus === 'string' ? deactivated.length > 0 : rawStatus === true || (Number.isFinite(rawStatus) && rawStatus !== 0)) || deletedNames.has(name);
};
export const isUsableGroup = row => Number.isSafeInteger(row?.id) && !isDeletedMarker(row) && hasGroupName(row);
const unsupportedScripts = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const supportedLetters = /[A-Za-zА-Яа-яЁё]/u;
export const isClientFitName = row => {
  const name = cleanGroupName(row);
  if (!name || unsupportedScripts.test(name)) return false;
  const letters = [...name].filter(ch => /\p{L}/u.test(ch));
  if (letters.length < 2) return false;
  return letters.filter(ch => supportedLetters.test(ch)).length / letters.length >= 0.7;
};
// Broad commercial vocabulary used for the lead feed. It intentionally covers
// local businesses, experts and personal brands while keeping technical,
// gaming and meaningless names out of the sales queue.
const leadMarkers = [
  // Beauty, lashes, nails and body care
  'салон','парикмахер','барбершоп','бьюти','красот','косметолог','косметик','визаж','макияж','бров','ресниц','наращив','ламинирован','маникюр','педикюр','массаж','спа','стилист','эпиляц','депиляц','лазер','солярий','перманент','тату','пирсинг',
  // Furniture, interiors and made-to-order home goods
  'мебел','кухн','шкаф','диван','матрас','кроват','кресл','стол','стул','интерьер','дизайн','декор','текстиль','штор','светильник','мебельный','кухонный','гардероб','корпусн','мягк','мебель на заказ','кухни на заказ',
  // Construction, renovation and installation
  'ремонт','строител','отделк','монтаж','электрик','сантех','окн','двер','потолк','натяжн','кровл','фасад','кирпич','бетон','сварк','кондиционер','вентиляц','клининг','уборк','химчист','утеплен','благоустрой','ландшафт','дизайн-проект',
  // Experts, education and professional services
  'агентство','студия','центр','школа','курс','обучен','репетитор','детск','садик','логопед','дефектолог','психолог','психотерап','коуч','тренер','консульт','юрист','адвокат','нотариус','бухгалтер','аудитор','риэлтор','недвижим','ипотек','маркетинг','реклам','продвижен','таргет','копирайт','дизайнер','фриланс','эксперт','консалтинг','seo',
  // Retail, local shops, automotive and delivery
  'магазин','маркет','бутик','шоурум','одежд','обув','сумк','аксессуар','ювелир','цвет','подар','игруш','канцеляр','книг','техник','электроник','телефон','компьютер','автосервис','автомойк','шиномонтаж','запчаст','такси','прокат','аренд','доставк','пункт выдачи','производств','фабрик','завод','опт','поставщик','дистрибьют',
  // Food and hospitality
  'кафе','ресторан','бар','кофейн','пекар','кондитер','торт','десерт','фастфуд','суши','пицц','шашлык','кейтеринг','ферм','продукт','мясн','сыр','вин','чай','кофе','доставка еды',
  // Sports, events and travel
  'фитнес','спорт','йог','пилатес','танц','хореограф','бассейн','бокс','кроссфит','туризм','путешеств','отель','гостиниц','баз отдыха','экскурс','фотограф','фотостуд','видеограф','свадьб','ведущ','музык','ивент','праздник','организац','прокат авто',
  // Health and care
  'клиник','медицин','стоматолог','врач','здоров','реабилитац','ветеринар','аптек','диагностик','лаборатор','беремен','детокс','нутрициолог','диетолог','роддом','медцентр',
  // Commercial identity signals. These are accepted only when the name has
  // another meaningful word, so a lone “Студия” or “Компания” is rejected.
  'сервис','услуг','мастерская','мастер','проект','команд','компани','бренд','официальн','имя'
];
const leadNoise = [
  'казино','ставк','букмекер','крипт','форекс','трейдинг','инвест','ммм','сетевой','реферал','накрут','подписчик','слив','пробив','хак','чит','бот','парсер','гейм','игр','киберспорт','аниме','мем','фан-клуб','музыкальная группа','паблик мемов','новости','политик','религ','знакомств','чат знакомств','эрот','18+','adult','xxx','vpn','торрент','скачив','продаж аккаунт',
  // Large marketplaces and generic platforms are not individual design leads.
  'ozon','озон','wildberries','вайлдберриз','алиэкспресс','aliexpress','авито','яндекс маркет','сбермаркет','маркетплейс'
];
const shortLeadMarkers = new Set(['бар','spa','seo','имя','опт','тату','йог','сыр','вин','чай','кофе']);
const markerMatches = (name, term) => {
  if (term.includes(' ')) return name.includes(term);
  if (shortLeadMarkers.has(term)) return new RegExp(`(?:^|\\s)${term}(?:$|\\s)`, 'u').test(name);
  return name.includes(term);
};
export const isLeadFitName = row => {
  if (!isClientFitName(row)) return false;
  const name = cleanGroupName(row).toLowerCase();
  if (leadNoise.some(term => name.includes(term))) return false;
  // A name must contain an explicit niche or commercial signal. The old
  // two-word fallback admitted names such as “Мама”, “Ozon” and gibberish.
  const hits = leadMarkers.filter(term => markerMatches(name, term));
  if (!hits.length) return false;
  const genericOnly = hits.every(term => ['агентство','студия','центр','сервис','услуг','мастерская','мастер','проект','команд','компани','бренд','официальн','имя'].includes(term));
  if (genericOnly) {
    const words = name.split(/[^a-zа-яё]+/i).filter(Boolean);
    if (words.length < 2 || words.filter(word => word.length >= 4 && !hits.some(term => word.includes(term))).length < 1) return false;
  }
  return true;
};
export const isClientFitGroup = row => isUsableGroup(row) && isClientFitName(row);
export const isLeadFitGroup = row => isUsableGroup(row) && isLeadFitName(row);
export const isIncompleteGroup = row => !!row && !isDeletedMarker(row) && !hasGroupName(row);

export function groupRows(raw, ids, {allowIncomplete=false} = {}) {
  const rows = Array.isArray(raw) ? raw : raw?.groups;
  if (!Array.isArray(rows)) throw Error('Некорректный ответ groups.getById. Проверка не засчитана.');
  const requested = new Set(ids), found = new Set();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.id) || !requested.has(row.id) || found.has(row.id)) throw Error('Некорректные ID в ответе VK API.');
    if (!allowIncomplete && !isUsableGroup(row)) throw Error('VK API не вернул доступное название сообщества. Проверка не засчитана.');
    found.add(row.id);
  }
  return rows;
}
