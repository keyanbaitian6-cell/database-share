// 閲覧専用の共有ページ（お試し、2026-10-09。EVENT_CALENDAR.md「閲覧専用の共有ページ」）。
// 読むだけのApps Script（database_android/tool/viewer_drive_script_readonly.gs）からDriveのファイルを読み、
// イベントカレンダー（各日のイベント・総差枚）と、日付を押したときの差枚TOP50（11位からは折りたたみ）・強かった機種10選、
// バラエティの回っていない台（期間・ゲーム数を選べる）、バラエティ🌈（確定が出た台の印を付ける一覧）を出す。
// 書き込むのは🌈だけ（2026-10-11、RAINBOW.md「共有ページから付ける」。スクリプトが database-rainbow-shared.json に足し込む）。
// 差分読み込み用の日別キャッシュもIndexedDBに保存する。端末に覚える設定は接続先（スクリプトのID）・選んだ店・回っていない台の期間とゲーム数・バラエティ🌈の並べ方・付けた🌈だけで、
// 利用者自身の閲覧ページ（database-viewer の保存名）とは別の名前を使う。スクリプトのIDはページに書かず、渡すリンクの # の後ろに付ける。
import {fetchViewerDocument, readViewerHistory, rememberViewerHistory} from './viewer_parts.mjs?v=d977521e9a96';
import {prepareOffline, readOfflineMetadata, saveOfflineMetadata} from './offline.mjs?v=d977521e9a96';
import {
  MERUHEN_STORES, calendarDay, compactSigned, dayNet, daySummaries, daySummary, displayMachineName, eventLabel, indexRecords,
  meruhenRecords, mergeEvents, monthWeeks, pscubeRecords, scriptIdFrom, signed, storeLabel, TOP_RACKS_OPEN, viewerNameFrom, winRateText,
  IDLE_DAY_CHOICES, IDLE_DEFAULT_DAYS, IDLE_DEFAULT_GAMES, IDLE_GAMES_CHOICES, idleVarietyRacks, storeDays,
  RAINBOW, lastRainbowDay, lastRainbowText, rackMark, storeHasRainbow,
  RAINBOW_COUNT_DAYS, applyRainbowMarks, markTime, mergeMarks, varietyRecordRows,
  ROTATION_DAYS, byLongestGap, daysSinceRainbow, rackDays, rainbowVarietyMax, windowDays,
  SUFFIX_PERIODS, hasSuffixSummary, suffixesOf, zoromeEndingsOf, suffixLabel, suffixReport,
  varietyWeek, varietyMaxRacksFor, rainbowTodayRows,
} from './data.mjs?v=d977521e9a96';

const ID_KEY = 'database-share-script-id';
const STORE_KEY = 'database-share-store';
// 渡したリンクの呼び名（# の u=）。最初の読み込みにだけ付けて送り、スクリプトが「実行数」に記録する。
const NAME_KEY = 'database-share-name';
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
// この端末で付け外しした🌈（送れなかった分も次に送る）と、バラエティ🌈の並べ方。
const MARKS_KEY = 'database-share-rainbow';
const VARIETY_MODE_KEY = 'database-share-variety-mode-v2';
const VARIETY_SORT_KEY = 'database-share-variety-sort';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const RETRY_MS = [1500, 4000];
const TIMEOUT_MS = 30000;

const app = document.getElementById('app');
const reload = document.getElementById('reload');
const state = {id: null, name: null, model: null, store: null, year: 0, month: 0, loading: false, notice: ''};

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const tone = (n) => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 覚えられなくても見られる */ } },
};

function todayJst() {
  const now = new Date(Date.now() + 9 * 3600000);
  return {y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, day: now.toISOString().slice(0, 10)};
}

async function getJson(url) {
  let last;
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {signal: abort.signal, credentials: 'omit', cache: 'no-store'});
      if (response.ok) return await response.json();
      last = new Error(`読み込めませんでした（${response.status}）`);
    } catch (error) {
      last = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < RETRY_MS.length) await new Promise(r => setTimeout(r, RETRY_MS[attempt]));
  }
  throw last;
}

async function load() {
  const loadingId = state.id;
  state.notice = '';
  if (globalThis.navigator?.onLine === false && state.model) {
    state.notice = 'オフラインです。保存済みのデータを表示しています。'; render(); return;
  }
  state.loading = true;
  reload.disabled = true;
  if (!state.model) {
    app.innerHTML = '<p class="status">Googleドライブから読み込んでいます…<br>最初の読み込みは、1分ほどかかることがあります。</p>';
  }
  const base = `https://script.google.com/macros/s/${state.id}/exec`;
  const [meruhen, pscube, events, pscubeEvents, rainbow] = await Promise.allSettled(
    [state.name ? `?u=${state.name}` : '', '?file=pscube', '?file=events', '?file=pscube-events', '?file=rainbow']
      .map((q, i) => i < 2 ? fetchViewerDocument(base + q, i === 0 ? 'meruhen' : 'pscube', getJson) : getJson(base + q)));
  const doc = (r) => (r.status === 'fulfilled' && r.value && !r.value.error ? r.value : null);
  const m = doc(meruhen), p = doc(pscube);
  if (loadingId !== state.id) return;
  if (!m && !p) {
    state.loading = false; reload.disabled = false;
    const reason = [meruhen, pscube].map(r => (r.status === 'rejected' ? r.reason?.message : r.value?.error)).find(Boolean);
    if (state.model) { state.notice = '更新できませんでした。保存済みのデータを表示しています。'; render(); }
    else showSetup(`読み込めませんでした。リンクが正しいか、少し待ってからもう一度お試しください。${reason ? `（${reason}）` : ''}`);
    return;
  }
  const saved = await readOfflineMetadata(state.id).catch(() => ({}));
  const metadata = {events: doc(events) || saved.events, pscubeEvents: doc(pscubeEvents) || saved.pscubeEvents,
    rainbow: doc(rainbow) || saved.rainbow};
  // 旧Googleスクリプトの全件応答も、端末履歴へ初回移行できる。
  try {
    if (m) await rememberViewerHistory(base, 'meruhen', m, undefined, !m.history);
    if (p) await rememberViewerHistory(base, 'pscube', p, undefined, !p.history);
    await saveOfflineMetadata(state.id, metadata);
  } catch { state.notice = '端末への保存に失敗しました。空き容量とブラウザの保存設定を確認してください。'; }
  state.notice ||= (!m || !p) ? '一部の更新に失敗しました。保存済みのデータを併用しています。' : '';
  const localM = m || await readViewerHistory(base, 'meruhen').catch(() => null);
  const localP = p || await readViewerHistory(base, 'pscube').catch(() => null);
  state.loading = false; reload.disabled = false;
  showDocuments(localM, localP, metadata);
}

function showDocuments(m, p, metadata = {}) {
  const records = [...meruhenRecords(m), ...pscubeRecords(p)];
  const byDay = indexRecords(records);
  // ほかの端末（閲覧ページ・共有ページ）で付け外しした🌈と、この端末の分（PCが取り込む前でも出す）。
  const sharedMarks = metadata.rainbow?.marks;
  const marks = mergeMarks(Array.isArray(sharedMarks) ? sharedMarks : [], localMarks());
  applyRainbowMarks(byDay, marks);
  const stores = [...Object.keys(MERUHEN_STORES), ...new Set(records.map(r => r.store).filter(s => s.startsWith('pscube:')))]
    .filter(s => records.some(r => r.store === s));
  state.model = {
    byDay, stores, marks, summaries: daySummaries(m),
    events: mergeEvents(m?.date_events, metadata.events?.events, p?.date_events, metadata.pscubeEvents?.events),
    exportedAt: [m?.exported_at, p?.exported_at].filter(Boolean).sort().pop() ?? null,
  };
  if (!stores.includes(state.store)) state.store = stores.includes(store.get(STORE_KEY)) ? store.get(STORE_KEY) : stores[0];
  render();
}

// 切り替えの名前：P-STATIONの貸玉が1つだけなら「P-STATION」（店舗名・日付の見出しには貸玉まで出す）。
function switchLabel(s, stores) {
  const pstation = stores.filter(x => x.startsWith('pscube:'));
  return s.startsWith('pscube:') && pstation.length === 1 ? 'P-STATION' : storeLabel(s, true);
}

function exportedText(text) {
  const t = Date.parse(text ?? '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} 時点のデータ`;
}

function render() {
  const {model} = state;
  if (!model || !model.stores.length) return;
  const today = todayJst();
  const weeks = monthWeeks(state.year, state.month);
  const cells = weeks.flat().map(day => {
    if (!day) return '<div class="blank" aria-hidden="true"></div>';
    const racks = model.byDay.get(`${state.store}|${day}`) ?? [];
    // 台データの無い日は、保存したHTMLからの「何台中何台プラス」（day_summaries）で勝率を出す。
    const net = calendarDay(racks, model.summaries.get(`${state.store}|${day}`));
    const event = eventLabel(model.events.get(`${state.store}|${day}`));
    const date = Number(day.slice(8));
    const rate = net.winRate ? winRateText(net.won, net.judged) : '';
    const label = [`${state.month}月${date}日`, event,
      rate ? `${net.judged}台中${net.won}台プラス、${rate}` : net.total != null ? `総差枚 ${signed(net.total)}` : ''].filter(Boolean).join('、');
    const inner = `<span class="date num">${date}</span>`
      + (event ? `<span class="event">${esc(event)}</span>` : '')
      + (rate ? `<span class="net num zero">${rate}</span>`
        : net.total != null ? `<span class="net num ${tone(net.total)}">${compactSigned(net.total)}</span>` : '');
    const cls = `day${day === today.day ? ' today' : ''}`;
    return racks.length
      ? `<button type="button" class="${cls}" data-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      : net.summary ? `<button type="button" class="${cls}" data-summary-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      : `<div class="${cls}" aria-label="${esc(label)}">${inner}</div>`;
  }).join('');
  app.innerHTML = `
    <section class="hero">
      <p class="kicker">${esc(storeLabel(state.store))}</p>
      <h1 class="headline num">${state.year}年${state.month}月</h1>
      <p class="lede">日付を押すと、その日の差枚TOP50と強かった機種10選が見られます。</p>
    </section>
    <div class="stores">
      <span class="caption">店舗を選ぶ</span>
      <div class="anchors" role="group" aria-label="店舗">
        ${model.stores.map(s => `<button type="button" class="anchor" data-store="${esc(s)}" aria-pressed="${s === state.store}">${esc(switchLabel(s, model.stores))}</button>`).join('')}
      </div>
    </div>
    <div class="tools">
      <button type="button" class="pill pill-outline" data-idle-open>バラエティの回っていない台</button>
      ${Object.hasOwn(MERUHEN_STORES, state.store) ? `<button type="button" class="pill pill-outline" data-variety-open>バラエティ${RAINBOW}</button>` : ''}
      ${hasSuffixSummary(state.store) ? '<button type="button" class="pill pill-outline" data-suffix-open>末尾別データまとめ</button>' : ''}
    </div>
    <div class="months">
      <button type="button" class="pill pill-outline" data-month="-1" aria-label="前の月">‹ 前の月</button>
      <button type="button" class="pill pill-outline" data-month="0" ${state.year === today.y && state.month === today.m ? 'disabled' : ''}>今月</button>
      <button type="button" class="pill pill-outline" data-month="1" aria-label="次の月">次の月 ›</button>
    </div>
    <section class="stage" aria-label="イベントカレンダー">
      <div class="card">
        <div class="weekdays" aria-hidden="true">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
        <div class="grid">${cells}</div>
      </div>
      ${state.notice ? `<p class="legend" role="status">${esc(state.notice)}</p>` : ''}
      <p class="legend">${esc(exportedText(model.exportedAt))}${model.exportedAt ? '。' : ''}差枚＝その日の総差枚（メルヘンは推定）。差枚の分かる台が半分に満たない日（アナスロ補完の日など）は勝率＝プラスで終わった台の割合（グラフの終点で判定）。台のデータが無い日の勝率は、保存したアナスロのHTMLから数えたもの（押すと何台中何台プラスか）。＊＝前日までに入力した記録がないイベント。</p>
    </section>`;
}

const count = (n) => n.toLocaleString('en-US');
/** 確率（1/○○.○）。当たりが0回なら「—」。 */
const odds = (games, hits) => (hits > 0 && games > 0 ? `1/${(games / hits).toFixed(1)}` : '—');
const netCell = (r) => (r.net != null
  ? `<span class="value num ${tone(r.net)}" style="display:block">${signed(r.net)}${r.needsCheck ? '※' : ''}</span>`
  : '<span class="value num zero" style="display:block">—</span>');

/** 押せる行の並び。lead＝左の順位、main・right＝中身、attrs＝押したときに読む data-*、current＝印を付ける行。 */
function tapList(rows, start = 1) {
  return `<ol class="list"${start > 1 ? ` start="${start}"` : ''}>${rows.map(x => `
        <li${x.current ? ' class="current"' : ''}><button type="button" class="row" ${x.attrs}>
          ${x.lead !== '' ? `<span class="rank num">${x.lead}</span>` : ''}<span class="main">${x.main}</span><span class="right">${x.right}</span>
          <span class="chev" aria-hidden="true">›</span></button></li>`).join('')}</ol>`;
}

/** `2026-10-09` → `10月9日（金）`。 */
function dateLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${m}月${d}日（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

/** `2026-10-09` → `10/9`。 */
const shortDate = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

/** `2026-10-09` → `10/9（金）`（狭い選択欄用）。 */
const shortDateWeek = (day) => `${shortDate(day)}（${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}）`;

/** 台のその日のデータ（差枚、回転数・BB・RB・各確率、最大持玉／MY）。 */
function rackView({rack: r}) {
  const stats = [
    ['回転数', `${count(r.games)}G`], ['BB', count(r.bb)], ['RB', count(r.rb)],
    ['BB確率', odds(r.games, r.bb)], ['RB確率', odds(r.games, r.rb)], ['合成確率', odds(r.games, r.bb + r.rb)],
  ];
  if (r.output != null) stats.push([r.store.startsWith('pscube:') ? 'MY' : '最大持玉', count(r.output)]);
  const name = r.estimated ? '推定差枚' : '差枚';
  return `
      <p class="store">${esc(storeLabel(r.store))}　${dateLabel(r.day)}</p>
      <h2 id="sheet-title">${r.rack}番台${r.rainbow ? ` ${RAINBOW}` : ''}</h2>
      <p class="event-line">${esc(displayMachineName(r.machine))}</p>
      ${rainbowButton(r, 'mark-large')}
      ${storeHasRainbow(state.model.byDay, r.store)
        ? `<p class="event-line last-rainbow">最終${RAINBOW}：${lastRainbowText(lastRainbowDay(state.model.byDay, r.store, r.rack, r.day), r.day)}</p>` : ''}
      <p class="total"><span class="label">${name}</span>
        <span class="value num ${r.net != null ? tone(r.net) : 'zero'}">${r.net != null ? `${signed(r.net)}${r.needsCheck ? '※' : ''}` : '—'}</span>
        ${r.net == null ? `<span class="sub">${name}はわかりません。</span>` : ''}</p>
      <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>
      ${r.estimated && r.net != null ? `<p class="note">推定差枚はグラフと最大持玉からの計算で、確定値ではありません${r.needsCheck ? '（※は要確認）' : ''}。</p>` : ''}`;
}

/*
 * 画面ごとの日付送り（2026-10-12 利用者「下にいってるときも日付を変えられるようにして欲しい」「全部に日付送りが欲しい」）。
 * どの画面も上に固定した帯に「‹ 前の日・日付・次の日 ›」を出す。選べる日は、その画面に記録がある日（新しい順）。
 */

/** HTMLの集計だけがある日（台データの無い日、新しい順）。 */
function summaryDays(storeKey) {
  const out = [];
  for (const key of state.model.summaries.keys()) {
    const [s, day] = key.split('|');
    if (s === storeKey && !(state.model.byDay.get(key) ?? []).length && state.model.summaries.get(key).judged > 0) out.push(day);
  }
  return out.sort().reverse();
}

/** 画面の選べる日（新しい順）。台のデータは同じ店・機種・台番号の記録がある日、機種の台一覧はその機種がある日。 */
function daysOfView(view) {
  if (view.kind === 'variety' && view.mode === 'today') return [view.todayDay];
  const byDay = state.model.byDay;
  // 🌈の記録は本日（開いた日）から。取り込み前でも本日を選べる（2026-10-16 利用者「本日＝開いている日、見ている日に」）。
  if (view.kind === 'variety' && view.mode === 'grid') {
    return [...new Set([view.todayDay, ...storeDays(byDay, state.store)])].sort().reverse();
  }
  const has = (store, d, test) => (byDay.get(`${store}|${d}`) ?? []).some(test);
  if (view.kind === 'rack') {
    const r = view.rack;
    return storeDays(byDay, r.store).filter(d => has(r.store, d, x => x.machine === r.machine && x.rack === r.rack));
  }
  if (view.kind === 'summary') return summaryDays(state.store);
  const all = storeDays(byDay, state.store);
  if (view.kind === 'machine') return all.filter(d => has(state.store, d, x => x.machine === view.machine));
  return all;
}

const dayOfView = (view) => (view.kind === 'rack' ? view.rack.day : view.kind === 'variety' && view.mode === 'today' ? view.todayDay : view.day);

/** 画面の日を変える。台のデータは、その日の同じ店・機種・台番号の記録に切り替える。 */
function setViewDay(view, day) {
  if (view.kind === 'rack') {
    const r = view.rack;
    view.rack = (state.model.byDay.get(`${r.store}|${day}`) ?? []).find(x => x.machine === r.machine && x.rack === r.rack) ?? r;
  } else {
    view.day = day;
    view.picked = null;
  }
}

/** 上に固定する見出し（下まで送っても、何の画面か分かるように）。 */
function titleOfView(view) {
  if (view.kind === 'rack') return `${view.rack.rack}番台${view.rack.rainbow ? ` ${RAINBOW}` : ''}`;
  if (view.kind === 'machine') return displayMachineName(view.machine);
  if (view.kind === 'idle') return 'バラエティの回っていない台';
  if (view.kind === 'variety' && view.mode === 'today') return 'バラエティ🌈 本日';
  if (view.kind === 'variety') return view.mode === 'week' ? 'バラエティの候補' : `バラエティ${RAINBOW}一覧`;
  if (view.kind === 'suffix') return '末尾別データまとめ';
  if (view.kind === 'suffixList') return `${suffixLabel(view.suffix)}の内訳`;
  return 'その日のまとめ';
}

/**
 * 画面を重ねるシート（日付のシート・回っていない台・バラエティ🌈のシート）。[body] が画面ごとの中身、[onRow] が押せる行を
 * 押したとき（push で次の画面。いまの画面も渡す）、[onChange] が選択欄を変えたとき（rerender で描き直す）。
 * 上に固定した帯に、戻る・見出し・閉じると、日付送り（前の日・日付・次の日）。日を変えてもスクロール位置はそのまま。
 * 「戻る」（Esc）で前の画面へ、開いていた折りたたみ・スクロール位置のまま戻る。
 */
function openSheet({first, body, onRow, onChange, onAction}) {
  const views = [first];
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></div>';
  const sheet = backdrop.firstElementChild;
  const dateBar = (view) => {
    const days = daysOfView(view), day = dayOfView(view);
    const index = days.indexOf(day);
    return `<div class="date-bar">
        <button type="button" class="pill pill-outline step" data-day-step="1" aria-label="前の日"${index < 0 || index >= days.length - 1 ? ' disabled' : ''}>‹</button>
        <select data-sheet-day aria-label="表示する日付">${options(days.includes(day) ? days : [day, ...days], day, shortDateWeek)}</select>
        <button type="button" class="pill pill-outline step" data-day-step="-1" aria-label="次の日"${index <= 0 ? ' disabled' : ''}>›</button>
      </div>`;
  };
  const render = () => {
    const view = views[views.length - 1];
    sheet.innerHTML = `
      <div class="sheet-head">
        <div class="head-row">${views.length > 1 ? '<button type="button" class="pill pill-outline" data-back>‹ 戻る</button>' : ''}
          <span class="head-title">${esc(titleOfView(view))}</span>
          <button type="button" class="pill pill-outline" data-close>閉じる</button></div>
        ${dateBar(view)}
      </div>${body(view)}`;
    if (view.moreOpen) sheet.querySelector('details.more')?.setAttribute('open', '');
    sheet.scrollTop = view.scroll ?? 0;
    (sheet.querySelector('[data-back]') ?? sheet.querySelector('[data-close]')).focus({preventScroll: true});
  };
  const push = (view) => {
    const current = views[views.length - 1];
    current.scroll = sheet.scrollTop;
    current.moreOpen = sheet.querySelector('details.more')?.open ?? false;
    views.push(view);
    render();
  };
  const back = () => {
    views.pop();
    render();
  };
  // 日を変える。スクロール位置・折りたたみはそのまま（下の方を見ながら日を送れるように）。
  const changeDay = (view, day) => {
    view.scroll = sheet.scrollTop;
    view.moreOpen = sheet.querySelector('details.more')?.open ?? false;
    setViewDay(view, day);
    render();
  };
  const previous = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    previous?.focus?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (views.length > 1) back(); else close();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-back]')) return back();
    const view = views[views.length - 1];
    const step = e.target.closest('[data-day-step]');
    if (step) {
      const days = daysOfView(view);
      const next = days[days.indexOf(dayOfView(view)) + Number(step.dataset.dayStep)];
      if (next) changeDay(view, next);
      return;
    }
    // 🌈のボタン（台のデータ・バラエティ🌈）：付け外しして、すぐ描き直す（送るのは後ろで。送っている間も押せる）。
    const mark = e.target.closest('[data-rainbow]');
    if (mark) {
      if (view.kind === 'variety' && view.mode !== 'week' && view.todayDay !== todayJst().day) {
        // 開いたまま日付が変わった。本日の列を新しい日へ移し、確かめてから押してもらう（前の日の印に付けない）。
        const old = view.todayDay;
        view.todayDay = todayJst().day;
        if (view.mode === 'today' || view.day === old) {
          if (view.mode === 'grid') view.day = view.todayDay;
          toast(view.mode === 'grid' ? '日付が変わりました。表を確認してから押してください。'
            : '日付が変わりました。本日の一覧を確認してから押してください。');
          render();
          return;
        }
      }
      view.scroll = sheet.scrollTop;
      toggleRainbow(mark.dataset.rainbow);
      render();
      return;
    }
    // 画面の中の切り替え（例：バラエティ🌈の表・空き順）。描き直す。
    const action = e.target.closest('[data-variety-mode]');
    if (action && onAction) {
      view.scroll = 0;
      onAction(action, view);
      render();
      return;
    }
    const row = e.target.closest('button.row, button.row-link');
    if (row) onRow(row, push, view);
  });
  backdrop.addEventListener('change', (e) => {
    if (!e.target.matches('select')) return;
    const view = views[views.length - 1];
    if (e.target.matches('[data-sheet-day]')) { changeDay(view, e.target.value); return; }
    if (!onChange) return;
    onChange(e.target, view);
    view.scroll = sheet.scrollTop;
    render();
  });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);
  render();
}

/**
 * 日付を押したときのシート。その日の差枚TOP50（11位からは折りたたみ）・強かった機種10選 →
 * 台や機種を押すと、その日のその機種の台一覧 → 台を押すと、その台のその日のデータ（利用者指定 2026-10-10）。
 */
function openDay(first) {
  const racksOf = (day) => state.model.byDay.get(`${state.store}|${day}`) ?? [];
  if (!racksOf(first).length) return;
  const rankRows = (list, from, index) => list.map((r, i) => ({
    lead: from + i + 1, attrs: `data-machine-of="${index.get(r)}"`,
    main: `<span class="rack num">${r.rack}番${rackMark(r)}</span><span class="machine" style="display:block">${esc(displayMachineName(r.machine))}</span>`,
    right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
  }));
  const netNameOf = (racks) => (racks.some(r => r.estimated) ? '推定差枚' : '差枚');

  const dayView = (view) => {
    const racks = racksOf(view.day);
    view.items = racks;
    const index = new Map(racks.map((r, i) => [r, i]));
    const net = dayNet(racks);
    const {top, machines} = daySummary(racks);
    const estimated = racks.some(r => r.estimated);
    const netName = netNameOf(racks);
    const event = eventLabel(state.model.events.get(`${state.store}|${view.day}`));
    return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateLabel(view.day)}</h2>
      <p class="event-line">${event ? `イベント：${esc(event)}` : 'イベントなし'}</p>
      ${net.total != null ? `<p class="total"><span class="label">総${netName}</span>
        <span class="value num ${tone(net.total)}">${signed(net.total)}</span>
        <span class="sub num">${netName}がわかった台 ${net.captured}/${net.racks}台</span></p>` : ''}
      ${net.winRate ? `<p class="total" data-win-rate><span class="label">勝率</span>
        <span class="value num zero">${winRateText(net.won, net.judged)}</span>
        <span class="sub num">${net.judged}台中${net.won}台プラス（${netName}の分からない台が多い日）</span></p>` : ''}
      <h3>TOP50</h3>
      <p class="caption">${netName}の多い順。台を押すと、その機種の台一覧が見られます。</p>
      ${top.length ? tapList(rankRows(top.slice(0, TOP_RACKS_OPEN), 0, index))
        : '<p class="note">この日は差枚がわかる台がありません。</p>'}
      ${top.length > TOP_RACKS_OPEN ? `<details class="more"><summary>${TOP_RACKS_OPEN + 1}〜${top.length}位を見る（${top.length - TOP_RACKS_OPEN}台）</summary>
        ${tapList(rankRows(top.slice(TOP_RACKS_OPEN), TOP_RACKS_OPEN, index), TOP_RACKS_OPEN + 1)}</details>` : ''}
      <h3>強かった機種10選</h3>
      <p class="caption">1台あたりの平均回転数（2台以上ある機種）</p>
      ${machines.length ? tapList(machines.map((x, i) => ({
        lead: i + 1, attrs: `data-machine="${esc(x.machine)}"`,
        main: `<span class="machine" style="display:block">${esc(displayMachineName(x.machine))}</span>`,
        right: `<span class="value num" style="display:block">${count(x.average)}G</span><span class="small num">${x.racks}台</span>`,
      }))) : '<p class="note">2台以上ある機種がありません。</p>'}
      ${estimated ? '<p class="note">推定差枚はグラフと最大持玉からの計算で、確定値ではありません（※は要確認）。</p>' : ''}`;
  };

  const machineView = (view) => {
    const racks = racksOf(view.day);
    view.items = racks;
    const index = new Map(racks.map((r, i) => [r, i]));
    const netName = netNameOf(racks);
    const list = racks.filter(r => r.machine === view.machine).sort((a, b) => a.rack - b.rack);
    const nets = list.filter(r => r.net != null);
    const total = nets.length ? nets.reduce((s, r) => s + r.net, 0) : null;
    const average = list.length ? Math.round(list.reduce((s, r) => s + r.games, 0) / list.length) : 0;
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateLabel(view.day)}</p>
      <h2 id="sheet-title" class="long">${esc(displayMachineName(view.machine))}</h2>
      <p class="event-line num">${list.length}台・平均${count(average)}G</p>
      ${total != null ? `<p class="total"><span class="label">この機種の総${netName}</span>
        <span class="value num ${tone(total)}">${signed(total)}</span>
        <span class="sub num">${netName}がわかった台 ${nets.length}/${list.length}台</span></p>` : ''}
      <h3>台一覧</h3>
      <p class="caption">台番号の順。台を押すと、その台のデータが見られます。</p>
      ${tapList(list.map(r => ({
        lead: '', attrs: `data-rack="${index.get(r)}"`, current: !!view.picked && r.rack === view.picked.rack,
        main: `<span class="machine num" style="display:block">${r.rack}番${rackMark(r)}</span><span class="rack num">BB ${r.bb}・RB ${r.rb}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      })))}`;
  };

  openSheet({
    first: {kind: 'day', day: first},
    body: (view) => (view.kind === 'day' ? dayView(view) : view.kind === 'machine' ? machineView(view) : rackView(view)),
    // 押した行は、いま出している画面の日の台（描いたときの items）から選ぶ。
    onRow: (row, push, view) => {
      const racks = view.items ?? [];
      if (row.dataset.rack != null) push({kind: 'rack', rack: racks[Number(row.dataset.rack)]});
      else if (row.dataset.machineOf != null) {
        const picked = racks[Number(row.dataset.machineOf)];
        push({kind: 'machine', machine: picked.machine, picked, day: view.day});
      } else push({kind: 'machine', machine: row.dataset.machine, day: view.day});
    },
  });
}

// 回っていない台の選択（期間・ゲーム数）を覚える名前。閲覧ページ（自分用）の保存名とは別。
const IDLE_DAYS_KEY = 'database-share-idle-days';
const IDLE_GAMES_KEY = 'database-share-idle-games';

/** 覚えた選択。選択肢に無い値（古い・壊れた値）は既定値に戻す。 */
function remembered(key, choices, fallback) {
  const value = Number(store.get(key));
  return choices.includes(value) ? value : fallback;
}

const options = (values, selected, text) =>
  values.map(v => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(text(v))}</option>`).join('');

/**
 * バラエティの回っていない台（利用者指定 2026-10-11「この機能は共有で見るほうにも作ってもらいたい。ほぼ仕様同じでOK」）。
 * 自分用の閲覧ページ（variety_idle.dart）と同じ数え方：その日1〜3台の機種の台で、選んだ日から前へ、記録のある日が
 * どれも選んだゲーム数未満のまま、選んだ日数（カレンダーの日数）以上続いている台。台を押すとその台のデータ。
 */
function openIdle() {
  const days = storeDays(state.model.byDay, state.store);
  if (!days.length) return;
  const idleView = (view) => {
    const racks = idleVarietyRacks(state.model.byDay, state.store, view.day, {minDays: view.minDays, gamesLimit: view.games});
    view.racks = racks;
    const games = `${count(view.games)}G`;
    return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title" class="long">バラエティの回っていない台</h2>
      <div class="choices two">
        <label><span>期間</span><select data-idle="minDays">${options(IDLE_DAY_CHOICES, view.minDays, d => `${d}日以上`)}</select></label>
        <label><span>ゲーム数</span><select data-idle="games">${options(IDLE_GAMES_CHOICES, view.games, g => `${count(g)}G未満`)}</select></label>
      </div>
      <p class="caption">バラエティ（その日1〜${varietyMaxRacksFor(state.store)}台の機種）の台で、選んだ日から前へ${view.minDays}日（カレンダーの日数）以上、毎日${games}未満の台です。記録の無い日（サイトが落ちていた日など）は飛ばして数えます。期間の長い順。台を押すとその台のデータが見られます。</p>
      ${racks.length ? `<h3 class="num">${racks.length}台</h3>${tapList(racks.map((x, i) => ({
        lead: '', attrs: `data-idle-rack="${i}"`,
        main: `<span class="rack num">${x.latest.rack}番${rackMark(x.latest)}</span><span class="machine" style="display:block">${esc(displayMachineName(x.latest.machine))}</span>`
          + `<span class="detail num">${x.span}日間 ${games}未満（${shortDate(x.from)}〜${x.days.length < x.span ? `、記録のある日${x.days.length}日` : ''}）・最多${count(x.maxGames)}G<br>`
          + `${x.days.slice(0, 7).map(r => count(r.games)).join('・')}G${x.days.length > 7 ? '…' : ''}</span>`,
        right: `<span class="value num" style="display:block">${count(x.latest.games)}G</span>`,
      })))}` : '<p class="note">当てはまる台はありません。入れ替えたばかりの台や、記録が足りない日は数えられません。期間・ゲーム数・日付を変えてみてください。</p>'}`;
  };
  const first = {
    kind: 'idle', day: days[0],
    minDays: remembered(IDLE_DAYS_KEY, IDLE_DAY_CHOICES, IDLE_DEFAULT_DAYS),
    games: remembered(IDLE_GAMES_KEY, IDLE_GAMES_CHOICES, IDLE_DEFAULT_GAMES),
  };
  openSheet({
    first,
    body: (view) => (view.kind === 'idle' ? idleView(view) : rackView(view)),
    // 押した行は、いま出している一覧（描いたときの racks）から選ぶ。
    onRow: (row, push, view) => {
      if (row.dataset.idleRack != null) push({kind: 'rack', rack: view.racks[Number(row.dataset.idleRack)].latest});
    },
    onChange: (select, view) => {
      if (select.dataset.idle === 'minDays') {
        view.minDays = Number(select.value);
        store.set(IDLE_DAYS_KEY, String(view.minDays));
      }
      if (select.dataset.idle === 'games') {
        view.games = Number(select.value);
        store.set(IDLE_GAMES_KEY, String(view.games));
      }
    },
  });
}

/** この端末で付け外しした🌈。 */
function localMarks() {
  try {
    const list = JSON.parse(store.get(MARKS_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 🌈を付ける・外すボタン（メルヘンの台だけ）。押すと toggleRainbow。 */
function rainbowButton(r, size = 'mark-small') {
  if (!Object.hasOwn(MERUHEN_STORES, r.store)) return '';
  const label = r.rainbow ? `${RAINBOW} 外す` : `${RAINBOW} 付ける`;
  return `<button type="button" class="pill ${r.rainbow ? 'pill-blue' : 'pill-outline'} mark-btn ${size}" `
    + `data-rainbow="${esc(`${r.store}|${r.day}|${r.rack}`)}" aria-pressed="${r.rainbow}" aria-label="${r.rack}番台の${label}">${label}</button>`;
}

/** 知らせ（数秒で消える）。 */
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('p');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

/**
 * 🌈を付け外しする（2026-10-11、RAINBOW.md「共有ページから付ける」）。すぐ表示に入れ、この端末に残し、
 * スクリプトへこの端末の印を全部送る（送れなかった分も次に届く）。PCは同期フォルダに届いたファイルを取り込む。
 * 表示と端末への保存は最初の await より前に済ませる（呼んだ直後に描き直せる。送るのは後ろで。2026-10-12、送っている
 * 数秒の間ボタンを押せなくしていたため、iPhoneで「外す」の文字が薄く見えていた）。
 */
async function toggleRainbow(key) {
  const [s, day, rackText] = key.split('|');
  const rack = Number(rackText);
  const actual = (state.model?.byDay.get(`${s}|${day}`) ?? []).find(x => x.rack === rack);
  const pending = day === todayJst().day && s === state.store
    ? rainbowTodayRows(state.model.byDay, state.model.marks, s, day).rows.find(x => x.rack === rack)?.marker : null;
  const r = actual ?? pending;
  if (!r) return;
  const old = localMarks().find(m => m.store === s && m.day === day && m.rack === rack);
  const mark = {store: s, day, rack, on: !r.rainbow, updated_at: markTime(Date.now(), r.rainbowAt, old?.updated_at)};
  const marks = mergeMarks(localMarks(), [mark]);
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  } catch {
    toast('🌈をこの端末に保存できませんでした。空き容量やブラウザの保存設定を確認して、もう一度押してください。');
    return;
  }
  r.rainbow = mark.on;
  r.rainbowAt = mark.updated_at;
  state.model.marks = mergeMarks(state.model.marks, [mark]);
  const done = mark.on ? `${rack}番台に${RAINBOW}を付けました。` : `${rack}番台の${RAINBOW}を外しました。`;
  try {
    const response = await fetch(`https://script.google.com/macros/s/${state.id}/exec`, {
      method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, credentials: 'omit',
      body: JSON.stringify({file: 'rainbow', marks}),
    });
    const result = await response.json();
    toast(result.ok ? `${done}共有しました。` : `${done}（この端末には残しました。共有には送れませんでした：${result.error ?? '返事が読めません'}）`);
  } catch (error) {
    toast(`${done}（この端末には残しました。共有には送れませんでした。次に付け外しするときにまた送ります）`);
  }
}

// 見せ方（2026-10-12 利用者「AとBを切り替え」）：grid＝ローテーション表、gap＝空き順。
const VARIETY_MODES = {week: '候補', grid: '🌈の記録', today: '本日'};

/**
 * バラエティ🌈（2026-10-11 利用者「共有の方にも店舗別のバラエティ一覧つけて同じようにしたい」、2026-10-12「何かこうしてみると
 * 見づらいので見やすい方法を」→「AとBを切り替え」）。並べる台と機種名はその店の最新の記録の日のバラエティ（幸町は1台だけの機種、
 * ほかは1〜3台）。上の帯の日付が「選んだ日」。🌈の記録は本日（開いた日）を選んだ日にして開く（2026-10-16 利用者
 * 「青い枠で囲まれてるところが本日みたいな雰囲気でてしまうので、本日＝開いている日、見ている日に」）。本日の数値が未取得でも、
 * 幸町は取り込み前の印（「本日」と同じ）を付け外しできる。
 *   表（ローテーション表）：台を縦、選んだ日までの7日を横（選んだ日の列が青い枠）。🌈の日のマスに色。マスを押すとその日の🌈を付け外し。右端＝最後の🌈から何日。
 *   空き順：最後の🌈から長い台が上。右の🌈で選んだ日の付け外し。
 * 台番号（行の左）を押すと、その台の選んだ日のデータ。
 */
function openVariety() {
  const days = storeDays(state.model.byDay, state.store);
  if (!days.length) return;
  const savedMode = store.get(VARIETY_MODE_KEY);
  const modes = state.store === 'saiwaichou' ? VARIETY_MODES : {grid: '🌈の記録'};
  const today = todayJst().day;
  const mode = Object.hasOwn(modes, savedMode) ? savedMode : state.store === 'saiwaichou' ? 'week' : 'grid';
  // 候補は記録のある最新の日のまま。
  const first = {kind: 'variety', day: mode === 'grid' ? today : days[0], todayDay: today, mode, sort: store.get(VARIETY_SORT_KEY) === 'gap' ? 'gap' : 'grid'};
  const gapText = (x, day) => {
    const n = daysSinceRainbow(x.last, day);
    return n == null ? 'なし' : n === 0 ? '当日' : `${n}日`;
  };
  const header = (view, rows) => {
    const marked = rows.filter(x => x.mark?.rainbow).length;
    const kinds = rainbowVarietyMax(state.store) === 1 ? '1台だけの機種' : `1〜${rainbowVarietyMax(state.store)}台の機種`;
    // 見出しは上に固定した帯（バラエティ🌈一覧）だけにする（大きな見出しを重ねると見づらいため。2026-10-12）。
    return `
      <h2 id="sheet-title" class="sr-only">${view.mode === 'week' ? 'バラエティの候補' : `バラエティ${RAINBOW}一覧`}</h2>
      <div class="segmented" role="group" aria-label="見せ方">${Object.entries(modes).map(([key, label]) =>
        `<button type="button" class="pill ${view.mode === key ? 'pill-blue' : 'pill-outline'}" data-variety-mode="${key}" aria-pressed="${view.mode === key}">${label}</button>`).join('')}</div>
      ${view.mode === 'week' || view.mode === 'today' ? '' : `<p class="caption">${esc(storeLabel(state.store))}・記録のそろった最新の日に${kinds}の台（入れ替えは自動で変わります）。${rows.length}台・${dateLabel(view.day)}${view.day === view.todayDay ? '（本日）' : ''}の${RAINBOW} ${marked}台。</p>`}
      ${view.mode === 'grid' && view.day === view.todayDay && !rows.some(x => x.record) ? `<p class="note">本日分の数値はまだ取り込まれていません。${
        state.store === 'saiwaichou' ? `${RAINBOW}は取り込み前でも付けられ、取り込み後に引き継がれます。` : `${RAINBOW}は取り込み後に付けられます。`}</p>` : ''}`;
  };
  const gridView = (view, rows) => {
    const window = windowDays(view.day);
    const head = window.map(d => `<span class="d num${d === view.day ? ' today' : ''}">${Number(d.slice(8))}</span>`).join('');
    return `<p class="caption">マスを押すとその日の${RAINBOW}を付け外し（記録の無い日は押せません）。右端＝最後の${RAINBOW}から何日。台番号を押すとその台のデータ。</p>
      <div class="rotation" role="table" aria-label="ローテーション表">
        <div class="r head" role="row"><span class="who">台</span>${head}<span class="gap">日数</span></div>
        ${rows.map((x, i) => `<div class="r" role="row">
          <button type="button" class="who row-link" data-variety-rack="${i}"${x.open ? '' : ' disabled'}><span class="num">${x.rack}</span><span class="m">${esc(displayMachineName(x.machine))}</span></button>
          ${rackDays(state.model.byDay, state.store, x.rack, window).map((r, k) => (window[k] === view.day ? x.mark : r)).map((r, k) => (r
            ? `<button type="button" class="c${r.rainbow ? ' on' : ''}${window[k] === view.day ? ' today' : ''}" data-rainbow="${esc(`${r.store}|${r.day}|${r.rack}`)}" aria-pressed="${r.rainbow}" aria-label="${x.rack}番台 ${shortDate(window[k])}の${RAINBOW}${r.rainbow ? 'を外す' : 'を付ける'}">${r.rainbow ? RAINBOW : ''}</button>`
            : `<span class="c none" aria-label="${x.rack}番台 ${shortDate(window[k])} 記録なし">·</span>`)).join('')}
          <span class="gap num">${gapText(x, view.day)}</span></div>`).join('')}
      </div>`;
  };
  const gapView = (view, rows) => `<p class="caption">最後の${RAINBOW}が古い台から表示。${RAINBOW}の記録がない台は先頭です。右の${RAINBOW}で${shortDate(view.day)}の付け外し。行を押すとその台のデータ。</p>
      <ol class="list">${byLongestGap(rows, view.day).map(x => {
        const r = x.mark, i = rows.indexOf(x);
        return `<li class="with-mark">${x.open ? `<button type="button" class="row" data-variety-rack="${i}">` : '<div class="row">'}
          <span class="main"><span class="rack num">${x.rack}番${r?.rainbow ? RAINBOW : ''}</span><span class="machine" style="display:block">${esc(displayMachineName(x.machine))}</span></span>
          <span class="right"><span class="value num big-gap" style="display:block">${gapText(x, view.day)}</span><span class="small num">最後の${RAINBOW}${x.last ? ` ${shortDate(x.last)}` : ''}</span></span>
          ${x.open ? '<span class="chev" aria-hidden="true">›</span></button>' : '</div>'}${r ? rainbowButton(r) : ''}</li>`;
      }).join('')}</ol>`;
  const recordsView = (view, rows) => `<label class="variety-sort">並べ方 <select data-variety-sort aria-label="並べ方">
      <option value="grid"${view.sort !== 'gap' ? ' selected' : ''}>台番号順（7日表）</option>
      <option value="gap"${view.sort === 'gap' ? ' selected' : ''}>最後の🌈が古い順</option></select></label>`
    + (view.sort === 'gap' ? gapView(view, rows) : gridView(view, rows));
  const weekView = (view, rows) => {
    const report = varietyWeek(state.model.byDay, state.store, view.day);
    view.weekRows = report.rows;
    const group = (list, id) => `<div data-week-group="${id}">${list.length ? `<ol class="candidate-list">${list.map(x => {
        const best = x.high[0];
        const details = [
          ...(best ? [`最高 ${best.score.total.toFixed(1)}点（${shortDate(best.record.day)}・${best.score.provisional ? '暫定' : '参考'}）`] : []),
          x.observedDays === 7 ? '7日分の記録あり' : `記録${x.observedDays}/7日・未取得${7 - x.observedDays}日`,
          ...(id === 'marked' ? [`🌈の記録 ${x.rainbowDays}日`] : []),
          ...(x.records.some(r => r.machine !== x.machine) ? ['入れ替え前の機種を含む台番号の履歴'] : []),
        ];
        return `<li><button type="button" class="row row-link candidate-card" data-week-rack="${report.rows.indexOf(x)}">
          <span class="main"><span class="candidate-title"><span class="rack num">${x.rack}番</span><span class="machine">${esc(displayMachineName(x.machine))}</span></span>
          <span class="candidate-status${best ? ' high' : ''}">${best ? '70点以上あり' : '70点以上の記録なし'}</span>
          <span class="candidate-detail">${details.map(esc).join('<br>')}</span></span><span class="chev" aria-hidden="true">›</span>
          </button></li>`;
      }).join('')}</ol>` : '<p class="note">候補はありません</p>'}</div>`;
    const marked = report.rows.filter(x => x.rainbowDays > 0);
    return `<h3 class="candidate-heading">7日間🌈なしの候補</h3><p class="candidate-period">${report.days[0]}〜${report.days.at(-1)}</p>
      <p class="caption">幸町・1台機種。選んだ日を含む7日間に🌈の記録がない台です。70点以上の日がある台も候補に残し、点数を添えます。</p>
      <h4 class="candidate-count">候補 ${report.noRainbow.length}台</h4>
      ${group(report.noRainbow, 'none')}
      ${report.noRainbow.some(x => x.observedDays < 7) ? '<p class="note">未取得の日の🌈はわかりません。</p>' : ''}
      <details class="week-marked"><summary>🌈が付いた台（${marked.length}台）</summary>${group(marked, 'marked')}</details>
      ${report.unknown.length ? `<p class="note">記録がない台：${report.unknown.length}台（候補に含めていません）</p>` : ''}`;
  };
  const varietyView = (view) => {
    if (view.mode === 'today') {
      const report = rainbowTodayRows(state.model.byDay, state.model.marks, state.store, view.todayDay);
      return header(view, []) + `<h3>本日 ${esc(view.todayDay)}</h3>
        <p class="caption">確定を見た台に、その場で🌈を付けられます。データ取り込み後も印は引き継がれます。</p>
        <p class="note">${report.lineupDay ? `機種一覧：${esc(report.lineupDay)}の取り込み済みデータを参照（幸町・1台機種）` : '参照できる機種一覧がありません。先にデータを読み込んでください。'}</p>
        <p>本日の🌈 ${report.rows.filter(x => x.marker.rainbow).length}台</p>
        <ol class="list" data-today-racks>${report.rows.map(x => `<li class="with-mark"><div class="row">
          <span class="main"><span class="rack num">${x.rack}番${rackMark(x.marker)}</span>
          <span class="machine" style="display:block">${esc(displayMachineName(x.marker.machine))}</span>
          <span class="small">本日分 ${x.imported ? '取り込み済み' : '未取得'}</span></span></div>${rainbowButton(x.marker)}</li>`).join('')}</ol>`;
    }
    const rows = varietyRecordRows(state.model.byDay, state.model.marks, state.store, view.day, view.todayDay);
    view.rows = rows;
    if (!rows.length) return `${header(view, rows)}<p class="note">この店はバラエティの台の記録がありません。</p>`;
    return header(view, rows) + (view.mode === 'week' ? weekView(view, rows) : recordsView(view, rows));
  };
  openSheet({
    first,
    body: (view) => (view.kind === 'variety' ? varietyView(view) : rackView(view)),
    onRow: (row, push, view) => {
      if (row.dataset.weekRack != null) {
        const r = view.weekRows[Number(row.dataset.weekRack)]?.openRecord;
        if (r) push({kind: 'rack', rack: r});
        return;
      }
      const x = row.dataset.varietyRack != null ? view.rows[Number(row.dataset.varietyRack)] : null;
      if (x?.open) push({kind: 'rack', rack: x.open});
    },
    onAction: (button, view) => {
      if (button.dataset.varietyMode) {
        view.mode = button.dataset.varietyMode;
        view.todayDay = todayJst().day;
        // 🌈の記録は本日（開いた日）から。候補は記録のある日だけなので、本日が未取得なら最新の記録の日へ。
        if (view.mode === 'grid') view.day = view.todayDay;
        if (view.mode === 'week' && !days.includes(view.day)) view.day = days[0];
        store.set(VARIETY_MODE_KEY, view.mode);
      }
    },
    onChange: (select, view) => {
      if (select.matches('[data-variety-sort]')) {
        view.sort = select.value;
        store.set(VARIETY_SORT_KEY, view.sort);
      }
    },
  });
}

/*
 * 末尾別データまとめ（2026-10-12 利用者「幸町にもつくってもらうだけでいい」。閲覧ページ・Android版と同じ末尾・ゾロ目）。
 * 上の帯の日付が「選んだ日」。比較期間（選択日・過去7日・過去30日）、末尾の順位（このページは採点が無いので平均差枚の順）、
 * すべての末尾、日別の首位（直近7記録日）。末尾を押すとその末尾の台（日ごと）→ 台を押すとその台のデータ。
 */
function openSuffix() {
  const days = storeDays(state.model.byDay, state.store);
  if (!days.length) return;
  const net = (v) => (v == null ? '—' : signed(Math.round(v)));
  const average = (v) => (v == null ? '—' : v.toFixed(1));
  const reportOf = (view) => suffixReport(state.model.byDay, state.store, view.day, SUFFIX_PERIODS[view.period][1]);
  const suffixRow = (report, s) => ({
    lead: s.averageNet == null ? '' : `${report.rankOf(s)}位`,
    attrs: `data-suffix="${s.suffix}"`,
    main: `<span class="rack">${esc(s.label)}</span><span class="machine" style="display:block">平均G ${average(s.averageGames)}・${s.racks}台・${s.records}件</span>`,
    right: `<span class="value num ${s.averageNet == null ? 'zero' : tone(s.averageNet)}" style="display:block">${net(s.averageNet)}</span>`
      + `<span class="small num">差枚あり${s.nets}件・プラス${s.nets ? Math.round(s.plus / s.nets * 100) : 0}%</span>`,
  });
  const ranking = (report, title) => {
    const top = report.ranked.filter(s => report.rankOf(s) <= 3);
    const body = top.length
      ? `<p class="caption">平均差枚の首位：${report.leaders.map(s => esc(s.label)).join('・')}${report.leaders.length > 1 ? '（同じ）' : ''}</p>${tapList(top.map(s => suffixRow(report, s)))}`
      : `<p class="note">${report.records ? '差枚の分かった台がありません。' : '対象の記録がありません。'}</p>`;
    return `<h3 class="sheet-sub">${esc(title)}</h3>${body}`;
  };
  const suffixView = (view) => {
    const report = reportOf(view);
    const recent = storeDays(state.model.byDay, state.store).filter(d => d <= view.day).slice(0, 7);
    const daily = recent.map(d => ({d, r: suffixReport(state.model.byDay, state.store, d, 1)}));
    const periodLabel = SUFFIX_PERIODS[view.period][0];
    const endings = zoromeEndingsOf(state.store).map(n => String(n).padStart(2, '0')).join('・');
    const pscube = /^pscube:/.test(state.store);
    const netName = pscube ? '差枚（サイトの差枚）' : '推定差枚。ジャグラーオンラインの差枚があればそれ';
    const title = view.period === 'day' ? `${dateLabel(view.day)}の末尾順位` : `${periodLabel}（${shortDate(report.start)}〜${shortDate(view.day)}）の末尾順位`;
    return `<h2 id="sheet-title" class="sr-only">末尾別データまとめ</h2>
      <p class="caption">${esc(storeLabel(state.store))}・末尾${suffixesOf(state.store).join('・')}とゾロ目（下2桁が${endings}。末尾の集計にも入る）。順位は平均差枚（${netName}）の高い順です。</p>
      <label class="caption">比較期間 <select data-suffix-period>${Object.entries(SUFFIX_PERIODS).map(([k, [label]]) => `<option value="${k}"${k === view.period ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      ${ranking(report, title)}
      <details class="more"><summary>すべての末尾・ゾロ目を見る</summary>${tapList(report.summaries.map(s => suffixRow(report, s)))}</details>
      <h3 class="sheet-sub">日別の首位（直近${daily.length}記録日）</h3>
      <p class="caption">日付を押すと、その日の末尾順位へ。</p>
      ${tapList(daily.map(({d, r}) => ({
        lead: '', attrs: `data-suffix-day="${d}"`, current: d === view.day,
        main: `<span class="rack">${esc(shortDateWeek(d))}</span>`,
        right: `<span class="value num" style="display:block">${r.leaders.length ? r.leaders.map(s => esc(s.label)).join('・') : '—'}</span>`
          + `<span class="small num">${r.leaders.length ? `平均 ${net(r.leaders[0].averageNet)}` : '差枚なし'}</span>`,
      })))}
      <p class="note">${shortDate(report.start)}〜${shortDate(view.day)}：記録${report.days}日・${report.racks}台・${report.records}件（台×日）。平均差枚は差枚の分かった台だけ。プラス＝差枚がプラスの台の割合。閲覧ページ・Android版の同じ画面は採点の平均点で順位を付けます。</p>`;
  };
  const listView = (view) => {
    const s = reportOf(view).summaries.find(x => x.suffix === view.suffix);
    view.entries = s.entries;
    if (!s.entries.length) return `<h2 id="sheet-title" class="sr-only">${esc(s.label)}の内訳</h2><p class="note">この期間に${esc(s.label)}の台はありません。</p>`;
    const listDays = [...new Set(s.entries.map(r => r.day))];
    return `<h2 id="sheet-title" class="sr-only">${esc(s.label)}の内訳</h2>
      <p class="caption">${esc(storeLabel(state.store))}・${s.racks}台・${listDays.length}日・${s.records}件。平均差枚 ${net(s.averageNet)}・平均G ${average(s.averageGames)}。台を押すとその台のデータ。</p>
      ${listDays.map(d => `<h3 class="sheet-sub">${esc(dateLabel(d))}</h3>${tapList(s.entries.map((r, i) => [r, i]).filter(([r]) => r.day === d).map(([r, i]) => ({
        lead: '', attrs: `data-suffix-rack="${i}"`,
        main: `<span class="rack num">${r.rack}番${rackMark(r)}</span><span class="machine" style="display:block">${esc(displayMachineName(r.machine))}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      })))}`).join('')}`;
  };
  openSheet({
    first: {kind: 'suffix', day: days[0], period: 'day'},
    body: (view) => (view.kind === 'suffix' ? suffixView(view) : view.kind === 'suffixList' ? listView(view) : rackView(view)),
    onRow: (row, push, view) => {
      if (row.dataset.suffix != null) push({kind: 'suffixList', day: view.day, period: view.period, suffix: Number(row.dataset.suffix)});
      else if (row.dataset.suffixDay) push({kind: 'suffix', day: row.dataset.suffixDay, period: 'day'});
      else if (row.dataset.suffixRack != null) push({kind: 'rack', rack: view.entries[Number(row.dataset.suffixRack)]});
    },
    onChange: (select, view) => {
      if (select.matches('[data-suffix-period]')) view.period = select.value;
    },
  });
}

function showSetup(message) {
  state.model = null;
  reload.hidden = true;
  app.innerHTML = `
    <section class="hero">
      <p class="kicker">database カレンダー</p>
      <h1 class="headline">閲覧専用</h1>
    </section>
    <form class="panel" id="setup">
      <p>${esc(message ?? '受け取ったリンクから開いてください。リンクを貼り付けても開けます。')}</p>
      <input class="field" id="link" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="受け取ったリンク" aria-label="受け取ったリンク">
      <button class="pill pill-blue" type="submit">開く</button>
    </form>`;
  app.querySelector('#setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = scriptIdFrom(app.querySelector('#link').value);
    if (!id) { showSetup('リンクの形が違います。受け取ったリンクをそのまま貼り付けてください。'); return; }
    connect(id);
  });
}

function rememberName(fromLink) {
  if (fromLink) store.set(NAME_KEY, fromLink);
  const name = fromLink ?? store.get(NAME_KEY);
  state.name = name && NAME.test(name) ? name : null;
}

async function connect(id) {
  if (state.id !== id) state.model = null;
  state.loading = false; reload.disabled = false;
  state.id = id;
  store.set(ID_KEY, id);
  reload.hidden = false;
  const base = `https://script.google.com/macros/s/${id}/exec`;
  try {
    const results = await Promise.allSettled([readViewerHistory(base, 'meruhen'), readViewerHistory(base, 'pscube'), readOfflineMetadata(id)]);
    const [m, p, metadata] = results.map(r => r.status === 'fulfilled' ? r.value : null);
    if (state.id !== id) return;
    if (m || p) {
      state.notice = results.some(r => r.status === 'rejected')
        ? '一部の保存データを開けませんでした。「最新を読む」で復元してください。'
        : '端末に保存したデータを表示しています。更新するには「最新を読む」を押してください。';
      showDocuments(m, p, metadata || {}); return;
    }
    if (results.some(r => r.status === 'rejected')) throw new Error('保存した履歴を開けませんでした。');
  } catch {
    if (state.id !== id) return;
    app.innerHTML = '<p class="status">保存したデータを開けませんでした。オンラインで右上の「最新を読む」を押してください。保存データは消していません。</p>';
    return;
  }
  if (state.id === id) load();
}

/**
 * 台データの無い日を押したとき：保存したアナスロのHTMLから数えた、その日の勝率と何台中何台プラスか（台の一覧は無い）。
 * 日付送りは、同じくHTMLの集計だけがある日（2026-10-18 利用者「各日の勝率、何台中何台プラスで終わったかをそれだけを」）。
 */
function openSummary(first) {
  if (!state.model.summaries.get(`${state.store}|${first}`)) return;
  openSheet({
    first: {kind: 'summary', day: first},
    body: (view) => {
      const s = state.model.summaries.get(`${state.store}|${view.day}`);
      const event = eventLabel(state.model.events.get(`${state.store}|${view.day}`));
      return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateLabel(view.day)}</h2>
      <p class="event-line">${event ? `イベント：${esc(event)}` : 'イベントなし'}</p>
      <p class="total" data-win-rate><span class="label">勝率</span>
        <span class="value num zero">${winRateText(s.won, s.judged)}</span>
        <span class="sub num">${s.judged}台中${s.won}台プラス</span></p>
      <p class="note">保存したアナスロのHTMLから数えた、この日の勝ち負けだけです。グラフの終点がゼロ線より上で終わった台をプラスとし、回っていない台・終わり方の分からない台は数えていません（この日の台 ${s.racks}台）。台ごとのデータはこのページにはありません。</p>`;
    },
    onRow: () => {},
  });
}

app.addEventListener('click', (e) => {
  const target = e.target.closest('[data-open], [data-summary-open], [data-store], [data-month], [data-idle-open], [data-variety-open], [data-suffix-open]');
  if (!target || !state.model) return;
  if (target.dataset.open) { openDay(target.dataset.open); return; }
  if (target.dataset.summaryOpen) { openSummary(target.dataset.summaryOpen); return; }
  if (target.dataset.idleOpen != null) { openIdle(); return; }
  if (target.dataset.varietyOpen != null) { openVariety(); return; }
  if (target.dataset.suffixOpen != null) { openSuffix(); return; }
  if (target.dataset.store) {
    state.store = target.dataset.store;
    store.set(STORE_KEY, state.store);
  } else {
    const step = Number(target.dataset.month);
    const today = todayJst();
    const index = step === 0 ? today.y * 12 + today.m - 1 : state.year * 12 + state.month - 1 + step;
    state.year = Math.floor(index / 12);
    state.month = index % 12 + 1;
  }
  render();
});
reload.addEventListener('click', () => { if (!state.loading && state.id) load(); });

function start() {
  const today = todayJst();
  state.year = today.y;
  state.month = today.m;
  // リンクの # の後ろの s=（スクリプトのID）と u=（呼び名）を覚え、アドレス欄からは消す（ほかへ貼ったときに広がらないように）。
  rememberName(viewerNameFrom(location.hash));
  const fromHash = scriptIdFrom(location.hash);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const id = fromHash ?? scriptIdFrom(store.get(ID_KEY));
  if (id) connect(id);
  else showSetup();
  // 開いたままのタブでリンクを開き直したとき（# の後ろだけ変わる）も読み込む。
  window.addEventListener('hashchange', () => {
    const next = scriptIdFrom(location.hash);
    rememberName(viewerNameFrom(location.hash));
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (next) connect(next);
  });
}

prepareOffline().catch(() => { /* オフライン用ファイルの取得失敗は次回オンライン起動で再試行。 */ });
start();
