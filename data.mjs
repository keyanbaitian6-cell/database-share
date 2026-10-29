// 閲覧専用の共有ページ（2026-10-09）のデータ：Driveのファイル（読むだけのスクリプトが返す）から、
// 店ごとの台・日別の総差枚・イベント・その日のTOP10と強かった機種5選を作る。数え方は
// database_android の dailyNet・calendarDaySummary・PC event_calendar と同じ。
import {meruhenNetDetail, meruhenNetHidden} from './net.mjs?v=0f0025fc85ae';

export const MERUHEN_STORES = {
  nagamachiminami: {name: 'メルヘンワールド長町南店', short: '長町南'},
  saiwaichou: {name: 'スーパーメルヘンワールド幸町', short: '幸町'},
};
export const STRONG_MACHINE_MIN_RACKS = 2;
/** 差枚ランキングは50位まで（はじめの10位までを開いて見せ、残りは折りたたむ）。強かった機種は10位まで。 */
export const TOP_RACKS = 50, TOP_RACKS_OPEN = 10, TOP_MACHINES = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 表示しない機種（PC core.HIDDEN_MACHINE_WORDS・Android excluded_machines.dart の hiddenMachineWords と同じ）。
 * 幸町の聖闘士星矢 海皇覚醒（1279番台、ずっと稼働停止）は 2026-10-11 利用者の指定で、取り込まず表示もしない。
 * 古い閲覧用ファイルに残っていても出さない。
 */
const HIDDEN_MACHINE_WORDS = {saiwaichou: ['聖闘士星矢海皇覚醒']};

export function isHiddenMachine(store, name) {
  const text = String(name ?? '').normalize('NFKC').replace(/\s+/g, '');
  return (HIDDEN_MACHINE_WORDS[store] ?? []).some(word => text.includes(word));
}

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

/** 線を外した記録（2026-10-25、tool/viewer_curves_split.js）は、線があるうちにGoogleで計算した推定差枚を使う。
 * 最大持玉・回転数が計算時と違えば、線なしで計算し直すと値がずれるため出さない。線のある記録は null。 */
function remoteCurveNet(graph, r) {
  if (!graph || graph.curve_remote !== true || Array.isArray(graph.curve)) return null;
  const e = graph.net_estimate;
  if (!e || (e.value !== null && !Number.isInteger(e.value)) || typeof e.needs_check !== 'boolean' ||
      e.max_hold !== (r.output ?? null) || e.games !== r.games) return {value: null, needsCheck: false};
  return {value: e.value, needsCheck: e.needs_check};
}

/** メルヘンの閲覧用ファイル（database-viewer.json）の台。差枚は推定差枚。 */
export function meruhenRecords(doc) {
  if (!doc || !Array.isArray(doc.records)) return [];
  const result = [];
  for (const raw of doc.records) {
    if (!raw || !MERUHEN_STORES[raw.store ?? 'nagamachiminami'] || !DAY.test(raw.day ?? '')) continue;
    const rack = int(raw.rack);
    if (rack == null || typeof raw.machine !== 'string') continue;
    if (isHiddenMachine(raw.store ?? 'nagamachiminami', raw.machine)) continue;
    const r = {
      store: raw.store ?? 'nagamachiminami', day: raw.day, machine: raw.machine, rack,
      games: int(raw.games) ?? 0, bb: int(raw.bb) ?? 0, rb: int(raw.rb) ?? 0, output: int(raw.max_hold),
      // 確定が出た台の印🌈（PCで付ける。RAINBOW.md）と、付け外しした時刻（iPhone・共有ページの印と比べる）。
      rainbow: raw.rainbow === true,
      rainbowAt: typeof raw.rainbow_at === 'string' ? raw.rainbow_at : null,
      // 過去7日の70点判定にも、閲覧ページと同じ元の4点・最大持玉を使う。
      graph: raw.graph_measurement ?? null,
    };
    // ジャグラーオンラインの差枚（お試し、JUGGLER_ONLINE.md）があれば推定差枚より優先する。
    if (Number.isInteger(raw.jo_net)) {
      r.net = raw.jo_net;
      r.needsCheck = false;
      r.estimated = false;
    } else {
      const net = meruhenNetHidden(r.store, r.day) ? {value: null, needsCheck: false}
        : remoteCurveNet(raw.graph_measurement, r) ?? meruhenNetDetail(raw.graph_measurement, r.output, r.games);
      r.net = net.value;
      r.needsCheck = net.needsCheck;
      r.estimated = true;
    }
    result.push(r);
  }
  return result;
}

export const RAINBOW = '🌈';

/** 台番号の横の印（確定が出た台は🌈）。 */
export const rackMark = (r) => (r.rainbow ? RAINBOW : '');

/** その店に🌈の付いた台が1台でもあるか（無い店では最終🌈の欄を出さない）。 */
export function storeHasRainbow(byDay, store) {
  for (const [key, racks] of byDay) if (key.startsWith(`${store}|`) && racks.some((r) => r.rainbow)) return true;
  return false;
}

/**
 * 最終🌈：同じ店・同じ台番号で、day 以前に最後に🌈が付いた日（無ければ null）。台番号で見る
 * （PC版 last_rainbow_days・閲覧ページ lastRainbowDay と同じ）。
 */
export function lastRainbowDay(byDay, store, rack, day) {
  let last = null;
  for (const [key, racks] of byDay) {
    const [s, d] = key.split('|');
    if (s !== store || d > day || (last && d <= last)) continue;
    if (racks.some((r) => r.rack === rack && r.rainbow)) last = d;
  }
  return last;
}

/** 最終🌈の表示：その日なら「当日」、前の日なら「9/26（15日前）」、無ければ「なし」。 */
export function lastRainbowText(last, day) {
  if (!last) return 'なし';
  if (last === day) return '当日';
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000);
  return `${Number(last.slice(5, 7))}/${Number(last.slice(8, 10))}（${days}日前）`;
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
      net_capture:raw.net_capture ?? null,source_site:raw.source_site,
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

/**
 * その台がプラスで終わったか（true/false）、分からなければ null（勝率に数えない）。差枚があればその符号、
 * 無ければグラフの終点がゼロ線より上か（採点の終点と同じく1ピクセル以内はプラスにしない。アナスロ補完は
 * こちらで決まる）。大当たり0回でグラフを取らない台はマイナス。PC core.rack_won・Android SlotRecord.won と同じ。
 */
export function rackWon(r) {
  if (!(r.games > 0)) return null;
  if (r.net != null) return r.net > 0;
  if (r.store.startsWith('pscube:') || meruhenNetHidden(r.store, r.day)) return null;
  const g = r.graph;
  if (g && typeof g === 'object') {
    const end = Number(g.baseline_y) - Number(g.end_y);
    return Number.isFinite(end) ? end > 1 : null;
  }
  return r.bb + r.rb === 0 ? false : null;
}

/**
 * カレンダーの1日に総差枚の代わりに勝率を出すか：差枚の分かる台が、勝ち負けの分かる台の半分に満たない日
 * （2026-10-17 利用者「差枚を出せないところについては勝率を書いてほしい」）。PC core.show_win_rate と同じ。
 */
export const showWinRate = (captured, judged) => judged > 0 && captured * 2 < judged;

/** 「勝率48%」。整数で四捨五入（0.5は切り上げ）。PC core.win_rate_text と同じ。 */
export const winRateText = (won, judged) => `勝率${Math.floor((200 * won + judged) / (2 * judged))}%`;

/** その日の総差枚（差枚のある台だけ足す。1台も無ければ total は null で、0にしない）と、勝ち負けの分かる台数・プラスの台数。 */
export function dayNet(racks) {
  const nets = racks.filter(r => r.net != null);
  const results = racks.map(rackWon).filter(w => w != null);
  const judged = results.length, won = results.filter(Boolean).length;
  return {total: nets.length ? nets.reduce((s, r) => s + r.net, 0) : null, captured: nets.length, racks: racks.length,
          judged, won, winRate: showWinRate(nets.length, judged)};
}

/** 「0回転」「500回転未満」として数える境目（その日のまとめの注記用）。 */
export const LOW_GAMES = 500;

/** その日の台のうち、0回転の台数と、1〜499回転（0回転は含めない）の台数。差枚の取れていない台の目安。 */
export function lowGames(racks) {
  const zero = racks.filter(r => r.games === 0).length;
  const short = racks.filter(r => r.games > 0 && r.games < LOW_GAMES).length;
  return {zero, short};
}

/** 「（40台が0回転。8台が500回転未満）」。どちらも0台なら空。 */
export function lowGamesNote(racks) {
  const {zero, short} = lowGames(racks);
  const parts = [zero ? `${zero}台が0回転` : '', short ? `${short}台が${LOW_GAMES}回転未満` : ''].filter(Boolean);
  return parts.length ? `（${parts.join('。')}）` : '';
}

/**
 * 閲覧用ファイルの day_summaries（保存したアナスロのHTMLからの日ごとの「何台中何台プラス」。台の数値は無い。
 * 2026-10-18 利用者「各日の勝率、何台中何台プラスで終わったかをそれだけを乗せて欲しい」、PC html_day_summary.py）。
 * `${store}|${day}` → {racks, judged, won}。形のおかしい日は捨てる。カレンダーは台データの無い日にだけ使う。
 */
export function daySummaries(doc) {
  const out = new Map();
  if (!doc || !Array.isArray(doc.day_summaries)) return out;
  for (const d of doc.day_summaries) {
    if (!d || !MERUHEN_STORES[d.store] || !DAY.test(d.day ?? '')) continue;
    const {racks, judged, won} = d;
    if (![racks, judged, won].every(Number.isSafeInteger) || !(0 <= won && won <= judged && judged <= racks)) continue;
    out.set(`${d.store}|${d.day}`, {racks, judged, won});
  }
  return out;
}

/** カレンダーの1日に出すもの：台データがあればその日の差枚・勝率（dayNet）、無ければHTMLの集計（summary）。 */
export function calendarDay(racks, summary) {
  if (racks.length || !summary || summary.judged === 0) return {...dayNet(racks), summary: null};
  return {total: null, captured: 0, racks: summary.racks, judged: summary.judged, won: summary.won, winRate: true, summary};
}

/**
 * 読み込みの失敗の理由（2026-10-18 利用者「最新を読み込んでも毎回一部の更新に失敗しましたと出る」。どの店が何で失敗したか
 * 分からなかった）。Promise.allSettled の1件 r から短い文。成功なら ''。
 */
export function loadFailureReason(r) {
  if (r.status === 'fulfilled') return r.value && !r.value.error ? '' : String(r.value?.error || '中身が空でした').slice(0, 80);
  const e = r.reason;
  if (e?.name === 'AbortError') return '時間切れ（30秒）';
  if (e instanceof TypeError) return '通信できませんでした';
  return String(e?.message || e || '不明なエラー').slice(0, 80);
}

/** [[店の名前, allSettled の1件], …] → 「メルヘン：時間切れ（30秒）、P-STATION：…」（失敗したものだけ）。 */
export const loadFailureText = (entries) => entries.map(([label, r]) => [label, loadFailureReason(r)])
  .filter(([, why]) => why).map(([label, why]) => `${label}：${why}`).join('、');

/** その月の日（`2026-10-01`〜）。month は1〜12。 */
export function monthDayList(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return Array.from({length: last}, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * 日の並び days の勝率（2026-10-18 利用者「月ごとに月間の勝率出すのと、年間でも見れるページ」）。日ごとにカレンダーと同じ元
 * （台データ、無い日はHTMLの集計）の「勝ち負けの分かる台」「プラスの台」を足して割る（日の勝率の平均ではない）。
 * days＝勝ち負けの分かる台が1台以上あった日の数。
 */
export function periodWinRate(byDay, summaries, store, days) {
  let judged = 0, won = 0, counted = 0;
  for (const day of days) {
    const key = `${store}|${day}`;
    const d = calendarDay(byDay.get(key) ?? [], summaries.get(key));
    if (d.judged > 0) { judged += d.judged; won += d.won; counted++; }
  }
  return {judged, won, days: counted};
}

/** その年の月ごとの勝率（1〜12月）と年間。 */
export function yearWinRates(byDay, summaries, store, year) {
  const months = Array.from({length: 12}, (_, i) => ({month: i + 1, ...periodWinRate(byDay, summaries, store, monthDayList(year, i + 1))}));
  const total = months.reduce((t, m) => ({judged: t.judged + m.judged, won: t.won + m.won, days: t.days + m.days}), {judged: 0, won: 0, days: 0});
  return {months, total};
}

/** 勝率の出せる年（新しい順）。台データの日とHTMLの集計の日から。 */
export function winRateYears(byDay, summaries, store) {
  const years = new Set();
  for (const map of [byDay, summaries]) {
    for (const key of map.keys()) {
      const [s, day] = key.split('|');
      if (s === store) years.add(Number(day.slice(0, 4)));
    }
  }
  return [...years].sort((a, b) => b - a);
}

/** その日の差枚TOP50（差枚の多い順）と強かった機種10選（1台あたりの平均回転数、2台以上の機種）。 */
export function daySummary(racks) {
  const top = racks.filter(r => r.net != null).sort((a, b) =>
    b.net - a.net || b.games - a.games || a.rack - b.rack).slice(0, TOP_RACKS);
  const byMachine = new Map();
  for (const r of racks) {
    if (!byMachine.has(r.machine)) byMachine.set(r.machine, []);
    byMachine.get(r.machine).push(r);
  }
  const machines = [...byMachine].filter(([, list]) => list.length >= STRONG_MACHINE_MIN_RACKS)
    .map(([machine, list]) => ({machine, racks: list.length,
      average: Math.round(list.reduce((s, r) => s + r.games, 0) / list.length)}))
    .sort((a, b) => b.average - a.average || b.racks - a.racks || (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0))
    .slice(0, TOP_MACHINES);
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

/** その日の03:00（日本時間、2026-10-26に2時から3時へ）より前に入力したか（＊を付けない）。date_events.enteredInAdvance と同じ。 */
export function enteredInAdvance(event) {
  if (event.at == null) return false;
  const [y, m, d] = event.day.split('-').map(Number);
  return event.at < Date.UTC(y, m - 1, d, 3 - 9);
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

/** バラエティ（その日その店で1〜3台の機種）。Android `varietyMaxRacks` と同じ。 */
export const VARIETY_MAX_RACKS = 3;
/** 幸町は1〜2台（2026-10-13利用者指定）、ほかの店舗は1〜3台。 */
export const varietyMaxRacksFor = store => store === 'saiwaichou' ? 2 : VARIETY_MAX_RACKS;

// 幸町のバラエティ履歴（2026-10-29 利用者指定）。PC event_history_data・閲覧ページ event_history_model と同じ判定。
// 優・良は表示のたびに機種のその日の合計差枚から決める（保存しない。手入力が優先）。
// 赤字は、今日を除いた直前5暦日に合計差枚が+800枚を超えた日も優の日も無い機種。記録なし・差枚不明の日は超えていないと数える。
export const SAIWAICHOU_GAP_NET = 800, SAIWAICHOU_GAP_DAYS = 5;

/** その日のその保存名の台（indexRecords の、数値異常を除いた台）の合計差枚。台数が週表と違う・差枚の分からない台があれば null。 */
export function saiwaichouMachineNet(racks, count) {
  if (!racks.length || racks.length !== count || racks.some(r => typeof r.net !== 'number' || !Number.isFinite(r.net))) return null;
  return racks.reduce((sum, r) => sum + r.net, 0);
}

/** 2,500枚以上は優、0〜2,499枚は良。マイナス・不明は空欄。 */
export const saiwaichouGrade = total => total == null || total < 0 ? '' : total >= 2500 ? '優' : '良';

/** 赤字判定の最終日：表示週の最後の記録日。ただし今日（日本時間）は含めない。 */
export function saiwaichouGapEnd(lastRecordDay, now = Date.now()) {
  if (!lastRecordDay) return null;
  const yesterday = new Date(now + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  return lastRecordDay < yesterday ? lastRecordDay : yesterday;
}

/** endDay までの5暦日に、合計差枚が+800枚を超えた日も優の日も無ければ true。dayInfo(日) は {net, grade}。 */
export function saiwaichouGap(endDay, dayInfo) {
  if (!endDay) return false;
  const end = Date.parse(`${endDay}T00:00:00Z`);
  for (let i = 0; i < SAIWAICHOU_GAP_DAYS; i++) {
    const {net, grade} = dayInfo(new Date(end - i * 86400000).toISOString().slice(0, 10));
    if ((net != null && net > SAIWAICHOU_GAP_NET) || grade === '優') return false;
  }
  return true;
}
/** 回っていない台：期間（カレンダーの日数）とゲーム数の選択肢・既定値（閲覧ページ variety_idle.dart と同じ）。 */
export const IDLE_DAY_CHOICES = [3, 5, 7, 10, 14], IDLE_DEFAULT_DAYS = 7;
export const IDLE_GAMES_CHOICES = [500, 1000, 1500, 2000, 3000], IDLE_DEFAULT_GAMES = 1000;

/** [from] から [to] までのカレンダーの日数（両端を含む）。 */
export function calendarDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** 店の記録のある日（新しい順）。 */
export function storeDays(byDay, store) {
  const prefix = `${store}|`;
  return [...byDay.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).sort().reverse();
}

/**
 * [store] の [day] にバラエティの台のうち、[day] から前へ、記録のある日がどれも [gamesLimit] G未満のまま
 * [minDays] 日（カレンダーの日数）以上続いている台。期間の長い順（同じなら台番号の順）。
 * 同じ店・機種・台番号の記録だけを数え、店に記録がある日にその台の記録が無ければそこで止める（入れ替え前の
 * 別機種を混ぜない）。店に記録が無い日（サイトが落ちていた日など）は飛ばし、期間には含める。
 * 閲覧ページ `idleVarietyRacks`（database_android/lib/variety_idle.dart）と同じ規則。
 */
export function idleVarietyRacks(byDay, store, day, {minDays = IDLE_DEFAULT_DAYS, gamesLimit = IDLE_DEFAULT_GAMES} = {}) {
  const days = storeDays(byDay, store).filter(d => d <= day);
  if (!days.length || days[0] !== day) return [];
  const dayRows = byDay.get(`${store}|${day}`);
  const counts = new Map();
  for (const r of dayRows) counts.set(r.machine, (counts.get(r.machine) ?? 0) + 1);
  const index = new Map(days.map(d => [d, new Map(byDay.get(`${store}|${d}`).map(r => [`${r.machine}|${r.rack}`, r]))]));
  const result = [];
  for (const r of dayRows) {
    if (counts.get(r.machine) > varietyMaxRacksFor(store)) continue;
    const run = [];
    for (const d of days) {
      const row = index.get(d).get(`${r.machine}|${r.rack}`);
      if (!row || row.games >= gamesLimit) break;
      run.push(row);
    }
    if (!run.length) continue;
    const from = run[run.length - 1].day;
    const span = calendarDays(from, day);
    if (span >= minDays) {
      result.push({latest: run[0], days: run, from, span, maxGames: Math.max(...run.map(x => x.games))});
    }
  }
  return result.sort((a, b) => b.span - a.span || a.latest.rack - b.latest.rack);
}

/*
 * 共有ページから🌈を付ける（2026-10-11 利用者「この虹マークを付けるだけの機能なら共有の方にもつけたい」
 * 「共有の方にも店舗別のバラエティ一覧つけて同じようにしたい」、RAINBOW.md「共有ページから付ける」）。
 * 印は {store, day, rack, on, updated_at}。台の記録の rainbowAt（PCで付け外しした時刻）より新しい印だけ表示に使う。
 */

/** ISOの時刻をミリ秒に（小数6桁などは3桁にそろえる：iPhoneのSafariで読めるように）。読めなければ NaN。 */
export function isoTime(text) {
  if (typeof text !== 'string') return NaN;
  return Date.parse(text.replace(/(\.\d{3})\d+/, '$1'));
}

/** 印の形を確かめる（メルヘンの店だけ）。 */
export function validMark(m) {
  return !!m && typeof m === 'object' && Object.hasOwn(MERUHEN_STORES, m.store) && DAY.test(m.day ?? '')
    && Number.isInteger(m.rack) && m.rack > 0 && typeof m.on === 'boolean' && Number.isFinite(isoTime(m.updated_at));
}

/** 印を台に反映する（台の rainbowAt より新しいものだけ）。変えた台の数を返す。 */
export function applyRainbowMarks(byDay, marks) {
  let changed = 0;
  for (const m of marks) {
    if (!validMark(m)) continue;
    for (const r of byDay.get(`${m.store}|${m.day}`) ?? []) {
      if (r.rack !== m.rack) continue;
      if (r.rainbowAt && !(isoTime(m.updated_at) > isoTime(r.rainbowAt))) continue;
      r.rainbow = m.on;
      r.rainbowAt = m.updated_at;
      changed++;
    }
  }
  return changed;
}

/** 印を [into] に足す（同じ店・日・台は時刻の新しい方）。 */
export function mergeMarks(into, incoming) {
  const map = new Map(into.filter(validMark).map(m => [`${m.store}|${m.day}|${m.rack}`, m]));
  for (const m of incoming) {
    if (!validMark(m)) continue;
    const key = `${m.store}|${m.day}|${m.rack}`;
    const old = map.get(key);
    if (old && isoTime(m.updated_at) < isoTime(old.updated_at)) continue;
    map.set(key, m);
  }
  return [...map.values()];
}

/** 新しく付け外しするときの時刻：今（台の rainbowAt・前の印より必ず後）。 */
export function markTime(now, ...previous) {
  let at = now;
  for (const p of previous) {
    const t = isoTime(p);
    if (Number.isFinite(t) && at <= t) at = t + 1;
  }
  return new Date(at).toISOString();
}

/** 🌈の回数を数える日数（選んだ日を含めて30日、PCのバラエティ🌈と同じ）。 */
export const RAINBOW_COUNT_DAYS = 30;

/** 店の台番号ごとの、[day] 以前の最後の🌈と、[day] までの30日の🌈の日数。 */
function rainbowHistory(byDay, store, day) {
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - (RAINBOW_COUNT_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const last = new Map(), counts = new Map();
  for (const [key, racks] of byDay) {
    const [s, d] = key.split('|');
    if (s !== store || d > day) continue;
    for (const r of racks) {
      if (!r.rainbow) continue;
      if (!last.has(r.rack) || last.get(r.rack) < d) last.set(r.rack, d);
      if (d >= from) counts.set(r.rack, (counts.get(r.rack) ?? 0) + 1);
    }
  }
  return {last, counts};
}

/**
 * バラエティ🌈の一覧（PCのバラエティ🌈のタブ variety_rainbow.variety_rows と同じ）。並べる台と機種名は、その店の
 * 最新の記録の日のバラエティ（その日1〜3台の機種）。数値と🌈は選んだ日 [day] の同じ台番号の記録（無ければ record は null）。
 * 最終🌈（last、その日以前）と30日の🌈の日数（count）。台番号の順。
 */
export function varietyRainbowRows(byDay, store, day) {
  const latest = lineupDay(byDay, store);
  if (!latest) return [];
  const lineup = byDay.get(`${store}|${latest}`) ?? [];
  const counts = new Map();
  for (const r of lineup) counts.set(r.machine, (counts.get(r.machine) ?? 0) + 1);
  const onDay = new Map((byDay.get(`${store}|${day}`) ?? []).map(r => [r.rack, r]));
  const {last, counts: rainbowCounts} = rainbowHistory(byDay, store, day);
  const max = rainbowVarietyMax(store);
  return lineup.filter(r => counts.get(r.machine) <= max)
    .map(current => {
      const record = onDay.get(current.rack) ?? null;
      return {rack: current.rack, machine: current.machine, record,
        dayMachine: record && record.machine !== current.machine ? record.machine : null,
        last: last.get(current.rack) ?? null, count: rainbowCounts.get(current.rack) ?? 0};
    })
    .sort((a, b) => a.rack - b.rack);
}

/** 本日用の印一覧。未取得の数値行を byDay へ足さず、印だけを別に扱う。 */
export function rainbowTodayRows(byDay, marks, store, day) {
  if (store !== 'saiwaichou') return {lineupDay: null, rows: []};
  const known = new Map([...byDay].filter(([key]) => key.startsWith(`${store}|`) && key.slice(store.length + 1) <= day));
  const source = lineupDay(known, store);
  const markMap = new Map(mergeMarks([], marks).map(m => [`${m.store}|${m.day}|${m.rack}`, m]));
  const rows = varietyRainbowRows(known, store, day).map(x => {
    const actual = x.record;
    const marker = {store, day, rack: x.rack, machine: actual?.machine ?? x.machine,
      rainbow: actual?.rainbow ?? false, rainbowAt: actual?.rainbowAt ?? null};
    const mark = markMap.get(`${store}|${day}|${x.rack}`);
    if (mark && (!marker.rainbowAt || isoTime(mark.updated_at) > isoTime(marker.rainbowAt))) {
      marker.rainbow = mark.on;
      marker.rainbowAt = mark.updated_at;
    }
    return {...x, marker, imported: !!actual};
  });
  return {lineupDay: source, rows};
}

/**
 * 共有ページ「🌈の記録」（表・空き順）の行（2026-10-16 利用者「青い枠で囲まれてるところが本日みたいな雰囲気でてしまうので、
 * 本日＝開いている日、見ている日に」）。varietyRainbowRows に、選んだ日 [day] が本日 [today] のときの取り込み前の印
 * （rainbowTodayRows と同じ。幸町だけ）を足す。mark＝選んだ日に付け外しする相手（その日の記録か、本日の取り込み前の印。
 * どちらも無ければ null）、open＝台番号を押したときに開く記録（選んだ日に無ければ、それより前の最新の記録）。
 */
export function varietyRecordRows(byDay, marks, store, day, today) {
  const pending = day === today
    ? new Map(rainbowTodayRows(byDay, marks, store, day).rows.map(x => [x.rack, x.marker])) : new Map();
  const before = storeDays(byDay, store).filter(d => d <= day);
  return varietyRainbowRows(byDay, store, day).map(x => {
    const mark = x.record ?? pending.get(x.rack) ?? null;
    let open = x.record;
    for (const d of before) {
      if (open) break;
      open = (byDay.get(`${store}|${d}`) ?? []).find(r => r.rack === x.rack) ?? null;
    }
    return {...x, mark, open, last: mark?.rainbow ? day : x.last};
  });
}

/**
 * 🌈の一覧で「バラエティ」とする台数（2026-10-12 利用者「幸町のバラエティは1台機種限定にして欲しい」）。幸町は1台だけの機種、
 * ほかの店は1〜3台（VARIETY_MAX_RACKS）。回っていない台・翌日候補の「バラエティ」は1〜3台のまま。PC版
 * variety_rainbow.RAINBOW_VARIETY_MAX_RACKS と同じ。
 */
export const RAINBOW_VARIETY_MAX_RACKS = {saiwaichou: 1};
export const rainbowVarietyMax = (store) => RAINBOW_VARIETY_MAX_RACKS[store] ?? VARIETY_MAX_RACKS;

/** ローテーション表の日数（選んだ日を右端に、カレンダーの日数で7日）。 */
export const ROTATION_DAYS = 7;

/** [day] を右端にした [n] 日（カレンダーの日、古い順）。 */
export function windowDays(day, n = ROTATION_DAYS) {
  const end = Date.parse(`${day}T00:00:00Z`);
  return Array.from({length: n}, (_, i) => new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
}

/** 閲覧ページ lib/scoring.dart scoreRecord のメルヘン採点v12。推定差枚は採点に使わない。 */
export function meruhenScore(row, history) {
  if (row.games <= 500 || row.bb < 0 || row.rb < 0 || (row.output ?? 0) < 0 || implausible(row)) {
    return {total: null, provisional: true};
  }
  const first = windowDays(row.day, 31)[0];
  const target = Math.max(500, row.games);
  const refs = history.filter(r => r.store === row.store && r.machine === row.machine
    && r.day >= first && r.day < row.day && r.games >= Math.max(500, target / 2)
    && r.games <= target * 2 && !implausible(r));
  const hitRefs = refs.filter(r => r.bb >= 0 && r.rb >= 0);
  const holdRefs = refs.filter(r => r.output != null && r.output >= 0);
  const days = list => new Set(list.map(r => r.day)).size;
  const rank = (value, list, field, maximum) => {
    if (value == null || !list.length) return null;
    const values = list.map(field);
    const percentile = (values.filter(v => v < value).length + 0.5 * values.filter(v => v === value).length) / values.length;
    const weight = Math.pow(row.games / (row.games + 1500) * list.length / (list.length + 20)
      * days(list) / (days(list) + 3), 1 / 3);
    return maximum * (0.5 + weight * (percentile - 0.5));
  };
  const rate = r => (r.bb + r.rb) / r.games;
  const hit = rank(rate(row), hitRefs, rate, 60);
  const rankedHold = rank(row.output, holdRefs, r => r.output, 20);
  const hold = rankedHold == null ? null : Math.max(rankedHold, 20 * Math.min(1, row.output / 19000));
  let positive = null, retention = null;
  const g = row.graph;
  if (g == null && row.bb + row.rb === 0) {
    positive = retention = 0;
  } else if (g && [g.baseline_y, g.peak_y, g.end_y].every(v => typeof v === 'number' && Number.isFinite(v))) {
    const peak = Math.max(0, g.baseline_y - g.peak_y), end = g.baseline_y - g.end_y;
    if (end === 0 || Math.abs(end) > 1) {
      positive = end > 0 ? 10 : 0;
      retention = peak === 0 ? 0 : 10 * Math.max(0, Math.min(1, end / peak));
    }
  }
  const parts = [[hit, 60], [hold, 20], [positive, 10], [retention, 10]];
  const missing = parts.reduce((sum, [value, max]) => sum + (value == null ? max : 0), 0);
  const observed = parts.reduce((sum, [value]) => sum + (value ?? 0), 0);
  return {total: Math.round((observed + missing / 2) * 10) / 10,
    provisional: missing > 0 || row.games < 1500 || Math.min(hitRefs.length, holdRefs.length) < 20
      || Math.min(days(hitRefs), days(holdRefs)) < 3};
}

// 採点の比較相手は店舗・機種ごと。印の付け外しでは採点が変わらないため結果も覚える。
const weeklyScoreCache = new WeakMap();
function weeklyScorer(byDay) {
  let cached = weeklyScoreCache.get(byDay);
  if (!cached) {
    const histories = new Map(), scores = new WeakMap();
    for (const rows of byDay.values()) for (const r of rows) {
      const key = `${r.store}|${r.machine}`;
      if (!histories.has(key)) histories.set(key, []);
      histories.get(key).push(r);
    }
    cached = r => {
      if (!scores.has(r)) scores.set(r, meruhenScore(r, histories.get(`${r.store}|${r.machine}`) ?? []));
      return scores.get(r);
    };
    weeklyScoreCache.set(byDay, cached);
  }
  return cached;
}

/** 幸町の最新の並びの1台機種。選択日を含む7日（2026-10-13 利用者「当日を含む7日間」）、台番号ごと（既存の🌈表と同じ）。 */
export function varietyWeek(byDay, store, day) {
  const days = windowDays(day), score = weeklyScorer(byDay);
  const rows = store === 'saiwaichou' ? varietyRainbowRows(byDay, store, day).map(x => {
    const records = rackDays(byDay, store, x.rack, days).filter(Boolean);
    const high = records.map(record => ({record, score: score(record)})).filter(x => x.score.total != null && x.score.total >= 70);
    high.sort((a, b) => b.score.total - a.score.total || b.record.day.localeCompare(a.record.day));
    return {...x, records, high, rainbowDays: records.filter(r => r.rainbow).length,
      observedDays: records.length, openRecord: high[0]?.record ?? records.at(-1) ?? x.record};
  }) : [];
  return {days, rows, high: rows.filter(x => x.high.length),
    noRainbow: rows.filter(x => x.observedDays > 0 && x.rainbowDays === 0),
    unknown: rows.filter(x => x.observedDays === 0)};
}

/**
 * ローテーション表の1台分：[days] の各日の、同じ台番号の記録（無ければ null）。🌈は record.rainbow。
 * 台番号で見る（機種が入れ替わっても同じ台番号なら続けて並べる。最終🌈と同じ）。
 */
export function rackDays(byDay, store, rack, days) {
  return days.map(d => (byDay.get(`${store}|${d}`) ?? []).find(r => r.rack === rack) ?? null);
}

/** 最後の🌈から何日（[day] に付いていれば0、一度も無ければ null）。 */
export function daysSinceRainbow(last, day) {
  if (!last) return null;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000);
}

/** 空き順：最後の🌈から長い台が上（一度も無い台がいちばん上、同じなら台番号の順）。 */
export function byLongestGap(rows, day) {
  const gap = (x) => {
    const n = daysSinceRainbow(x.last, day);
    return n == null ? Infinity : n;
  };
  return [...rows].sort((a, b) => gap(b) - gap(a) || a.rack - b.rack);
}

/**
 * バラエティ🌈の並べる台を取る日：新しい日から見て、その店のふだんの台数（直近14日でいちばん多い日）の8割以上の記録がある日
 * （2026-10-12、サイトが落ちていて一部しか取れていない日の並びにしない）。PC版 variety_rainbow.lineup_day と同じ。
 */
export function lineupDay(byDay, store) {
  const days = storeDays(byDay, store).slice(0, 14);
  if (!days.length) return null;
  const counts = days.map(d => (byDay.get(`${store}|${d}`) ?? []).length);
  const usual = Math.max(...counts);
  return days[counts.findIndex(n => n >= usual * 0.8)];
}

/** 並べ方（PCと同じ）。 */
export const VARIETY_SORTS = {
  '台番順': (a, b) => a.rack - b.rack,
  '最終🌈の古い順': (a, b) => Number(!!a.record?.rainbow) - Number(!!b.record?.rainbow)
    || (a.last ?? '').localeCompare(b.last ?? '') || a.rack - b.rack,
  '機種順': (a, b) => a.machine.localeCompare(b.machine, 'ja') || a.rack - b.rack,
};

/*
 * 末尾別データまとめ（2026-10-12 利用者「幸町にもつくってもらうだけでいい」。閲覧ページ・Android版の
 * database_android/lib/pscube_suffix.dart と同じ店・末尾・ゾロ目）。このページは採点を持たないので、順位は平均差枚の高い順
 * （閲覧ページ・Android版は平均点の順）。差枚の分からない台は平均に入れない。
 */
export const SUFFIX_STORES = ['saiwaichou'];
export const SUFFIXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const ZOROME = 100;
export const ZOROME_ENDINGS = [0, 11, 22, 33, 44, 55, 66, 77, 88, 99];
// P’s CUBE（このページでは P-STATION）の末尾・ゾロ目（2026-10-12 利用者「共有のP-stationの方にも末尾データほしいです」。
// 閲覧ページ・Android版の pscubeSuffixes・pscubeZoromeEndings と同じ。台番号に4・9が無い）。
export const PSCUBE_SUFFIXES = [0, 1, 2, 3, 5, 6, 7, 8];
export const PSCUBE_ZOROME_ENDINGS = [0, 11, 22, 33, 55, 66, 77, 88];
export const SUFFIX_PERIODS = {day: ['選択日', 1], week: ['過去7日', 7], month: ['過去30日', 30]};
const isPscube = (store) => /^pscube:/.test(store ?? '');
/** 末尾別データまとめを出す店（幸町と、P’s CUBEの店すべて）。 */
export const hasSuffixSummary = (store) => SUFFIX_STORES.includes(store) || isPscube(store);
export const suffixesOf = (store) => (isPscube(store) ? PSCUBE_SUFFIXES : SUFFIXES);
export const zoromeEndingsOf = (store) => (isPscube(store) ? PSCUBE_ZOROME_ENDINGS : ZOROME_ENDINGS);
export const isZorome = (rack, store = 'saiwaichou') => rack >= 10 && zoromeEndingsOf(store).includes(rack % 100);
export const suffixLabel = (suffix) => (suffix === ZOROME ? 'ゾロ目' : `末尾${suffix}`);

function summarizeSuffix(suffix, entries) {
  const nets = entries.map(r => r.net).filter(v => Number.isFinite(v));
  return {
    suffix, label: suffixLabel(suffix), entries,
    records: entries.length,
    racks: new Set(entries.map(r => r.rack)).size,
    averageGames: entries.length ? entries.reduce((n, r) => n + r.games, 0) / entries.length : null,
    nets: nets.length,
    averageNet: nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : null,
    plus: nets.filter(v => v > 0).length,
  };
}

/** [store] の [day] までの [days] 日（カレンダーの日）の末尾別のまとめ。順位は平均差枚（表示と同じ整数）の高い順、同じなら同順位。 */
export function suffixReport(byDay, store, day, days = 1) {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const suffixes = suffixesOf(store);
  const grouped = new Map(suffixes.map(s => [s, []]));
  const zorome = [];
  for (const d of storeDays(byDay, store)) {
    if (d > day || d < start) continue;
    for (const r of byDay.get(`${store}|${d}`) ?? []) {
      grouped.get(r.rack % 10)?.push(r);   // P’s CUBEの末尾4・9（ほぼ無い）は数えない
      if (isZorome(r.rack, store)) zorome.push(r);
    }
  }
  const order = (a, b) => b.day.localeCompare(a.day) || a.rack - b.rack;
  const summaries = [...suffixes.map(s => summarizeSuffix(s, grouped.get(s).sort(order))), summarizeSuffix(ZOROME, zorome.sort(order))];
  const shown = s => Math.round(s.averageNet);
  const ranked = summaries.filter(s => s.averageNet != null).sort((a, b) => shown(b) - shown(a) || a.suffix - b.suffix);
  const rankOf = s => 1 + ranked.filter(x => shown(x) > shown(s)).length;
  const plain = summaries.filter(s => s.suffix !== ZOROME);
  return {
    summaries, ranked, rankOf, start, end: day,
    leaders: ranked.filter(s => rankOf(s) === 1),
    records: plain.reduce((n, s) => n + s.records, 0),
    racks: plain.reduce((n, s) => n + s.racks, 0),
    days: new Set(summaries.flatMap(s => s.entries.map(r => r.day))).size,
  };
}

// キャラ誕生日（EVENT_CALENDAR.md「キャラ誕生日」、2026-10-18 利用者「足してほしかった」）。
// PC `event_calendar.load_character_birthdays`・Flutter `character_birthdays.dart` と同じ規則：実在する月日だけ、
// 同じ名前・作品は1つ、名前順。一覧は「名前（作品）」、うるう年でない年は2/29生まれを3/1に「（作品、2/29生まれ）」で出す。
export const birthdayKey = (month, day) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** 誕生日一覧（character_birthdays.json の中身）を月日（mm-dd）ごとに読む。形が違えば空。 */
export function parseCharacterBirthdays(doc) {
  const found = new Map();
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) return found;
  for (const raw of doc.entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const {month, day, name} = raw;
    if (!Number.isInteger(month) || !Number.isInteger(day) || typeof name !== 'string') continue;
    // 実在する月日だけ（うるう年の2024年で確かめるので2/29も入る）。
    const date = new Date(Date.UTC(2024, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    const work = typeof raw.work === 'string' ? raw.work.trim() : '';
    const key = birthdayKey(month, day);
    const list = found.get(key) ?? [];
    if (!list.some(b => b.name === trimmed && b.work === work)) list.push({name: trimmed, work});
    found.set(key, list);
  }
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  for (const list of found.values()) list.sort((a, b) => order(a.name, b.name) || order(a.work, b.work));
  return found;
}

/** 一覧に出す「名前（作品）」。[note] は作品の後ろに「、」で足す（2/29生まれなど）。 */
export function characterBirthdayLabel(name, work, note = '') {
  const inside = [work, note].filter(Boolean).join('、');
  return inside ? `${name}（${inside}）` : name;
}

/** その日（yyyy-mm-dd）のキャラ誕生日 [{name, label}]。 */
export function characterBirthdaysOn(birthdays, day) {
  const [y, m, d] = day.split('-').map(Number);
  const shown = (birthdays.get(birthdayKey(m, d)) ?? []).map(b => ({name: b.name, label: characterBirthdayLabel(b.name, b.work)}));
  const leapYear = new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1;
  if (m === 3 && d === 1 && !leapYear) {
    for (const b of birthdays.get(birthdayKey(2, 29)) ?? []) {
      shown.push({name: b.name, label: characterBirthdayLabel(b.name, b.work, '2/29生まれ')});
    }
  }
  return shown;
}

/** マスに出す「🎂 名前2人＋ほか○名」（閲覧ページ・Androidのマスと同じ）。 */
export function characterBirthdayCellLabel(names) {
  if (!names.length) return '';
  const more = names.length > 2 ? ` ほか${names.length - 2}名` : '';
  return `🎂 ${names.slice(0, 2).join('・')}${more}`;
}

// 旧Googleスクリプトの1回5,000件制限を守り、失敗時は以降を送らない。
// 呼び出し元は端末の印を保持し、次の操作で再送する（部分成功も同じ時刻で安全に再送）。
export async function sendRainbowBatches(marks, post, canBatch = async () => false) {
  if (marks.length > 5000 && await canBatch() !== true) {
    return {error: '5,000件を超える🌈の共有にはGoogleスクリプトの更新が必要です。端末の印は保持しています。'};
  }
  for (let start = 0; start < marks.length; start += 5000) {
    const result = await post({file: 'rainbow', marks: marks.slice(start, start + 5000)});
    if (result?.ok !== true) return result ?? {error: '返事が読めません'};
  }
  return {ok: true};
}

// 独立保存の印は、一部でも読めなければ書き込みを止める。表示用の寛容な統合とは分ける。
export function storedRainbowMarks(text) {
  if (text === null) return [];
  const marks = JSON.parse(text);
  if (!Array.isArray(marks) || marks.some(m => !validMark(m))) {
    throw new Error('保存済みの🌈を確認できません。');
  }
  return mergeMarks([], marks);
}

export function sharedRainbowCanBatch(doc) {
  return doc?.format === 'database-release' && Array.isArray(doc.capabilities) && doc.capabilities.includes('rainbow-storage-v2');
}
