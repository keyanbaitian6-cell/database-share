// 閲覧専用の共有ページ（2026-10-09）のデータ：Driveのファイル（読むだけのスクリプトが返す）から、
// 店ごとの台・日別の総差枚・イベント・その日のTOP10と強かった機種5選を作る。数え方は
// database_android の dailyNet・calendarDaySummary・PC event_calendar と同じ。
import {meruhenNetDetail} from './net.mjs';

export const MERUHEN_STORES = {
  nagamachiminami: {name: 'メルヘンワールド長町南店', short: '長町南'},
  saiwaichou: {name: 'スーパーメルヘンワールド幸町', short: '幸町'},
};
export const STRONG_MACHINE_MIN_RACKS = 2;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 画面に出す機種名：半角カナだけ全角にそろえる（list_views.displayMachineName と同じ）。 */
export function displayMachineName(name) {
  return String(name ?? '').replace(/[｡-ﾟ]+/g, s => s.normalize('NFKC'));
}

export function storeLabel(store, short = false) {
  if (MERUHEN_STORES[store]) return short ? MERUHEN_STORES[store].short : MERUHEN_STORES[store].name;
  const m = /^pscube:c\d+:(\d+(?:\.\d+)?)$/.exec(store);
  // この閲覧専用ページでは「P-STATION」と表記する（利用者指定 2026-10-09。データの名前は pscube のまま）。
  return m ? `P-STATION（${m[1]}スロ）` : store;
}

const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);

/** サイトの数値が異常な台（整備中の 88888888 など）。models.hasImplausibleNumbers と同じ。 */
function implausible(r) {
  return r.games > 20000 || r.bb > 500 || r.rb > 500 || (r.output ?? 0) > 100000;
}

/** メルヘンの閲覧用ファイル（database-viewer.json）の台。差枚は推定差枚。 */
export function meruhenRecords(doc) {
  if (!doc || !Array.isArray(doc.records)) return [];
  const result = [];
  for (const raw of doc.records) {
    if (!raw || !MERUHEN_STORES[raw.store ?? 'nagamachiminami'] || !DAY.test(raw.day ?? '')) continue;
    const rack = int(raw.rack);
    if (rack == null || typeof raw.machine !== 'string') continue;
    const r = {
      store: raw.store ?? 'nagamachiminami', day: raw.day, machine: raw.machine, rack,
      games: int(raw.games) ?? 0, bb: int(raw.bb) ?? 0, rb: int(raw.rb) ?? 0, output: int(raw.max_hold),
    };
    const net = meruhenNetDetail(raw.graph_measurement, r.output, r.games);
    r.net = net.value;
    r.needsCheck = net.needsCheck;
    r.estimated = true;
    result.push(r);
  }
  return result;
}

/** P’s CUBEの閲覧用ファイル（pscube-viewer-drive.json）の台。差枚は元グラフの差枚。店舗は `pscube:店:貸玉`。 */
export function pscubeRecords(doc) {
  if (!doc || doc.format !== 'pscube-viewer' || !Array.isArray(doc.records)) return [];
  const result = [];
  for (const raw of doc.records) {
    if (!raw || !/^c\d+$/.test(raw.store ?? '') || !/^\d+(?:\.\d+)?$/.test(raw.rate ?? '') || !DAY.test(raw.day ?? '')) continue;
    const rack = int(raw.rack);
    if (rack == null || typeof raw.machine !== 'string') continue;
    // 利用者が外すと決めた機種（閲覧ページの pscubeViewerRecords と同じ）。
    if (['沖ドキ', 'オキドキ'].some(word => displayMachineName(raw.machine).includes(word))) continue;
    result.push({
      store: `pscube:${raw.store}:${raw.rate}`, day: raw.day, machine: raw.machine, rack,
      games: int(raw.games) ?? 0, bb: int(raw.bb) ?? 0, rb: int(raw.rb) ?? 0, output: int(raw.my),
      net: int(raw.net_medals), needsCheck: false, estimated: false,
    });
  }
  return result;
}

/** 店・日ごとの台（数値異常の台は除く）。 */
export function indexRecords(records) {
  const byDay = new Map();
  for (const r of records) {
    if (implausible(r)) continue;
    const key = `${r.store}|${r.day}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  }
  return byDay;
}

/** その日の総差枚（差枚のある台だけ足す。1台も無ければ total は null で、0にしない）。 */
export function dayNet(racks) {
  const nets = racks.filter(r => r.net != null);
  return {total: nets.length ? nets.reduce((s, r) => s + r.net, 0) : null, captured: nets.length, racks: racks.length};
}

/** その日のTOP10（差枚の多い順）と強かった機種5選（1台あたりの平均回転数、2台以上の機種）。 */
export function daySummary(racks) {
  const top = racks.filter(r => r.net != null).sort((a, b) =>
    b.net - a.net || b.games - a.games || a.rack - b.rack).slice(0, 10);
  const byMachine = new Map();
  for (const r of racks) {
    if (!byMachine.has(r.machine)) byMachine.set(r.machine, []);
    byMachine.get(r.machine).push(r);
  }
  const machines = [...byMachine].filter(([, list]) => list.length >= STRONG_MACHINE_MIN_RACKS)
    .map(([machine, list]) => ({machine, racks: list.length,
      average: Math.round(list.reduce((s, r) => s + r.games, 0) / list.length)}))
    .sort((a, b) => b.average - a.average || b.racks - a.racks || (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0))
    .slice(0, 5);
  return {top, machines};
}

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const timeOf = (e) => (typeof e.updated_at === 'string' && TIME.test(e.updated_at) ? Date.parse(e.updated_at) : null);

/** イベントをまとめる：同じ店・日は入力時刻の新しい方（同じなら後から足した方）、時刻のある方が時刻の無い方に勝つ。 */
export function mergeEvents(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || !DAY.test(raw.day ?? '') || typeof raw.store !== 'string') continue;
      const store = raw.rate == null ? raw.store : `pscube:${raw.store}:${raw.rate}`;
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
      const event = {store, day: raw.day, name, at: timeOf(raw)};
      if (event.name == null && event.at == null) continue;
      const key = `${store}|${raw.day}`;
      const old = merged.get(key);
      if (!old || (event.at != null && (old.at == null || event.at >= old.at))) merged.set(key, event);
    }
  }
  return merged;
}

/** その日の02:00（日本時間）より前に入力したか（＊を付けない）。date_events.enteredInAdvance と同じ。 */
export function enteredInAdvance(event) {
  if (event.at == null) return false;
  const [y, m, d] = event.day.split('-').map(Number);
  return event.at < Date.UTC(y, m - 1, d, 2 - 9);
}

export function eventLabel(event) {
  if (!event || event.name == null) return '';
  return event.name + (enteredInAdvance(event) ? '' : '＊');
}

export function signed(n) {
  return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US');
}

/** カレンダーのマス用：10万枚以上は「+13.4万」（狭い画面で桁が切れないため）。 */
export function compactSigned(n) {
  if (Math.abs(n) < 100000) return signed(n);
  return (n > 0 ? '+' : '-') + (Math.round(Math.abs(n) / 1000) / 10).toFixed(1) + '万';
}

/** 日曜始まりの週。月の外は null。 */
export function monthWeeks(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
  const weeks = [];
  for (let d = start; ; d = new Date(d.getTime() + 7 * 86400000)) {
    const week = Array.from({length: 7}, (_, i) => new Date(d.getTime() + i * 86400000));
    if (week[0].getUTCMonth() !== month - 1 && week[0] > first) break;
    weeks.push(week.map(x => (x.getUTCMonth() === month - 1 ? x.toISOString().slice(0, 10) : null)));
  }
  return weeks;
}

/** リンク・URL・ID のどれからでも、スクリプトのIDを取り出す。 */
export function scriptIdFrom(text) {
  const value = String(text ?? '').trim();
  const match = /#(?:.*&)?s=([A-Za-z0-9_-]+)/.exec(value) || /\/macros\/s\/([A-Za-z0-9_-]+)\/exec/.exec(value);
  const id = match ? match[1] : value;
  return /^[A-Za-z0-9_-]{20,120}$/.test(id) ? id : null;
}

/** リンクの # の後ろの u=（渡した相手の呼び名、英数字と - _ だけ）。無ければ null。 */
export function viewerNameFrom(text) {
  const match = /#(?:.*&)?u=([A-Za-z0-9_-]{1,40})(?:&|$)/.exec(String(text ?? ''));
  return match ? match[1] : null;
}
