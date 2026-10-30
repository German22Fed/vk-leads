import { normalizeGroup } from './core.js';
import { groupRows, isIncompleteGroup, isUsableGroup, isClientFitGroup } from './vk-data.js?v=11.36';

const DAY = 86400000;
export const moscowDay = at => new Date(at + 10800000).toISOString().slice(0, 10);
export function initialState() {
  return { version: 1, config: null, records: {}, runs: [], controls: [], cycles: 0 };
}
export function configFor(input) {
  const startId = Number(input.startId), width = Number(input.width), intervalSeconds = Number(input.intervalSeconds);
  if (!Number.isSafeInteger(startId) || startId < 1 || startId > 2147480000) throw Error('Начальный ID: целое число от 1 до 2147480000.');
  if (!Number.isInteger(width) || width < 100 || width > 2000 || startId + width > 2147483647) throw Error('Размер диапазона: от 100 до 2000 ID.');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3600) throw Error('Интервал: от 60 до 3600 секунд.');
  return { startId, width, intervalSeconds, advance: input.advance === true };
}
export function recordBatch(state, ids, rows, at, startedAt = at) {
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if(row && !isClientFitGroup(row)) {
      // An incomplete return interrupts absence evidence. Do not create an
      // observation or infer allocation/creation from this placeholder.
      const previous=state.records[id];
      if(previous){previous.available=false;previous.missingChecks=0;previous.events.push({kind:'incomplete',at});previous.events=previous.events.slice(-12);}
      continue;
    }
    const rec = state.records[id] ??= { id, firstChecked: startedAt, checks: 0, missingChecks: 0, events: [] };
    rec.checks++; rec.lastChecked = at;
    // A returned deactivated community has already existed. It cannot become a new-ID candidate later.
    const returned = !!row;
    if (returned && !rec.everReturned) {
      rec.everReturned = true;
      rec.firstReturned = at;
      rec.appearance = rec.missingChecks >= 2 && !row.deactivated
        ? { kind: 'candidate', from: rec.lastMissingStarted, to: at, missingChecks: rec.missingChecks }
        : { kind: 'baseline', at };
      rec.events.push({ kind: row.deactivated ? 'deactivated' : 'returned', at });
    }
    if (row && !row.deactivated) {
      const normalized = normalizeGroup(row);
      rec.group = { ...rec.group, ...normalized, verifiedAt: at, verification: 'groups.getById', posts: rec.group?.posts ?? null, wallUnavailable: rec.group?.wallUnavailable ?? true, firstSeen: rec.group?.firstSeen ?? at, source: 'Сборщик ID · VK API', status: 'new' };
      rec.available = true;
    } else {
      rec.available = false;
      if (!returned) {
        if (!rec.missingChecks) rec.events.push({ kind: 'not_returned', at });
        rec.missingChecks++; rec.lastMissingStarted = startedAt; rec.lastMissing = at;
      }
    }
    rec.events = rec.events.slice(-12);
  }
}
export function verdict(rec, now = Date.now()) {
  if (!rec.appearance || rec.appearance.kind !== 'candidate') return 'baseline';
  if (rec.oldestObservedPost && rec.oldestObservedPost < rec.appearance.from) return 'older';
  if (moscowDay(rec.appearance.from) === moscowDay(now) && moscowDay(rec.appearance.to) === moscowDay(now)) return 'candidate_today';
  return 'candidate_other_day';
}
export function publicRecord(rec, now) {
  return { ...rec.group, id: rec.id, available: rec.available, observation: {
    verdict: verdict(rec, now), appearance: rec.appearance, checks: rec.checks,
    firstChecked: rec.firstChecked, lastChecked: rec.lastChecked,
    missingChecks: rec.missingChecks, oldestObservedPost: rec.oldestObservedPost ?? null,
    wallCheckedAt: rec.wallCheckedAt ?? null, wallError: rec.wallError ?? null,
    events: rec.events
  }};
}
export class Collector {
  constructor({ storage, api, clock = Date.now, maxRecords = Infinity }) {
    this.storage = storage; this.maxRecords = maxRecords; this.api = api; this.clock = clock;
    this.state = initialState(); this.busy = false; this.running = false;
    this.timer = null; this.message = 'Сборщик остановлен'; this.progress = null;
  }
  async load() {
    try {
      const data = await this.storage.load();
      if (!data) return;
      if (data.version !== 1 || !data.records || !Array.isArray(data.runs) || !Array.isArray(data.controls)) throw Error('Повреждена база сборщика.');
      this.state = data;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async save() {
    await this.storage.save(this.state);
  }
  async configure(input) {
    if (this.busy || this.running) throw Error('Остановите сборщик перед изменением диапазона.');
    this.state.config = configFor(input); await this.save();
  }
  idsForCycle() {
    const c = this.state.config;
    const ids = new Set(Array.from({ length: c.width }, (_, i) => c.startId + i));
    // Revisit recent gaps behind a moving window. New window IDs always receive a baseline first.
    const pending = Object.values(this.state.records).filter(r => !r.everReturned && this.clock() - r.firstChecked < DAY && !ids.has(r.id)).sort((a,b) => a.lastChecked-b.lastChecked);
    for (const rec of pending.slice(0, 500)) ids.add(rec.id);
    return [...ids];
  }
  async inspectWall(rec) {
    try {
      const first = await this.api('wall.get', { owner_id: -rec.id, count: 5, filter: 'all' });
      if (!Number.isInteger(first?.count) || first.count < 0 || !Array.isArray(first.items)) throw Error('Некорректный ответ стены.');
      let items = first.items;
      if (first.count > 5) {
        const tail = await this.api('wall.get', { owner_id: -rec.id, count: 5, offset: Math.max(0, first.count - 5), filter: 'all' });
        if (!Array.isArray(tail?.items)) throw Error('Некорректный ответ стены.');
        items = [...items, ...tail.items];
      }
      // Only a direct original wall post proves prior existence. Repost source dates do not.
      const dates = items.filter(p => p.owner_id === -rec.id && Number.isFinite(p.date) && p.date > 0 && p.date*1000 <= this.clock()).map(p => p.date*1000);
      if (dates.length) rec.oldestObservedPost = Math.min(rec.oldestObservedPost ?? Infinity, ...dates);
      rec.group.posts = first.count; rec.group.wallUnavailable = false;
      rec.group.latestPost = first.items.filter(p => Number.isFinite(p.date)).reduce((m,p)=>Math.max(m,p.date),0) || null;
      rec.wallCheckedAt = this.clock(); rec.wallError = null;
    } catch (e) { rec.wallError = e.message; }
  }
  async cycle() {
    if (this.busy) throw Error('Проверка уже выполняется.');
    if (!this.state.config) throw Error('Сначала сохраните диапазон ID.');
    this.busy = true; this.cancelled = false;
    const run = { startedAt: this.clock(), checked: 0, incomplete: 0, status: 'running' };
    try {
      const ids = this.idsForCycle();
      if (new Set([...Object.keys(this.state.records).map(Number), ...ids]).size > this.maxRecords) throw Error('Достигнут лимит истории на этом устройстве. Экспортируйте журнал и начните новое наблюдение.');
      for (let offset = 0; offset < ids.length && !this.cancelled; offset += 99) {
        const batch = ids.slice(offset, offset + 99), started = this.clock();
        // Include an accessible control ID so an empty / restricted response is not
        // mistaken for a whole batch of communities that did not yet exist.
        const requested = [...new Set([1, ...batch])];
        this.progress = `Проверка ID: ${offset} / ${ids.length}`;
        const raw = await this.api('groups.getById', { group_ids: requested.join(','), fields: 'name,deactivated,members_count,city,activity,description,has_photo,cover,can_message' });
        const rows = groupRows(raw, requested, {allowIncomplete:true});
        if (!rows.some(r=>r.id===1 && isUsableGroup(r))) throw Error('VK API не вернул полноценное контрольное сообщество ID 1. Отсутствие остальных ID не засчитано.');
        run.incomplete+=rows.filter(isIncompleteGroup).length;
        recordBatch(this.state, batch, rows.filter(r=>batch.includes(r.id)), this.clock(), started);
        run.checked += batch.length;
        await this.save();
      }
      const pending = Object.values(this.state.records).filter(r=>r.group && r.available && (!r.wallCheckedAt || this.clock()-r.wallCheckedAt > 3600000)).sort((a,b)=>(a.appearance?.kind==='candidate'?-1:0)-(b.appearance?.kind==='candidate'?-1:0) || (a.wallCheckedAt||0)-(b.wallCheckedAt||0));
      // Bound wall reads per cycle; remaining rows are visibly marked as unchecked.
      for (const rec of pending.slice(0, 20)) {
        if (this.cancelled) break;
        this.progress = `Проверка публикаций: club${rec.id}`;
        await this.inspectWall(rec);
      }
      if (!this.cancelled) {
        this.state.cycles++;
        const c = this.state.config;
        if (c.advance) {
          const seen = ids.filter(id=>this.state.records[id]?.everReturned);
          const max = seen.length ? Math.max(...seen) : 0;
          if (max >= c.startId + c.width/2) c.startId = Math.min(max + 1, 2147483647-c.width);
        }
      }
      run.status = this.cancelled ? 'stopped' : 'ok';
      this.message = this.cancelled ? 'Остановлено; выполненные проверки сохранены' : 'Проверка завершена. Дата создания по ID не подтверждается.';
      if(run.incomplete)this.message+=` Без данных: ${run.incomplete} ID. Они не засчитаны как отсутствующие.`;
    } catch (e) {
      run.status = 'error'; run.error = e.message; this.message = e.message;
      this.running = false;
    } finally {
      run.finishedAt = this.clock();
      this.state.runs.unshift(run); this.state.runs = this.state.runs.slice(0, 100);
      try { await this.save(); } finally { this.busy = false; this.progress = null; }
    }
    return run;
  }
  start({immediate=true}={}) {
    if (!this.state.config) throw Error('Сначала сохраните диапазон ID.');
    if (this.busy || this.running) throw Error('Сборщик уже запущен.');
    this.running = true;
    const tick = async () => {
      try { await this.cycle(); } catch (e) { this.message = e.message; this.running = false; }
      if (this.running) this.timer = setTimeout(tick, this.state.config.intervalSeconds*1000);
    };
    if(immediate)void tick();
    else this.timer=setTimeout(tick,this.state.config.intervalSeconds*1000);
  }
  stop() { this.running = false; this.cancelled = true; clearTimeout(this.timer); }
  async addControl({ id, createdAt, note }) {
    if (this.busy) throw Error('Дождитесь окончания текущей проверки.');
    id = Number(id); const at = Date.parse(createdAt);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(at) || at > this.clock() || !String(note||'').trim()) throw Error('Укажите ID, реальное время создания и описание подтверждения.');
    this.state.controls = this.state.controls.filter(c=>c.id!==id);
    this.state.controls.push({id, createdAt:at, note:String(note).slice(0,1000), recordedAt:this.clock(), source:'user_report'});
    await this.save();
  }
  snapshot() {
    const now = this.clock(), records = Object.values(this.state.records), groups = records.filter(r=>r.group).map(r=>publicRecord(r,now));
    const controls = this.state.controls.map(c=>{
      const r = this.state.records[c.id], a=r?.appearance;
      let result='not_observed';
      if (r?.everReturned) result = a?.kind==='candidate' ? (c.createdAt>=a.from && c.createdAt<=a.to ? 'consistent' : 'contradiction') : 'no_prior_observation';
      return {...c,result,appearance:a??null};
    });
    return {running:this.running,busy:this.busy,message:this.message,progress:this.progress,config:this.state.config,cycles:this.state.cycles,
      checkedIds:records.length, unavailable:records.filter(r=>!r.available).length, groups, runs:this.state.runs,controls,
      evidence:{confirmedCreationDates:0,candidatesToday:groups.filter(g=>g.available&&g.observation.verdict==='candidate_today').length,older:groups.filter(g=>g.observation.verdict==='older').length,controlContradictions:controls.filter(c=>c.result==='contradiction').length}};
  }
}
