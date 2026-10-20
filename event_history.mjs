// 週イベント履歴は接続先からだけ読む。公開ファイルには機種名・記号一覧を同梱しない。
const STORE = 'nagamachiminami';
export const HISTORY_TYPES = ['4台構成', '半列', 'バラエティ'];
const name = s => typeof s === 'string' && s.trim().length > 0 && [...s].length <= 300 && !/[\x00-\x1f]/.test(s);
function day(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error('履歴の日付が読めません。');
  const d = new Date(s + 'T00:00:00Z');
  if (s.startsWith('0000-') || !Number.isFinite(+d) || d.toISOString().slice(0,10) !== s) throw Error('履歴の日付が不正です。');
  return +d;
}
// SafariのDate.parseに小数秒の解釈を委ねず、マイクロ秒まで比較する。
const stamp = s => {
  const m = typeof s === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m || +m[2]>23 || +m[3]>59 || +m[4]>59) throw Error('履歴の編集時刻が不正です。');
  let offset=0;
  if(m[6]!=='Z'){
    const h=+m[6].slice(1,3), n=+m[6].slice(4,6);
    if(h>23 || n>59) throw Error('履歴の時差が不正です。');
    offset=(h*60+n)*(m[6][0]==='+'?1:-1);
  }
  return BigInt(day(m[1])+(+m[2]*3600 + +m[3]*60 + +m[4]-offset*60)*1000)*1000n + BigInt((m[5]??'').padEnd(6,'0'));
};
const machine = (m, symbols, results = true) => {
  if (!m || !name(m.name) || !Number.isInteger(m.count) || m.count < 1 || m.count > 9999 || (m.record_name != null && !name(m.record_name))) throw Error('履歴の機種情報が読めません。');
  if (results && (!Array.isArray(m.results) || m.results.length !== 7 || m.results.some(v => typeof v !== 'string' || (v !== '' && !symbols.includes(v))))) throw Error('履歴の記号が不正です。');
  return {name:m.name, count:m.count, record_name:m.record_name ?? null, results:results ? [...m.results] : Array(7).fill('')};
};
export const historyDay = (first, i) => new Date(day(first) + i * 86400000).toISOString().slice(0,10);
export function parsePrivateHistory(doc) {
  if (!doc || doc.format !== 'database-event-history' || doc.version !== 1) throw Error('履歴の形式が違います。');
  const base = doc.base;
  if (!base) throw Error('履歴の反映には、PCで共有用ファイルの更新とApps Scriptの更新が必要です。');
  if (base.version !== 2 || base.store !== STORE || !Array.isArray(base.symbols) || !base.symbols.length ||
      base.symbols.some(v => !name(v) || [...v].length > 16) || new Set(base.symbols).size !== base.symbols.length || !Array.isArray(base.weeks)) throw Error('履歴の基準が読めません。');
  if (base.user_blank_days != null && !Array.isArray(base.user_blank_days)) throw Error('空欄の日付が不正です。');
  for (const d of base.user_blank_days ?? []) day(d);
  const weeks = new Map(), occupied = new Map();
  for (const w of base.weeks) {
    if (!w || !HISTORY_TYPES.includes(w.type) || new Date(day(w.from)).getUTCDay() !== 1 || day(w.to) - day(w.from) !== 6 * 86400000 || occupied.has(w.from) || !Array.isArray(w.machines)) throw Error('履歴の週が重複または不正です。');
    const machines = w.machines.map(m => machine(m, base.symbols));
    if (new Set(machines.map(m => m.name)).size !== machines.length) throw Error('機種名が重複しています。');
    weeks.set(`${w.type}|${w.from}`, {...w, machines}); occupied.set(w.from, w.type);
  }
  for (const key of ['weeks','cells','links']) if (Object.hasOwn(doc,key) && (!Array.isArray(doc[key]) || doc[key].length > 30000)) throw Error('履歴編集の形式が違います。');
  const latest = (items, key) => {
    const values = new Map();
    for (const c of items) {
      const k = key(c), old = values.get(k);
      if (!old || stamp(c.updated_at) >= stamp(old.updated_at)) values.set(k,c);
    }
    return [...values.values()];
  };
  let rejected = Number.isInteger(doc.rejected) && doc.rejected>0 ? doc.rejected : 0;
  const definitions=[];
  for(const w of doc.weeks??[]) {
    try {
      if (!w || w.store !== STORE || w.type !== 'バラエティ' || new Date(day(w.week)).getUTCDay() !== 1 || day(w.lineup_day) < day(w.week) || day(w.lineup_day) > day(w.week) + 6*86400000 || !Array.isArray(w.machines) || (Object.hasOwn(w,'removed') && typeof w.removed !== 'boolean') || (occupied.get(w.week) ?? 'バラエティ') !== 'バラエティ') throw Error();
      stamp(w.updated_at);
      const machines=w.machines.map(m=>machine(m,base.symbols,false));
      if (!machines.length || machines.some(m=>m.count>3) || new Set(machines.map(m=>m.name)).size!==machines.length) throw Error();
      definitions.push({...w,machines}); occupied.set(w.week,w.type);
    } catch { rejected++; }
  }
  for(const w of latest(definitions,w=>`${w.type}|${w.week}`))
    weeks.set(`${w.type}|${w.week}`,{type:w.type,from:w.week,to:historyDay(w.week,6),lineup_day:w.lineup_day,machines:w.machines,removed:w.removed});
  const names=new Set([...weeks.values()].flatMap(w=>w.machines.map(m=>m.name)));
  for (const group of ['links','cells']) {
    const valid = [];
    for (const c of doc[group] ?? []) {
      try {
        if (!c || c.store !== STORE || !name(c.machine)) throw Error();
        stamp(c.updated_at);
        const scoped=group==='cells' || Object.hasOwn(c,'week') || Object.hasOwn(c,'type');
        if(scoped) {
          if(!HISTORY_TYPES.includes(c.type)) throw Error();
          day(c.week);
          const w=weeks.get(`${c.type}|${c.week}`);
          if(!w || !w.machines.some(m=>m.name===c.machine)) throw Error();
        } else if(!names.has(c.machine)) throw Error();
        if (group === 'cells' && (day(c.day) < day(c.week) || day(c.day) > day(c.week) + 6*86400000 || typeof c.value !== 'string' || (c.value !== '' && !base.symbols.includes(c.value)))) throw Error();
        if (group === 'links' && c.record_name != null && !name(c.record_name)) throw Error();
        valid.push(c);
      } catch { rejected++; }
    }
    const entries=latest(valid,c=>JSON.stringify([c.type??'',c.week??'',c.machine,...(group==='cells'?[c.day]:[])]));
    // 機種共通の対応を適用してから、週ごとの対応で上書きする。
    entries.sort((a,b)=>Number(Object.hasOwn(a,'week'))-Number(Object.hasOwn(b,'week')));
    for(const c of entries) {
      const targets=Object.hasOwn(c,'week')?[weeks.get(`${c.type}|${c.week}`)]:weeks.values();
      for(const w of targets) {
        const m=w.machines.find(m=>m.name===c.machine); if(!m) continue;
        if(group==='links') m.record_name=c.record_name??null;
        else m.results[(day(c.day)-day(c.week))/86400000]=c.value;
      }
    }
  }
  return {store:STORE, symbols:[...base.symbols], weeks:[...weeks.values()].filter(w => !w.removed).sort((a,b) => b.from.localeCompare(a.from)), rejected};
}
export function historySavedName(m, names) {
  if (m.record_name != null) return names.has(m.record_name) ? m.record_name : null;
  const normalized = s => String(s).replaceAll('+',' ').replace(/\s+/g,' ').trim();
  const hits = [...names].filter(n => normalized(n) === normalized(m.name));
  return hits.length === 1 ? hits[0] : null;
}

export const historyEditKey = c => JSON.stringify([c.store,c.type,c.week,c.machine,c.day]);

/** 共有では既存の週・機種の結果記号だけを変更できる。 */
export function historyCell(raw, model) {
  if (!raw || raw.store !== STORE || !HISTORY_TYPES.includes(raw.type) || !name(raw.machine) ||
      typeof raw.value !== 'string' || !['',...model.symbols].includes(raw.value)) throw Error('履歴の記号が不正です。');
  const w = model.weeks.find(w=>w.type===raw.type && w.from===raw.week);
  if (!w || !w.machines.some(m=>m.name===raw.machine) || day(raw.day)<day(w.from) || day(raw.day)>day(w.to))
    throw Error('対象の週・機種・日付が履歴にありません。');
  stamp(raw.updated_at);
  return {store:STORE,type:raw.type,week:raw.week,machine:raw.machine,day:raw.day,value:raw.value,
    updated_at:raw.updated_at,device:['pc','android','shared'].includes(raw.device)?raw.device:'pc'};
}

/** PCの文書は書き換えず、記号の編集時刻が新しい方を重ねる。不正な原文は残す。 */
export function mergeHistoryCells(doc, incoming, {strict=true}={}) {
  if (!Array.isArray(incoming) || incoming.length>30000) throw Error('履歴の件数が不正です。');
  const model=parsePrivateHistory(doc), entries=new Map(), orphans=[];
  for (const [items,check] of [[doc.cells??[],false],[incoming,strict]]) for (const raw of items) {
    try {
      const c=historyCell(raw,model), k=historyEditKey(c), old=entries.get(k);
      if (!old || stamp(c.updated_at)>=stamp(old.updated_at)) entries.set(k,c);
    } catch (e) { if(check) throw e; orphans.push(raw); }
  }
  const cells=[...entries.values(),...orphans];
  if(cells.length>30000) throw Error('履歴の保存件数の上限に達しています。');
  return {...doc,cells};
}

export function newHistoryCell(doc, fields, value, now=Date.now()) {
  let time=BigInt(Math.trunc(now))*1000n;
  for(const c of doc.cells??[]) {
    if(c && historyEditKey(c)===historyEditKey({...fields,store:STORE})) {
      try { if(stamp(c.updated_at)>=time) time=stamp(c.updated_at)+1000n; } catch { /* 原文は残す。 */ }
    }
  }
  const updated_at=new Date(Number(time/1000n)).toISOString().replace(/\d{3}Z$/,String(time%1000000n).padStart(6,'0')+'Z');
  return historyCell({...fields,store:STORE,value,updated_at,device:'shared'},parsePrivateHistory(doc));
}
