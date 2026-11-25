export const cleanGroupName = row => typeof row?.name === 'string' ? row.name.trim() : '';
export const hasGroupName = row => cleanGroupName(row).length > 0;

// Text screening is shared by the collector and the UI. It deliberately does
// not claim to classify photos/videos, or treat a medical topic as pornography.
export const CONTENT_FILTER_VERSION = 1;
const normalizeContent = text => String(text || '').normalize('NFKC').toLowerCase()
  .replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/ё/g, 'е');
const adultPatterns = [
  /порн|эрот|хентай|хент(?:а|э)й|порнуха|онлифанс|онлифа(?:н|нс)/u,
  /(?:^|[^\p{L}])(?:porn\w*|erotic\w*|adult|hentai|xxx|nsfw|onlyfans|xvideos|pornhub|xhamster|redtube)(?=$|[^\p{L}])/u,
  /(?:^|[^\p{L}])(?:секс(?:а|ом)?|sex)(?=$|[^\p{L}])|(?:секс|sex)[_-]?(?:видео|video|chat|чат|услуг|знакомств|фото|онлайн|online|шоп|shop)/u,
  /интим[\s_-]*(?:услуг|знакомств|массаж|встреч|фото|видео)|эскорт|проститут|нюдс|обнажен|голые\s+(?:девуш|женщ|парн)|слив[ыа]?\s+(?:девуш|интим|модел)|вебкам|webcam\s*(?:model|girl|sex)/u,
  /(?:^|[^\p{L}])(?:bdsm|бдсм|разврат|похоть|фетиш)(?=$|[^\p{L}])/u
];
export function hasAdultText(text) {
  const value = normalizeContent(text)
    .replace(/сексолог[а-я]*|сексопатолог[а-я]*|сексуальн[а-я]*\s+(?:здоров[а-я]*|образован[а-я]*)/gu, '');
  if(adultPatterns.some(pattern => pattern.test(value)))return true;
  // Common mixed alphabet and spaced spellings, with boundaries to avoid
  // matching fragments in normal business names.
  return /(?:^|[^\p{L}])(?:[пn]\W*[оo0]\W*[рp]\W*[нh]\W*[оo0]|p\W*[оo0]\W*r\W*n|[эe]\W*[рp]\W*[оo0]\W*[тt])(?=$|[^\p{L}])/u.test(value);
}
const adultCache=new WeakMap();
export function isAdultGroup(row) {
  if(!row||typeof row!=='object')return false;
  const values=[row.name,row.description,row.activity,row.category,row.status_text,row.contentSafety?.blocked];
  const cached=adultCache.get(row);
  if(cached&&values.every((v,i)=>v===cached.values[i]))return cached.result;
  const result=row.contentSafety?.blocked===true||values.slice(0,5).some(hasAdultText);
  adultCache.set(row,{values,result});return result;
}
export function inspectContent(row, items = []) {
  const texts=[];
  const visit=(post,depth=0)=>{
    if(!post||depth>2)return;
    texts.push(post.text);
    for(const a of post.attachments||[]) {
      const media=a[a.type];texts.push(media?.title,media?.description,media?.text);
    }
    for(const original of post.copy_history||[])visit(original,depth+1);
  };
  items.forEach(post=>visit(post));
  const metadata=[row?.name,row?.description,row?.activity,row?.category].some(hasAdultText);
  const posts=texts.some(hasAdultText);
  return {version:CONTENT_FILTER_VERSION,blocked:metadata||posts,reason:metadata?'adult_metadata':posts?'adult_posts':null};
}

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
  'реснич','ресенниц','лешмейкер','лэшмейкер','lash','nails','ногт','нейл','шугаринг','колорист','кератин','ботокс волос','афрокос','косоплет','трихолог','брадобрей',
  'мыловар','свечи','аромасвеч','керамик','гончар','ювелир','бижутер','handmade','hand made','хендмейд','хэндмейд','швея','вышивк','подарочные наборы',
  'автокондиционер','автостекл','автозвук','кузовной','диагностика авто','ремонт обуви','ремонт часов','ремонт телефонов','чистка ковров','дезинсекц','дезинфекц','прачеч','заточка',
  'садовник','саженц','рассад','питомник растений','теплиц','газон','брусчат','тротуарн','земляные работы','спецтехник','вывоз мусора','алмазное бурение',
  'психиатр','нейропсихолог','арт-терап','семейный психолог','медиатор','страхован','оценщик','кадастр','геодез','сертификац','таможенн','логист','сметчик','архитектор',
  'печенье','пряник','зефир','чизкейк','бенто','капкейк','шоколад','пастила','полуфабрикат','пельмен','вареник','рыбный магазин','сухофрукт','орехи','мед на заказ',
  'студия растяжки','стретчинг','аквааэробик','студия вокала','уроки гитары','уроки фортепиано','уроки рисования','художественная студия','школа вокала','школа танцев',
  // Additional specific services and common English business names.
  'груминг','зоосалон','зоомагазин','передержк','кинолог','автоэлектрик','автоподбор','детейлинг','детейлинг-центр','эвакуатор','автошкол','тонировк','полировк','грузоперевоз','грузчик','переезд','ателье','пошив','вязание на заказ','гравировк','типограф','полиграф','флорист','букет','шарик','аэродизайн','баня','сауна','глэмпинг','кемпинг','печи','забор','ворота','роллет','жалюзи','бурение','скважин','септик','каменщик','плиточник','муж на час','печать','оцифровк','реставрац','перетяжк','обивк','подиатр','подолог','нутрициолог','остеопат','йога','студия вокала','школа музыки','музыкальная школа','beauty','nail','lashes','brow','barbershop','salon','bakery','florist','furniture','cleaning','detailing','photography','tattoo',
  // Beauty, lashes, nails and body care
  'салон','парикмахер','барбершоп','бьюти','красот','косметолог','косметик','визаж','макияж','бров','ресниц','наращив','ламинирован','маникюр','педикюр','массаж','спа','стилист','эпиляц','депиляц','лазер','солярий','перманент','тату','пирсинг',
  // Furniture, interiors and made-to-order home goods
  'мебел','кухн','шкаф','диван','матрас','кроват','кресл','стол','стул','интерьер','дизайн','декор','текстиль','штор','светильник','мебельный','кухонный','гардероб','корпусн','мягк','мебель на заказ','кухни на заказ',
  // Construction, renovation and installation
  'ремонт','строител','отделк','отделоч','монтаж','электрик','сантех','окн','двер','потолк','натяжн','кровл','фасад','кирпич','бетон','сварк','кондиционер','вентиляц','клининг','уборк','химчист','утеплен','благоустрой','ландшафт','дизайн-проект',
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
  // Non-commercial projects and competitor/creator communities are not
  // outreach leads for a design studio.
  'православ','подростк','декрет','нейрокоррекц','нейро','креатор','creator','ai','искусствен','лагер','летний лагерь','квн','техникум','университет','институт','вуз','гбдоу','детский сад','родитель','семья читает','фан-клуб','сообщество дизайнер','сообщество дизайнеров',
  // Hobby, editorial and generic public pages are not paid-service leads.
  'книжн','читател','читаю','ведическ','некоммерч','волшебств','музык','танцевальн коллектив','клуб любител','официальная группа','дневник','орнитолог','спасен','птиц','кошк',
  // Large marketplaces and generic platforms are not individual design leads.
  'ozon','озон','wildberries','вайлдберриз','алиэкспресс','aliexpress','авито','яндекс маркет','сбермаркет','маркетплейс'
];
const shortLeadMarkers = new Set(['бар','spa','спа','seo','имя','опт','стол','тату','йог','сыр','вин','чай','кофе']);
const genericLeadNames = new Set([
  'спорт','музыка','свадьба','бар','стол','магазин','маркет','центр','студия','сервис','услуги','мастер','проект','команда','компания',
  'подарки','туризм','путешествия','цветы','техника','обувь','одежда','здоровье','организация','организации','союз организаций'
]);
const markerPatterns = new Map();
const markerMatches = (name, term) => {
  if (term.includes(' ')) return name.includes(term);
  if(!markerPatterns.has(term))markerPatterns.set(term,shortLeadMarkers.has(term)
    ?new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}(?=$|[^\\p{L}\\p{N}])`, 'u')
    :new RegExp(`(?:^|[^\\p{L}\\p{N}])${term}`, 'u'));
  // A commercial stem starts a word: матизаводов is not a завод, and
  // an incidental substring inside a personal name is not a niche.
  return markerPatterns.get(term).test(name);
};
const ambiguousNoise={
  'бот':'бот(?:ы|ов|а|у|ом|ами|ах)?',
  'чит':'чит(?:ы|ов|ами|ах|ер[а-яё]*)?',
  'слив':'слив(?:ы|ов|а|у|ом|ами|ах)?',
  'мем':'мем(?:ы|ов|а|у|ом|ами|ах|чик[а-яё]*)?'
};
const noisePatterns=new Map();
const noiseMatches=(name,term)=>{
  if(noisePatterns.has(term))return noisePatterns.get(term).test(name);
  const pattern=ambiguousNoise[term];
  const regex=pattern?new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`,'u'):
  // Match a word/phrase prefix, not characters inside доставка, работы, Тигр.
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`,'u');
  noisePatterns.set(term,regex);return regex.test(name);
};
export const isLeadFitName = row => {
  if (!isClientFitName(row) || isAdultGroup(row)) return false;
  const name = cleanGroupName(row).toLowerCase();
  if(/^(?:сладкая\s+)?(?:шоколадка|зефирка|вареник|пельмень|капкейк|пряник)$/u.test(name))return false;
  if(/(?:тебя|тебе|твой|для тебя).*(?:подарок|сюрприз)|(?:подарок|сюрприз).*(?:ждет|ждёт|приберегли)|выживание\s+\d+\s+дней|школьный\s+медиа\s*центр|^вкр\s*\d/u.test(name))return false;
  const commercialMusic=/музыкальн[а-я]*\s+школ|школ[а-я]*\s+музык/u.test(name);
  const petService=/груминг|зоосалон|ветеринар|передержк|зоомагазин/u.test(name);
  const exceptions=new Set();
  if(commercialMusic)exceptions.add('музык');
  if(petService){exceptions.add('кошк');exceptions.add('птиц');}
  if(/книжн[а-я]*\s+(?:магазин|лавк)|магазин\s+книг/u.test(name))exceptions.add('книжн');
  if(/нейропсихолог|нейрологопед/u.test(name))exceptions.add('нейро');
  if(/магазин.{0,30}игруш|игруш[а-я]*.{0,30}(?:магазин|на заказ)/u.test(name))exceptions.add('игр');
  if(/частн[а-я]*\s+детский сад/u.test(name))exceptions.add('детский сад');
  if (leadNoise.some(term => !exceptions.has(term) && noiseMatches(name,term))) return false;
  const compactName = name.replace(/[«»"'“”]/g, '').replace(/\s+/g, ' ').trim();
  if (genericLeadNames.has(compactName)) return false;
  // VK's frontier can return concatenated placeholder-like names. Keep
  // genuine one-word brands and short service names, but reject long runs of
  // letters with no separators (for example магазинпродажиинструментов).
  if (/^[\p{L}\d]+$/u.test(compactName) && compactName.length > 20) return false;
  if (/(?:работа|заработок)\s+(?:с\s+телефона|на\s+дому|без\s+вложений)|пассивный\s+доход|(?:клуб|группа)\s+любителей\s+(?:фотограф|музык|путешеств)/u.test(name)) return false;
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
export function businessDescriptionMatch(row){
  const name=cleanGroupName(row).toLowerCase();
  if(!isClientFitName(row)||isAdultGroup(row)||name.length>100||/^(мама|папа|брат|сестра|семья|тест|test|привет)$/u.test(name)||leadNoise.some(term=>noiseMatches(name,term)))return false;
  const letters=name.replace(/[^a-zа-яё]/gu,'');
  if(letters.length<3||!/[аеёиоуыэюяaeiouy]/u.test(letters)||/(.)\1{3}/u.test(letters))return false;
  const description=String(row.description||'').toLowerCase().slice(0,5000);
  // A brand/name alone is insufficient. Require a concrete service and an
  // explicit commercial offer, not simply VK's broad activity category.
  return /маникюр|педикюр|ресниц|бров|парикмахер|косметолог|психолог|репетитор|мебел|кухни на заказ|клининг|торты на заказ|ремонт|пошив|груминг|фотосесс|флорист/u.test(description)&&
    /(?:^|[^\p{L}])(?:запис[ьи]|записаться|заказ|стоимость|прайс|цены|руб(?:\W|$)|₽|оказыва[ею]|услуги|доставка)/u.test(description);
}
const leadCache=new WeakMap();
export const isLeadFitGroup = row => {
  if(!row||typeof row!=='object')return false;
  const values=[row.id,row.name,row.deactivated,row.description,row.activity,row.category,row.status_text,row.contentSafety?.blocked];
  const cached=leadCache.get(row);
  if(cached&&values.every((v,i)=>v===cached.values[i]))return cached.result;
  const result=isUsableGroup(row)&&(isLeadFitName(row)||businessDescriptionMatch(row));
  leadCache.set(row,{values,result});return result;
};
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

