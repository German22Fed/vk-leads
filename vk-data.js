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
export const isClientFitGroup = row => isUsableGroup(row) && isClientFitName(row);
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
