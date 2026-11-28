import {RECOMMENDATION_TYPE, recommendationPlans, recommendationDays, recommendationRows, recommendationFace, RECOMMENDATION_FACES, recommendationResult, recommendationResultKey, mergeRecommendationResults, recommendationNotOlder, recommendationEditMs} from './recommendations.mjs?v=ab4efe3c08f3';
import {updateStatusLines} from './capture_health.mjs?v=ab4efe3c08f3';
import {openDailyLearning, defaultDailyTarget} from './daily_learning.mjs?v=ab4efe3c08f3';
import {HISTORY_TYPES, parsePrivateHistory, historyDay, historySavedName, historyCell, historyEditKey, mergeHistoryCells, newHistoryCell} from './event_history.mjs?v=ab4efe3c08f3';
// 閲覧専用の共有ページ（お試し、2026-10-09。EVENT_CALENDAR.md「閲覧専用の共有ページ」）。
// 読むだけのApps Script（database_android/tool/viewer_drive_script_readonly.gs）からDriveのファイルを読み、
// イベントカレンダー（各日のイベント・総差枚）と、日付を押したときの差枚TOP50（11位からは折りたたみ）・強かった機種10選、
// バラエティの回っていない台（期間・ゲーム数を選べる）、バラエティ🌈（確定が出た台の印を付ける一覧）を出す。
// 書き込むのは🌈だけ（2026-10-11、RAINBOW.md「共有ページから付ける」。スクリプトが database-rainbow-shared.json に足し込む）。
// 差分読み込み用の日別キャッシュもIndexedDBに保存する。端末に覚える設定は接続先（スクリプトのID）・選んだ店・回っていない台の期間とゲーム数・バラエティ🌈の並べ方・付けた🌈だけで、
// 利用者自身の閲覧ページ（database-viewer の保存名）とは別の名前を使う。スクリプトのIDはページに書かず、渡すリンクの # の後ろに付ける。
import {fetchViewerDocument, readViewerHistory, rememberViewerHistory, viewerHistoryCovers} from './viewer_parts.mjs?v=ab4efe3c08f3';
import {beginShareRefresh, prepareOffline, readOfflineMetadata, saveOfflineMetadata, shareRefreshHeld} from './offline.mjs?v=ab4efe3c08f3';
import {
  MERUHEN_STORES, netEstimateNote, exchangeValue, calendarDay, dayHeatLevel, compactSigned, dayNet, daySummaries, daySummary, displayMachineName, eventLabel, indexRecords, lowGamesNote,
  meruhenRecords, mergeEvents, monthWeeks, pscubeRecords, scriptIdFrom, signed, storeLabel, TOP_RACKS_OPEN, viewerNameFrom, winRateText,
  IDLE_DAY_CHOICES, IDLE_DEFAULT_DAYS, IDLE_DEFAULT_GAMES, IDLE_GAMES_CHOICES, idleVarietyRacks, storeDays,
  sharedRainbowCanBatch, storedRainbowMarks, sendRainbowBatches, RAINBOW, lastRainbowDay, lastRainbowText, rackMark, storeHasRainbow,
  RAINBOW_COUNT_DAYS, applyRainbowMarks, markTime, mergeMarks, varietyRecordRows, rackSuffix,
  ROTATION_DAYS, ROTATION_SORTS, byLongestGap, daysSinceRainbow, rackDays, rainbowVarietyMax, rotationOrder, windowDays,
  SUFFIX_PERIODS, hasSuffixSummary, suffixesOf, zoromeEndingsOf, suffixLabel, suffixReport,
  varietyWeek, varietyMaxRacksFor, rainbowTodayRows,
  SAIWAICHOU_GAP_NET, saiwaichouMachineNet, saiwaichouGrade, saiwaichouGapEnd, saiwaichouGap,
  monthDayList, periodWinRate, winRateYears, yearWinRates, loadFailureText,
  characterBirthdayCellLabel, characterBirthdaysOn, parseCharacterBirthdays,
  ALL_RACKS_SORTS, allRacksOrder, nonVarietyRacks, storeDayComment, eventComparison, machinePickups,
  rackRecentHistory, searchStoreEntities, machineDayHistory, rackDayHistory, latestStoreComparison, sameMachineName,
} from './data.mjs?v=ab4efe3c08f3';

const ID_KEY = 'database-share-script-id';
const STORE_KEY = 'database-share-store';
// 渡したリンクの呼び名（# の u=）。最初の読み込みにだけ付けて送り、スクリプトが「実行数」に記録する。
const NAME_KEY = 'database-share-name';
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
// この端末で付け外しした🌈（送れなかった分も次に送る）と、バラエティ🌈の並べ方。
const MARKS_KEY = 'database-share-rainbow';
const VARIETY_MODE_KEY = 'database-share-variety-mode-v2';
const VARIETY_SORT_KEY = 'database-share-variety-sort';
// 全機種の台一覧の並べ方（端末に覚える）。
const ALL_RACKS_SORT_KEY = 'database-share-all-racks-sort';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const RETRY_MS = [1500, 4000];
const TIMEOUT_MS = 30000;
const REFRESH_HELD_NOTICE = '前回の更新が途中で止まったため、自動更新を止めています。「最新を読む」で試せます。';

const app = document.getElementById('app');
const reload = document.getElementById('reload');
document.addEventListener('click',event=>{
  if(event.target.closest('[data-daily-learning]') && state.id) {
    // 店舗の切り替えは、この共有ページで見られる店舗だけ（ほかの店舗の候補は出さない）。
    void openDailyLearning({store:state.store,target:defaultDailyTarget(),stores:state.model?.stores??[state.store],
      load:()=>getJson(`https://script.google.com/macros/s/${state.id}/exec?file=daily-learning`),
      // P-STATIONの台番のリンク（サイトセブン）に使う機種の番号を、読み込み済みの台の記録から引く（2026-11-15）。
      records:s=>[...(state.model?.byDay??new Map())].filter(([key])=>key.startsWith(`${s}|`)).flatMap(([,rows])=>rows)});
  }
});
let statsObserver;
const state = {id: null, name: null, model: null, store: null, year: 0, month: 0, loading: false, notice: '',
  birthdays: new Map(), eventHistory: null, historyNotice: '', historyDocument:null, historyRedraw:null, historySaveNotice:''};
const HISTORY_LOCAL_KEY='database-share-history-edits:';
const historySending=new Set();

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

/**
 * キャラ誕生日（EVENT_CALENDAR.md「キャラ誕生日」）。ページと一緒に置くファイルで、公開のとき
 * database_android/assets/character_birthdays.json から作る（tool/stage_share_viewer.py）。読めなくても誕生日を出さないだけ。
 */
async function loadBirthdays() {
  try {
    const response = await fetch('./character_birthdays.json?v=ab4efe3c08f3', {credentials: 'omit'});
    if (!response.ok) return;
    state.birthdays = parseCharacterBirthdays(await response.json());
    if (state.model) render();
  } catch { /* 誕生日が読めなくてもカレンダーは使える */ }
}

/** その日のキャラ誕生日の一覧（日付を押した先に出す）。無ければ ''。 */
function birthdayLines(day) {
  const list = characterBirthdaysOn(state.birthdays, day);
  return list.length ? `<div class="birthday-line" data-birthdays><p class="label">キャラ誕生日（イベントとは別）</p>
        ${list.map(b => `<p class="birthday-name">🎂 ${esc(b.label)}</p>`).join('')}</div>` : '';
}

async function load() {
  if (state.loading) return;
  const loadingId = state.id;
  state.notice = '';
  if (globalThis.navigator?.onLine === false && state.model) {
    state.sources = {meruhen:'オフライン・保存済みデータ',pscube:'オフライン・保存済みデータ'};
    state.auxStatus = {};
    state.notice = 'オフラインです。保存済みのデータを表示しています。'; render(); return;
  }
  state.loading = true;
  reload.disabled = true;
  if (!state.model) {
    app.innerHTML = '<p class="status">Googleドライブから読み込んでいます…<br>最初の読み込みは、1分ほどかかることがあります。</p>';
  }
  const finish = beginShareRefresh(loadingId);
  try {
    await updateDocuments(loadingId);
  } catch (error) {
    if (loadingId !== state.id) return;
    state.notice = `更新を完了できませんでした（${error.message}）。「最新を読む」で試せます。`;
    if (state.model) render();
    else app.innerHTML = `<p class="status" role="status">${esc(state.notice)}</p>`;
  } finally {
    finish();
    if (loadingId === state.id) {
      state.loading = false;
      reload.disabled = false;
    }
  }
}

async function updateDocuments(loadingId) {
  const base = `https://script.google.com/macros/s/${loadingId}/exec`;
  const [meruhen, pscube, events, pscubeEvents, rainbow, history] = await Promise.allSettled(
    [state.name ? `?u=${state.name}` : '', '?file=pscube', '?file=events', '?file=pscube-events', '?file=rainbow', '?file=event-history']
      .map((q, i) => i < 2 ? fetchViewerDocument(base + q, i === 0 ? 'meruhen' : 'pscube', getJson) : getJson(base + q)));
  const doc = (r) => (r.status === 'fulfilled' && r.value && !r.value.error ? r.value : null);
  const m = doc(meruhen), p = doc(pscube);
  // どの店が何で失敗したかを、知らせの文にそのまま出す（2026-10-18）。
  const why = loadFailureText([['メルヘン', meruhen], ['P-STATION', pscube]]);
  if (loadingId !== state.id) return;
  state.sources = {meruhen:m ? '最新の読み込みに成功' : '更新失敗・保存済みデータ', pscube:p ? '最新の読み込みに成功' : '更新失敗・保存済みデータ'};
  if (!m && !p) {
    const reason = [meruhen, pscube].map(r => (r.status === 'rejected' ? r.reason?.message : r.value?.error)).find(Boolean);
    state.auxStatus = {};
    if (state.model) { state.notice = `更新できませんでした（${why}）。保存済みのデータを表示しています。`; render(); }
    else showSetup(`読み込めませんでした。リンクが正しいか、少し待ってからもう一度お試しください。${reason ? `（${reason}）` : ''}`);
    return;
  }
  const saved = await readOfflineMetadata(loadingId).catch(() => ({}));
  if (loadingId !== state.id) return;
  const fresh = {events:doc(events), pscubeEvents:doc(pscubeEvents), rainbow:doc(rainbow), eventHistory:doc(history)};
  for (const key of ['events','pscubeEvents']) if (!Array.isArray(fresh[key]?.events)) fresh[key] = null;
  if (!Array.isArray(fresh.rainbow?.marks)) fresh.rainbow = null;
  try { if (fresh.eventHistory) parsePrivateHistory(fresh.eventHistory); }
  catch { fresh.eventHistory = null; }
  const metadata = {};
  state.auxStatus = {};
  for (const key of ['events','pscubeEvents','rainbow','eventHistory']) {
    metadata[key] = fresh[key] || saved[key];
    state.auxStatus[key] = fresh[key] ? '' : saved[key] ? '更新失敗・保存済みデータを表示' : '更新失敗・保存データなし';
  }
  const loadedAt=new Date().toISOString();
  metadata.health={...saved.health};
  for(const [site,value] of [['meruhen',m],['pscube',p]]) if(value) metadata.health[site]={
    loaded_at:loadedAt,exported_at:value.exported_at ?? value.header?.exported_at,
    sync_status:value.sync_status ?? value.header?.sync_status};
  state.historyNotice = fresh.eventHistory ? '' : '最新の履歴を取得できません。保存済みの履歴があれば表示します。';
  // 旧Googleスクリプトの全件応答も、端末履歴へ初回移行できる。
  // 日別の部品から組み立てた内容（history）で、その日がすべて端末の日別キャッシュにあるときは、rememberViewerHistory は
  // 何もしないので呼ばない（2026-11-22、Codexの点検 #10・Gemini H-5。呼ぶと端末の全履歴を一度にまとめて読み、2店分の
  // 内容と同時にメモリに載っていた）。確かめは1日ずつ読む viewerHistoryCovers（閲覧ページと同じ）。
  const remember = async (site, doc) => {
    if (doc.history && Array.isArray(doc.records) && await viewerHistoryCovers(base, site, new Set(doc.records.map(r => r?.day).filter(d => typeof d === 'string')))) return;
    await rememberViewerHistory(base, site, doc, undefined, !doc.history);
  };
  try {
    if (m) await remember('meruhen', m);
    if (p) await remember('pscube', p);
    await saveOfflineMetadata(loadingId, metadata);
  } catch {
    if (loadingId === state.id) state.notice = '端末への保存に失敗しました。空き容量とブラウザの保存設定を確認してください。';
  }
  const localM = m || await readViewerHistory(base, 'meruhen').catch(() => null);
  const localP = p || await readViewerHistory(base, 'pscube').catch(() => null);
  if (loadingId !== state.id) return;
  state.notice ||= (!m || !p) ? `一部の更新に失敗しました（${why}）。保存済みのデータを併用しています。` : '';
  showDocuments(localM, localP, metadata);
  flushHistoryEdits();
}

function showDocuments(m, p, metadata = {}) {
  state.eventHistory = null;
  state.historyDocument = metadata.eventHistory??null;
  try {
    if (metadata.eventHistory) state.eventHistory = parsePrivateHistory(mergeHistoryCells(metadata.eventHistory,localHistoryEdits(),{strict:false}));
  } catch (error) { state.historyNotice = `履歴ファイルを読めません：${error.message}`; }
  const records = [...meruhenRecords(m), ...pscubeRecords(p)];
  const byDay = indexRecords(records);
  // ほかの端末（閲覧ページ・共有ページ）で付け外しした🌈と、この端末の分（PCが取り込む前でも出す）。
  const sharedMarks = metadata.rainbow?.marks;
  const marks = mergeMarks(Array.isArray(sharedMarks) ? sharedMarks : [], localMarks());
  applyRainbowMarks(byDay, marks);
  const summaries = daySummaries(m);
  for (const issue of byDay.issues) if (issue.kind === 'conflict') summaries.delete(`${issue.store}|${issue.day}`);
  const stores = [...Object.keys(MERUHEN_STORES), ...new Set(records.map(r => r.store).filter(s => s.startsWith('pscube:')))]
    .filter(s => records.some(r => r.store === s) || [...summaries.keys()].some(k => k.startsWith(s + '|')));
  state.model = {
    byDay, stores, marks, health:metadata.health || {}, summaries,
    events: mergeEvents(m?.date_events, metadata.events?.events, p?.date_events, metadata.pscubeEvents?.events),
    exportedBySite: {meruhen:m?.exported_at ?? m?.header?.exported_at, pscube:p?.exported_at ?? p?.header?.exported_at},
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

function storeComparisonSection(model) {
  if (model.stores.length < 2) return '';
  const rows = latestStoreComparison(model.byDay, model.summaries, model.events, model.stores);
  return `
    <section class="store-compare" aria-label="最新営業日の店舗比較">
      <div class="store-compare-head">
        <span class="store-compare-title">最新営業日の店舗比較</span>
        <span class="store-compare-hint">押すと切替・選択中は詳細</span>
      </div>
      <div class="store-compare-grid">
        ${rows.map((x, idx) => {
          const active = x.store === state.store;
          const mainTone = x.winRate ? 'zero' : x.total != null ? tone(x.total) : 'zero';
          const mainText = x.winRate ? winRateText(x.won, x.judged)
            : x.total != null ? compactSigned(x.total) : '—';
          const metaParts = x.winRate
            ? [`${x.won}/${x.judged}台`]
            : x.total != null
              ? [`平均${signed(x.averageNet)}`, x.winRatePct != null ? `勝率${x.winRatePct}%` : '', x.estimated ? '推定' : ''].filter(Boolean)
              : ['記録なし'];
          const canOpen = x.hasRacks || x.hasSummary;
          const mode = active ? (x.hasRacks ? 'day' : x.hasSummary ? 'summary' : 'none') : 'switch';
          const ctaText = active ? (canOpen ? '詳細を見る ›' : '表示中') : '切替 ›';
          const idBase = `compare-store-${idx}`;
          return `<article class="store-compare-card heat-${x.heat}${active ? ' active' : ''}" data-compare-card="${esc(x.store)}">
            <div class="store-compare-top" id="${idBase}">
              <span class="store-compare-name">${esc(switchLabel(x.store, model.stores))}</span>
              <span class="store-compare-day num">${x.day ? shortDate(x.day) : '—'}</span>
            </div>
            <span class="store-compare-event${x.event ? '' : ' empty'}"${x.event ? '' : ' aria-hidden="true"'}>${x.event ? esc(x.event) : '通常日'}</span>
            <div class="store-compare-main num ${mainTone}">${esc(mainText)}</div>
            <div class="store-compare-meta num">${metaParts.map(p => `<span>${esc(p)}</span>`).join('')}</div>
            <button type="button" class="store-compare-cta" data-compare-store="${esc(x.store)}" data-compare-day="${esc(x.day ?? '')}" data-compare-mode="${mode}" aria-describedby="${idBase}"${mode === 'none' ? ' disabled' : ''}>${ctaText}</button>
          </article>`;
        }).join('')}
      </div>
    </section>`;
}

function render() {
  const {model} = state;
  if (!model) return;
  if (!model.stores.length) { app.innerHTML = '<p class="status" role="status">表示できるデータがありません。右上の「最新を読む」で再読み込みできます。</p>'; return; }
  const today = todayJst();
  const weeks = monthWeeks(state.year, state.month);
  // 月間の勝率（2026-10-18 利用者「月ごとに月間の勝率出す」）：その月の日の台数を足して割る。
  const monthRate = periodWinRate(model.byDay, model.summaries, state.store, monthDayList(state.year, state.month));
  const monthNets = monthDayList(state.year, state.month).flatMap(day => model.byDay.get(`${state.store}|${day}`) ?? []).filter(r => r.net != null);
  const monthNet = monthNets.length ? monthNets.reduce((sum, r) => sum + r.net, 0) : null;
  const exchange = state.store === 'pscube:c740601:20'
    ? {loan: 50, payout: 58}
    : Object.hasOwn(MERUHEN_STORES, state.store) ? {loan: 46, payout: 50} : null;
  const exchangeAmount = exchangeValue(monthNet, exchange?.payout);
  const site = state.store.startsWith('pscube:') ? 'pscube' : 'meruhen';
  const exported = exportedText(model.exportedBySite[site]);
  const days = [...new Set([...model.byDay.keys(), ...model.summaries.keys()].filter(k => k.startsWith(state.store + '|')).map(k => k.split('|')[1]))].sort();
  const netDays = new Set(monthDayList(state.year, state.month).filter(day => (model.byDay.get(`${state.store}|${day}`) ?? []).some(r => r.net != null))).size;
  const issues = (model.byDay.issues ?? []).filter(i => i.store === state.store && i.day.startsWith(`${state.year}-${String(state.month).padStart(2,'0')}`));
  const conflicts = issues.filter(i => i.kind === 'conflict');
  // お店のひとこと（2026-11-04）：この店の台データのある最新の日について（data.mjs storeDayComment）。
  const latestRackDay = [...model.byDay.keys()].filter(k => k.startsWith(state.store + '|')).map(k => k.split('|')[1]).sort().at(-1);
  const comment = latestRackDay ? storeDayComment(model.byDay, state.store, latestRackDay, model.events.get(`${state.store}|${latestRackDay}`)?.name ?? null) : '';
  const cells = weeks.flat().map((day, idx) => {
    if (!day) return '<div class="blank" aria-hidden="true"></div>';
    const weekday = idx % 7;
    const racks = model.byDay.get(`${state.store}|${day}`) ?? [];
    // 台データの無い日は、保存したHTMLからの「何台中何台プラス」（day_summaries）で勝率を出す。
    const net = calendarDay(racks, model.summaries.get(`${state.store}|${day}`));
    const heat = dayHeatLevel(net);
    const event = eventLabel(model.events.get(`${state.store}|${day}`));
    const birthdays = characterBirthdaysOn(state.birthdays, day);
    const cake = characterBirthdayCellLabel(birthdays.map(b => b.name));
    const date = Number(day.slice(8));
    const rate = net.winRate ? winRateText(net.won, net.judged) : '';
    const label = [`${state.month}月${date}日`, event, birthdays.length ? `キャラ誕生日 ${birthdays.map(b => b.label).join('、')}` : '',
      rate ? `${net.judged}台中${net.won}台プラス、${rate}` : net.total != null ? `総差枚 ${signed(net.total)}` : ''].filter(Boolean).join('、');
    const inner = `<span class="date num">${date}</span>`
      + (event ? `<span class="event">${esc(event)}</span>` : '')
      + (cake ? `<span class="birthday">${esc(cake)}</span>` : '')
      + (rate ? `<span class="net num zero">${rate}</span>`
        : net.total != null ? `<span class="net num ${tone(net.total)}">${compactSigned(net.total)}</span>` : '');
    const cls = `day heat-${heat}${day === today.day ? ' today' : ''}${weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : ''}${event ? ' has-event' : ''}`;
    return racks.length
      ? `<button type="button" class="${cls}" data-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      : net.summary ? `<button type="button" class="${cls}" data-summary-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      // 台もHTMLの集計も無い日でも、誕生日があれば押して全員（名前（作品））を見られる。
      : birthdays.length ? `<button type="button" class="${cls}" data-birthday-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      : event ? `<button type="button" class="${cls}" data-event-open="${day}" aria-label="${esc(label)}">${inner}</button>`
      : `<div class="${cls}" aria-label="${esc(label)}">${inner}</div>`;
  }).join('');
  app.innerHTML = `
    <section class="hero">
      <p class="kicker">${esc(storeLabel(state.store))}</p>
      <h1 class="headline num">${state.year}年${state.month}月</h1>
      <div class="data-status" data-source-status><p>${esc(state.sources?.[site] ?? '保存済みデータを表示')}</p><p>元データ：${esc(exported || '書出日時不明')} ／ 最新営業日：${esc(days.at(-1) ?? 'なし')}</p></div>
      ${state.notice ? `<p class="data-warning" role="status">${esc(state.notice)}</p>` : ''}
      ${auxWarning(site)}
      ${issues.length ? `<details class="data-warning" data-record-issues><summary>${conflicts.length ? `内容が異なる${conflicts.length}台分を集計から除外しています` : '同一記録の重複を1件として集計しています'}</summary>${issues.map(i => `<p>${esc(i.day)} ${i.rack}番 ${esc(displayMachineName(i.machine))}：${i.kind === 'conflict' ? '内容が競合・集計保留' : '同一内容の重複'}（${i.count}件）</p>`).join('')}<p>保存元の記録は削除していません。</p></details>` : ''}
      <div class="daily-entry"><button type="button" class="pill pill-outline daily-entry-btn" data-daily-learning>日次学習・採用中の候補</button></div>
      <div class="month-stats" aria-label="月間の集計">
        <div class="month-stat" data-month-rate><span class="stat-label">月間勝率</span><span class="stat-value num">${monthRate.judged ? winRateText(monthRate.won, monthRate.judged).replace('勝率', '') : '—'}</span><span class="stat-detail">${monthRate.judged ? `${monthRate.days}日分・${count(monthRate.won)} / ${count(monthRate.judged)}台プラス` : '勝率データなし'}</span></div>
        <div class="month-stat" data-month-net><span class="stat-label">月間差枚${!state.store.startsWith('pscube:') || monthNets.some(r => r.estimated) ? '（推定含む）' : ''}</span><span class="stat-value num ${monthNet == null ? '' : tone(monthNet)}">${monthNet == null ? '—' : signed(monthNet)}<small>${monthNet == null ? '' : '枚'}</small></span><span class="stat-detail">${monthNet == null ? '差枚データなし' : `取得分 ${netDays}日・延べ${count(monthNets.length)}台`}</span></div>
        ${exchange ? `<div class="exchange-summary" data-month-exchange><div class="exchange-head"><span>交換額換算（参考）</span><strong class="exchange-value num">${exchangeAmount}</strong></div><p class="exchange-rate">${exchange.loan}枚貸し・${exchange.payout}枚交換 ／ 1枚${exchange.payout === 50 ? '20' : '約17.24'}円で換算</p><p class="exchange-note">取得できた差枚だけの参考額です。<br>実収支ではありません。</p><details class="exchange-info"><summary>換算について</summary><p>過去月も現在指定の交換条件で換算しています。貸出・交換の枚数はそれぞれ1,000円相当として計算。現金投資時の貸出・交換の差は含みません。現金投資か持ちメダル遊技かによって収支は変わります。${monthNets.some(r => r.estimated) ? '元の差枚に推定値があれば、換算額にもその誤差を含みます。' : ''}差枚が分かる台だけの合計を換算し、差枚データがない月は「—」と表示します。</p></details></div>` : ''}
      </div>
      ${comment ? `<div class="day-comment" data-day-comment><span class="stat-label">ひとこと</span><p>${esc(comment)}</p></div>` : ''}
      <p class="lede">日付を押すと、機種別ピックアップ・差枚TOP50・強かった機種10選が見られます。</p>
    </section>
    <div class="stores">
      <span class="caption">店舗を選ぶ</span>
      <div class="anchors" role="group" aria-label="店舗">
        ${model.stores.map(s => `<button type="button" class="anchor" data-store="${esc(s)}" aria-pressed="${s === state.store}">${esc(switchLabel(s, model.stores))}</button>`).join('')}
      </div>
    </div>
    ${storeComparisonSection(model)}
    <div class="tools">
      <button type="button" class="pill pill-outline tool-btn tool-btn-search" data-search-open>機種・台番を検索</button>
      <button type="button" class="pill pill-outline tool-btn" data-idle-open>バラエティの回っていない台</button>
      ${Object.hasOwn(MERUHEN_STORES, state.store) ? `<button type="button" class="pill pill-outline tool-btn" data-variety-open>バラエティ${RAINBOW}</button>` : ''}
      ${hasSuffixSummary(state.store) ? '<button type="button" class="pill pill-outline tool-btn" data-suffix-open>末尾別データまとめ</button>' : ''}
      ${['nagamachiminami','saiwaichou'].includes(state.store) ? `<button type="button" class="pill pill-outline tool-btn" data-event-history-open>${state.store==='saiwaichou'?'バラエティ履歴':'イベント履歴'}</button>` : ''}
      <button type="button" class="pill pill-outline tool-btn" data-year-open>月別・年間の勝率</button>
    </div>
    <section class="stage" aria-label="イベントカレンダー">
      <div class="card">
        <div class="cal-bar">
          <span class="cal-ym num" aria-hidden="true">${state.year}年${state.month}月</span>
          <div class="months">
            <button type="button" class="pill pill-outline" data-month="-1" aria-label="前の月">‹ 前の月</button>
            <button type="button" class="pill pill-outline" data-month="0" ${state.year === today.y && state.month === today.m ? 'disabled' : ''}>今月</button>
            <button type="button" class="pill pill-outline" data-month="1" aria-label="次の月">次の月 ›</button>
          </div>
        </div>
        <div class="weekdays" aria-hidden="true">${WEEKDAYS.map((w, i) => `<span${i === 0 ? ' class="sun"' : i === 6 ? ' class="sat"' : ''}>${w}</span>`).join('')}</div>
        <div class="grid">${cells}</div>
        <div class="cal-key" aria-hidden="true">
          <span class="cal-key-item"><span class="cal-swatch sw-plus-3"></span>強い＋（平均+250〜）</span>
          <span class="cal-key-item"><span class="cal-swatch sw-plus-1"></span>プラス</span>
          <span class="cal-key-item"><span class="cal-swatch sw-minus-2"></span>マイナス</span>
          <span class="cal-key-item"><span class="cal-swatch sw-event"></span>イベント</span>
          <span class="cal-key-item"><span class="cal-swatch sw-empty"></span>記録なし</span>
        </div>
      </div>
      ${healthDetails()}
      <p class="legend">差枚＝取得できた台の合計（推定値を含む場合があります）。背景の濃淡は1台あたり平均差枚の目安です。🎂＝キャラ誕生日（イベントとは別。押すと全員を「名前（作品）」で見られる）。差枚の分かる台が半分に満たない日（アナスロ補完の日など）は勝率＝プラスで終わった台の割合（グラフの終点で判定）。台のデータが無い日の勝率は、保存したアナスロのHTMLから数えたもの（押すと何台中何台プラスか）。＊＝前日までに入力した記録がないイベント。</p>
    </section>`;
  fitMonthStats();
}

// フォント拡大で数値が収まらない場合は、その項目内でも上下に分ける。
function fitMonthStats() {
  statsObserver?.disconnect();
  const stats = app.querySelector('.month-stats');
  if (!stats) return;
  const fit = () => {
    for (const value of stats.querySelectorAll('.stat-value')) {
      const row = value.parentElement, clone = value.cloneNode(true);
      clone.style.cssText = 'position:fixed;visibility:hidden;width:max-content;max-width:none;white-space:nowrap;';
      row.append(clone);
      const needed = clone.getBoundingClientRect().width;
      clone.remove();
      row.classList.toggle('large-number', needed > (row.clientWidth - 28) / 2);
    }
  };
  fit();
  if (globalThis.ResizeObserver) { statsObserver = new ResizeObserver(() => requestAnimationFrame(fit)); statsObserver.observe(stats); }
}

function auxWarning(site) {
  const labels = {events:'イベント',pscubeEvents:'イベント',rainbow:'🌈の印',eventHistory:'履歴・顔文字・末尾の印'};
  const keys = [site === 'pscube' ? 'pscubeEvents' : 'events', 'rainbow', 'eventHistory'];
  const failed = keys.filter(key => state.auxStatus?.[key]);
  return failed.length ? `<div class="data-warning" role="status" data-aux-warning><strong>一部の補助データを更新できませんでした</strong>${failed.map(key => `<p>${labels[key]}：${esc(state.auxStatus[key])}</p>`).join('')}<p>台データの更新状態とは別です。「最新を読む」で再試行できます。</p></div>` : '';
}

function healthDetails() {
  const model=state.model,site=state.store.startsWith('pscube:') ? 'pscube' : 'meruhen';
  const meta=model.health[site] || {},days=storeDays(model.byDay,state.store);
  const day=days.includes(state.healthDay) ? state.healthDay : days[0];
  const records=(model.byDay.get(`${state.store}|${day}`) || []).map(r=>({...r,net_medals:r.net}));
  let lines;
  try {lines=updateStatusLines(meta.sync_status,{exportedAt:meta.exported_at,loadedAt:meta.loaded_at});}
  catch {lines=['更新工程の情報を読めません。台の記録は表示を続けます。'];}
  // P’s CUBEの「○台中○台差枚取得済み・未取得○台」と未取得の台の一覧は出さない（2026-11-15 利用者「この表記をすべてからなくしてほしい」）。
  const report=[`端末内の最新営業日：${days[0] || '記録なし'}`,
    '書き出しただけではDriveへのアップロードや他の端末の読み込みは確認できません。'];
  return `<details class="card" data-health><summary>更新・差枚の取得状況</summary>
    <p>${esc(storeLabel(state.store))}</p>
    <label>確認する営業日 <select data-health-day aria-label="取得状況の営業日">${options(days,day,shortDateWeek)}</select></label>
    ${[...lines,...report].map(line=>`<p class="legend">${esc(line)}</p>`).join('')}</details>`;
}

app.addEventListener('change',e=>{
  if(!e.target.matches('[data-health-day]'))return;
  state.healthDay=e.target.value;render();app.querySelector('[data-health]').open=true;
});

const count = (n) => n.toLocaleString('en-US');
/** 確率（1/○○.○）。当たりが0回なら「—」。 */
const odds = (games, hits) => (hits > 0 && games > 0 ? `1/${(games / hits).toFixed(1)}` : '—');
const netCell = (r) => (r.net != null
  ? `<span class="value num ${tone(r.net)}" style="display:block">${signed(r.net)}${r.needsCheck ? '※' : ''}</span>`
  : '<span class="value num zero" style="display:block">—</span>');

/** 押せる行の並び。lead＝左の順位、main・right＝中身、attrs＝押したときに読む data-*、current＝印を付ける行。 */
function tapList(rows, start = 1) {
  const rankCls = (lead) => {
    const m = /^([1-3])位?$/.exec(String(lead));
    return m ? ` rank-top rank-${m[1]}` : '';
  };
  return `<ol class="list"${start > 1 ? ` start="${start}"` : ''}>${rows.map(x => `
        <li${x.current ? ' class="current"' : ''}><button type="button" class="row" ${x.attrs}>
          ${x.lead !== '' ? `<span class="rank num${rankCls(x.lead)}">${x.lead}</span>` : ''}<span class="main">${x.main}</span><span class="right">${x.right}</span>
          <span class="chev" aria-hidden="true">›</span></button></li>`).join('')}</ol>`;
}

/*
 * 差枚の一覧で選んだ台番の末尾（2026-11-05 利用者「差枚一覧で選んだ末尾を、機種一覧でも追えるようにする」）。
 * 日の画面（TOP50）で 0〜9 を1つ選ぶと、その末尾の台番の横に小さな印。同じ店・同じ日の機種の台一覧・全機種の台一覧にも
 * 引き継ぐ（台は全部出したまま）。「末尾7 ×」で解除。日付を変える・シートを閉じる（店を変える）と解除。
 */
const suffixMark = (r, digit) => (digit != null && rackSuffix(r.rack) === digit
  ? `<span class="suffix-mark" title="末尾${digit}">末${digit}</span>` : '');
const suffixClear = (digit) => (digit == null ? ''
  : `<p class="suffix-pick"><button type="button" class="pill pill-outline suffix-clear" data-suffix-clear aria-label="末尾${digit}の印を消す">末尾${digit} ×</button></p>`);
const suffixPicker = (digit) => `<div class="suffix-pick" role="group" aria-label="台番の末尾で印を付ける"><span class="suffix-label">末尾</span><div class="suffix-digits">${
  Array.from({length: 10}, (_, d) => `<button type="button" class="pill ${d === digit ? 'pill-blue' : 'pill-outline'} suffix-digit" data-suffix-digit="${d}" aria-pressed="${d === digit}">${d}</button>`).join('')}</div></div>
      ${suffixClear(digit)}`;

/** `2026-10-09` → `10月9日（金）`。 */
function dateLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${m}月${d}日（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

/** `2026-10-09` → `10/9`。 */
const shortDate = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

/** `2026-10-09` → `10/9（金）`（狭い選択欄用）。 */
const shortDateWeek = (day) => `${shortDate(day)}（${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}）`;

function eventLine(day) {
  const event = eventLabel(state.model.events.get(`${state.store}|${day}`));
  return `<p class="event-line">${event
    ? `イベント：<button class="event-compare-link" type="button" data-event-compare aria-label="${esc(event)}の直近3回を比較">${esc(event)} <span aria-hidden="true">›</span></button>`
    : 'イベントなし'}</p>`;
}

const eventCompareView = (day) => ({
  kind: 'eventCompare', report: eventComparison(state.model.events, state.model.byDay, state.store, day), machine: '',
});

function eventCompareBody({report: {name, rounds, machines}, machine}) {
  const shown = machine ? [machine] : machines;
  const period = (round) => {
    const from = `${round.from.slice(0, 4)}年<br>${shortDate(round.from)}`;
    if (round.from === round.to) return from;
    const endYear = round.to.slice(0, 4) === round.from.slice(0, 4) ? '' : `${round.to.slice(0, 4)}年`;
    return `${from}〜<wbr>${endYear}${shortDate(round.to)}`;
  };
  const cellTone = (r) => {
    if (!r || !r.captured) return 'event-cell-empty';
    const avg = Math.round(r.total / r.captured);
    return avg > 0 ? 'event-cell-plus' : avg < 0 ? 'event-cell-minus' : 'event-cell-zero';
  };
  const value = (r) => {
    if (!r) return '—';
    const average = r.captured ? Math.round(r.total / r.captured) : null;
    return `<span class="num">${r.judged ? `プラス ${r.won}/${r.judged}台` : 'プラス —'}</span>
      <span class="num ${average == null ? 'zero' : tone(average)}">${average == null ? '平均 —' : `平均 ${signed(average)}枚`}</span>
      ${r.estimated ? '<small>推定含む</small>' : ''}`;
  };
  return `
    <p class="store">${esc(storeLabel(state.store))}</p>
    <h2 id="sheet-title" class="long">${esc(name)}</h2>
    <p class="caption">選んだイベントの回を含む直近${rounds.length}回。${state.store === 'nagamachiminami'
      ? '月曜から日曜までの同じ名前の日を1回にまとめます。'
      : '同じ名前が続く日は1回にまとめます。'}</p>
    ${machines.length > 1 ? `<label class="variety-sort">機種 <select data-event-machine>${options(['', ...machines], machine, m => m || '全機種')}</select></label>` : ''}
    ${machines.length ? '<p class="caption">台数はプラス台数／勝ち負けが分かる台数。平均差枚は差枚が分かる台のみ。複数日は延べ台数です。</p>' : ''}
    <table class="event-compare-table" aria-label="開催回ごとの機種別結果">
      <thead><tr>${rounds.map(r => `<th scope="col">${period(r)}<small>台記録 ${r.recordedDays}/${r.days}日</small></th>`).join('')}</tr></thead>
      ${shown.map(m => `<tbody><tr><th scope="rowgroup" colspan="${rounds.length}">${esc(m)}</th></tr>
        <tr>${rounds.map(r => { const item = r.byMachine.get(m); return `<td class="${cellTone(item)}">${value(item)}</td>`; }).join('')}</tr></tbody>`).join('')}
    </table>
    ${machines.length ? '' : '<p class="note">比較できる機種別の記録がありません。</p>'}`;
}

/** 台詳細画面の直近7日間の推移（差枚・G数・イベント・中央線付きミニ横バー、同機種日へのジャンプ）。 */
function rackTrendSection(r) {
  const history = rackRecentHistory(state.model.byDay, state.model.events, r.store, r.rack, r.day, 7);
  if (!history.length) return '';
  const same = history.filter(h => h.sameMachine);
  const otherCount = history.length - same.length;
  const sameWithNet = same.filter(h => h.net != null);
  const totalNet = sameWithNet.length ? sameWithNet.reduce((s, h) => s + h.net, 0) : null;
  const judged = same.filter(h => h.won != null);
  const won = judged.filter(h => h.won).length;
  const avgGames = same.length ? Math.round(same.reduce((s, h) => s + h.games, 0) / same.length) : 0;
  const anyEst = sameWithNet.some(h => h.estimated);
  const allWithNet = history.filter(h => h.net != null);
  const maxAbs = Math.max(1000, ...allWithNet.map(h => Math.abs(h.net)));
  const summaryParts = [
    otherCount ? `同機種 ${same.length}日` : `記録 ${same.length}日`,
    judged.length ? `プラス ${won}/${judged.length}日` : '',
    totalNet != null ? `合計 ${signed(totalNet)}枚${anyEst ? '（推定含む）' : ''}` : '',
    same.length ? `平均 ${count(avgGames)}G` : '',
    otherCount ? `別機種 ${otherCount}日（集計外）` : '',
  ].filter(Boolean);
  const rows = history.map(h => {
    const current = h.day === r.day;
    const clickable = h.sameMachine && !current;
    const pct = h.net == null || h.net === 0 ? 0 : Math.max(4, Math.min(100, Math.round(Math.abs(h.net) / maxAbs * 100)));
    const bar = h.net == null
      ? '<span class="rack-trend-bar empty" aria-hidden="true"><span class="rack-trend-axis"></span></span>'
      : `<span class="rack-trend-bar" aria-hidden="true"><span class="rack-trend-axis"></span>${pct ? `<span class="rack-trend-fill ${h.net > 0 ? 'plus' : 'minus'}" style="width:${(pct / 2).toFixed(1)}%"></span>` : ''}</span>`;
    const tags = [
      current ? '<span class="rack-trend-badge current">表示中</span>' : '',
      h.event ? `<span class="rack-trend-badge event">${esc(h.event)}</span>` : '',
      !h.sameMachine ? `<span class="rack-trend-badge other">別機種：${esc(displayMachineName(h.machine))}</span>` : '',
    ].filter(Boolean).join('');
    const netHtml = h.net != null
      ? `<span class="rack-trend-net num ${tone(h.net)}">${signed(h.net)}${h.needsCheck ? '※' : ''}</span>`
      : '<span class="rack-trend-net num zero">—</span>';
    const content = `
      <span class="rack-trend-main">
        <span class="rack-trend-top">
          <span class="rack-trend-day num">${esc(shortDateWeek(h.day))}${h.rainbow ? ` ${RAINBOW}` : ''}</span>
          <span class="rack-trend-nums">${netHtml}<span class="rack-trend-games num">${count(h.games)}G</span></span>
        </span>
        ${tags ? `<span class="rack-trend-tags">${tags}</span>` : ''}
        ${bar}
      </span>`;
    return clickable
      ? `<li><button type="button" class="rack-trend-item clickable" data-rack-history-day="${h.day}">${content}<span class="rack-trend-chev" aria-hidden="true">›</span></button></li>`
      : `<li><div class="rack-trend-item${current ? ' current' : ''}${!h.sameMachine ? ' other-machine' : ''}">${content}</div></li>`;
  }).join('');
  return `
      <section class="rack-trend" aria-labelledby="rack-trend-title">
        <h3 id="rack-trend-title">${history.length > 1 ? `直近${history.length}日間の推移` : '直近の推移'}</h3>
        <p class="rack-trend-summary num">${summaryParts.join(' ・ ')}</p>
        <p class="caption">${history.length > 1 ? '同じ機種の別の日を押すと、その日の詳細へ移動します。' : 'この日以前の同じ台番号の記録はありません。'}</p>
        <ol class="rack-trend-list">${rows}</ol>
      </section>`;
}

/** 台のその日のデータ（差枚、回転数・合成確率・BB/BB確率・RB/RB確率、最大持玉／MY、直近7日推移）。 */
function rackView({rack: r}) {
  const stats = [
    ['回転数', `${count(r.games)}G`], ['合成確率', odds(r.games, r.bb + r.rb)],
    ['BB', count(r.bb)], ['BB確率', odds(r.games, r.bb)],
    ['RB', count(r.rb)], ['RB確率', odds(r.games, r.rb)],
  ];
  if (r.output != null) stats.push([r.store.startsWith('pscube:') ? 'MY' : '最大持玉', count(r.output)]);
  const name = r.estimated ? '推定差枚' : '差枚';
  const totalTone = r.net != null ? tone(r.net) : 'zero';
  return `
      <p class="store">${esc(storeLabel(r.store))}　${dateLabel(r.day)}</p>
      <h2 id="sheet-title">${r.rack}番台${r.rainbow ? ` ${RAINBOW}` : ''}</h2>
      <p class="event-line">${esc(displayMachineName(r.machine))}</p>
      ${rainbowButton(r, 'mark-large')}
      ${storeHasRainbow(state.model.byDay, r.store)
        ? `<p class="event-line last-rainbow">最終${RAINBOW}：${lastRainbowText(lastRainbowDay(state.model.byDay, r.store, r.rack, r.day), r.day)}</p>` : ''}
      <p class="total total-card total-${totalTone}"><span class="label">${name}</span>
        <span class="value num ${totalTone}">${r.net != null ? `${signed(r.net)}${r.needsCheck ? '※' : ''}` : '—'}</span>
        ${r.net == null ? `<span class="sub">${name}はわかりません。</span>` : ''}</p>
      <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>
      ${rackTrendSection(r)}
      ${netEstimateNote([r]) ? `<p class="note">${esc(netEstimateNote([r]))}</p>` : ''}`;
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
    return storeDays(byDay, r.store).filter(d => has(r.store, d, x => sameMachineName(x.machine, r.machine) && x.rack === r.rack));
  }
  if (view.kind === 'summary') return summaryDays(state.store);
  if (view.kind === 'birthday') return [view.day];
  const all = storeDays(byDay, state.store);
  if (view.kind === 'historyMachine') return all.filter(d => has(state.store, d, x => x.machine === view.machine));
  if (view.kind === 'searchMachineDay') return all.filter(d => has(state.store, d, x => displayMachineName(x.machine) === displayMachineName(view.machine)));
  if (view.kind === 'machine') return all.filter(d => has(state.store, d, x => sameMachineName(x.machine, view.machine)));
  return all;
}

const dayOfView = (view) => (view.kind === 'rack' ? view.rack.day : view.kind === 'variety' && view.mode === 'today' ? view.todayDay : view.day);

/** 画面の日を変える。台のデータは、その日の同じ店・機種・台番号の記録に切り替える。 */
function setViewDay(view, day) {
  if (view.kind === 'rack') {
    const r = view.rack;
    view.rack = (state.model.byDay.get(`${r.store}|${day}`) ?? []).find(x => sameMachineName(x.machine, r.machine) && x.rack === r.rack) ?? r;
  } else {
    view.day = day;
    view.picked = null;
  }
}

/**
 * 一覧から台のデータを開く画面。[list] は開いた一覧に並んでいた順の台（押せる台だけ）。下の台が次の台（2026-10-22 利用者
 * 「次の台（下の台）のデータを表示するボタン」）。
 */
const rackPage = (rack, list) => ({kind: 'rack', rack, list, index: list.indexOf(rack)});

/**
 * 一覧で隣の台（無ければ null）。台のデータで日付を送っていたら、隣の台もいま見ている日の記録にする（無ければ一覧の日のまま）。
 */
function rackNeighbor(view, dir) {
  const next = view.list[view.index + dir];
  if (!next || view.index < 0) return null;
  const r = view.rack;
  if (r.day === view.list[view.index].day) return next;
  return (state.model.byDay.get(`${r.store}|${r.day}`) ?? []).find(x => sameMachineName(x.machine, next.machine) && x.rack === next.rack) ?? next;
}

/** 上に固定する見出し（下まで送っても、何の画面か分かるように）。 */
function titleOfView(view) {
  if (view.kind === 'rack') return `${view.rack.rack}番台${view.rack.rainbow ? ` ${RAINBOW}` : ''}`;
  if (view.kind === 'machine' || view.kind === 'historyMachine' || view.kind === 'searchMachine' || view.kind === 'searchMachineDay') return displayMachineName(view.machine);
  if (view.kind === 'search') return '機種・台番を検索';
  if (view.kind === 'searchRack') return `${view.rack}番台の推移`;
  if (view.kind === 'allRacks') return '全機種の台一覧';
  if (view.kind === 'idle') return 'バラエティの回っていない台';
  if (view.kind === 'variety' && view.mode === 'today') return 'バラエティ🌈 本日';
  if (view.kind === 'variety') return view.mode === 'week' ? 'バラエティの候補' : `バラエティ${RAINBOW}一覧`;
  if (view.kind === 'suffix') return '末尾別データまとめ';
  if (view.kind === 'suffixList') return `${suffixLabel(view.suffix)}の内訳`;
  if (view.kind === 'year') return '月別・年間の勝率';
  if (view.kind === 'birthday') return 'キャラ誕生日';
  if (view.kind === 'eventCompare') return 'イベントの結果比較';
  if (view.kind === 'history') return state.store === 'saiwaichou' ? 'バラエティ履歴' : 'イベント履歴';
  return 'その日のまとめ';
}

/**
 * 画面を重ねるシート（日付のシート・回っていない台・バラエティ🌈のシート）。[body] が画面ごとの中身、[onRow] が押せる行を
 * 押したとき（push で次の画面。いまの画面も渡す）、[onChange] が選択欄を変えたとき（rerender で描き直す）。
 * 上に固定した帯に、戻る・見出し・閉じると、日付送り（前の日・日付・次の日）。日を変えてもスクロール位置はそのまま。
 * 「戻る」（Esc）で前の画面へ、開いていた折りたたみ・スクロール位置のまま戻る。
 * 重ねた画面では「閉じる」を隠し、戻るだけにする（閉じると一覧ごと消えて「戻る」との違いが分かりにくいため、2026-10-22 利用者指摘）。
 * 台のデータの画面 {kind: 'rack', rack, list} は、開いた一覧の並び（list）で「前の台・次の台」へ送る（rackNeighbor）。
 */
function openSheet({first, body, onRow, onChange, onAction, onSuffix, onInput}) {
  const views = [first];
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></div>';
  const sheet = backdrop.firstElementChild;
  // 月別・年間の勝率は、日付の代わりに年を送る。
  const yearBar = (view) => {
    const years = winRateYears(state.model.byDay, state.model.summaries, state.store);
    const index = years.indexOf(view.year);
    return `<div class="date-bar">
        <button type="button" class="pill pill-outline step" data-year-step="1" aria-label="前の年"${index < 0 || index >= years.length - 1 ? ' disabled' : ''}>‹</button>
        <select data-sheet-year aria-label="表示する年">${options((years.includes(view.year) ? years : [view.year, ...years]).map(String), String(view.year), y => `${y}年`)}</select>
        <button type="button" class="pill pill-outline step" data-year-step="-1" aria-label="次の年"${index <= 0 ? ' disabled' : ''}>›</button>
      </div>`;
  };
  const dateBar = (view) => {
    if (['history', 'eventCompare', 'search', 'searchMachine', 'searchRack'].includes(view.kind)) return '';
    if (view.kind === 'year') return yearBar(view);
    const days = daysOfView(view), day = dayOfView(view);
    const index = days.indexOf(day);
    return `<div class="date-bar">
        <button type="button" class="pill pill-outline step" data-day-step="1" aria-label="前の日"${index < 0 || index >= days.length - 1 ? ' disabled' : ''}>‹</button>
        <select data-sheet-day aria-label="表示する日付">${options(days.includes(day) ? days : [day, ...days], day, shortDateWeek)}</select>
        <button type="button" class="pill pill-outline step" data-day-step="-1" aria-label="次の日"${index <= 0 ? ' disabled' : ''}>›</button>
      </div>`;
  };
  const rackStepBar = (view) => {
    if (view.kind === 'historyMachine') return machineStepBar(view);
    if (view.kind !== 'rack' || !(view.list?.length > 1)) return '';
    const before = rackNeighbor(view, -1), after = rackNeighbor(view, 1);
    // 隣が別の機種なら機種名も添える（イベント履歴は表の下の行の機種へ進むため）。
    const label = (r) => `${r.rack}番${!sameMachineName(r.machine, view.rack.machine) ? `・${esc(displayMachineName(r.machine))}` : ''}`;
    return `<div class="date-bar">
        <button type="button" class="pill pill-outline rack-step" data-rack-step="-1"${before ? '' : ' disabled'}>‹ 前の台${before ? `（${label(before)}）` : ''}</button>
        <button type="button" class="pill pill-outline rack-step" data-rack-step="1"${after ? '' : ' disabled'}>次の台${after ? `（${label(after)}）` : ''} ›</button>
      </div>`;
  };
  // イベント履歴の機種の台一覧：表の上下の行の機種へ（2026-10-22 利用者「ディスクアップに行くボタンが絶対必要」）。日付を送ったあとは出さない。
  const machineStepBar = (view) => {
    if (!(view.names?.length > 1) || view.day !== view.namesDay) return '';
    const i = view.names.indexOf(view.machine), before = view.names[i - 1], after = view.names[i + 1];
    return `<div class="date-bar">
        <button type="button" class="pill pill-outline rack-step" data-machine-step="-1"${i > 0 ? '' : ' disabled'}>‹ 前の機種${before ? `（${esc(displayMachineName(before))}）` : ''}</button>
        <button type="button" class="pill pill-outline rack-step" data-machine-step="1"${i >= 0 && after ? '' : ' disabled'}>次の機種${after ? `（${esc(displayMachineName(after))}）` : ''} ›</button>
      </div>`;
  };
  const render = () => {
    const view = views[views.length - 1];
    sheet.classList.toggle('history-sheet', view.kind === 'history');
    // 隠した「閉じる」も残す（別の接続先へ切り替えるとき、開いたシートをこのボタンで閉じるため）。
    const hideClose = views.length > 1;
    sheet.innerHTML = `
      <div class="sheet-head">
        <div class="head-row">${views.length > 1 ? '<button type="button" class="pill pill-outline" data-back>‹ 戻る</button>' : ''}
          <span class="head-title">${esc(titleOfView(view))}</span>
          <button type="button" class="pill pill-outline" data-close${hideClose ? ' style="visibility:hidden" tabindex="-1" aria-hidden="true"' : ''}>閉じる</button></div>
        ${dateBar(view)}${rackStepBar(view)}
      </div>${view.kind === 'eventCompare' ? eventCompareBody(view) : body(view)}`;
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
    if(e.target.closest('[data-history-retry]')) { flushHistoryEdits(); return; }
    const view = views[views.length - 1];
    if (e.target.closest('[data-event-compare]')) return push(eventCompareView(view.day));
    const rackHistory = e.target.closest('[data-rack-history-day]');
    if (rackHistory && view.kind === 'rack') {
      changeDay(view, rackHistory.dataset.rackHistoryDay);
      return;
    }
    const yearStep = e.target.closest('[data-year-step]');
    if (yearStep) {
      const years = winRateYears(state.model.byDay, state.model.summaries, state.store);
      const next = years[years.indexOf(view.year) + Number(yearStep.dataset.yearStep)];
      if (next) { view.year = next; view.scroll = 0; render(); }
      return;
    }
    const rackMove = e.target.closest('[data-rack-step]');
    if (rackMove && view.list) {
      const dir = Number(rackMove.dataset.rackStep), next = rackNeighbor(view, dir);
      if (next) { view.index += dir; view.rack = next; view.scroll = 0; render(); }
      return;
    }
    const machineMove = e.target.closest('[data-machine-step]');
    if (machineMove && view.names) {
      const next = view.names[view.names.indexOf(view.machine) + Number(machineMove.dataset.machineStep)];
      if (next) { view.machine = next; view.picked = null; view.scroll = 0; render(); }
      return;
    }
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
    // 台番の末尾の印（日の画面）。スクロール位置はそのまま描き直す。
    const suffix = e.target.closest('[data-suffix-digit], [data-suffix-clear]');
    if (suffix && onSuffix) {
      view.scroll = sheet.scrollTop;
      onSuffix(suffix, view);
      render();
      return;
    }
    // 画面の中の切り替え（例：バラエティ🌈の表・空き順、検索の期間・並べ替え）。描き直す。
    const action = e.target.closest('[data-variety-mode], [data-history-type], [data-history-week-step], [data-history-latest], [data-recommendation-retry], [data-search-period], [data-search-sort], [data-search-clear]');
    if (action && onAction) {
      const focusSearch = action.matches('[data-search-clear]');
      view.scroll = 0;
      onAction(action, view);
      render();
      if (focusSearch) sheet.querySelector('[data-search-input]')?.focus({preventScroll: true});
      return;
    }
    const row = e.target.closest('button.row, button.row-link');
    if (row) onRow(row, push, view);
  });
  function redrawKeepingPosition() {
    if(!backdrop.isConnected) return;
    const lefts=[...sheet.querySelectorAll('.history-overflow')].map(e=>e.scrollLeft);
    views[views.length-1].scroll=sheet.scrollTop;
    render();
    sheet.querySelectorAll('.history-overflow').forEach((e,i)=>e.scrollLeft=lefts[i]??0);
  }
  backdrop.addEventListener('change', (e) => {
    if (!e.target.matches('select')) return;
    const view = views[views.length - 1];
    if (e.target.matches('[data-sheet-day]')) { changeDay(view, e.target.value); return; }
    if (e.target.matches('[data-sheet-year]')) { view.year = Number(e.target.value); view.scroll = 0; render(); return; }
    if (e.target.matches('[data-event-machine]')) {
      view.machine = e.target.value;
      view.scroll = 0;
      render();
      sheet.querySelector('[data-event-machine]')?.focus({preventScroll: true});
      return;
    }
    if (!onChange) return;
    if (e.target.matches('[data-history-week]')) sheet.scrollTop = 0;
    onChange(e.target, view);
    redrawKeepingPosition();
    if (e.target.matches('[data-history-week]')) sheet.querySelector('[data-history-week]')?.focus({preventScroll:true});
  });
  backdrop.addEventListener('input', (e) => {
    if (onInput) onInput(e.target, views[views.length - 1], sheet);
  });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);
  render();
  return redrawKeepingPosition;
}

/** 送信済みの編集も残す。遅れて返ったGETやPC出力で新しい表示を巻き戻さない。 */
function localHistoryEdits(id=state.id) {
  const raw=store.get(HISTORY_LOCAL_KEY+id);
  if(raw==null) return [];
  const cells=JSON.parse(raw);
  if(!Array.isArray(cells) || cells.length>30000) throw Error('端末の履歴を読めません。保存済みの内容は残しています。');
  return cells;
}

function historyEditIsAhead(cell, now=Date.now()) {
  if(typeof cell?.updated_at!=='string') return false;
  // Safariでも読めるよう、小数秒をミリ秒3桁へそろえる。
  const editMs=Date.parse(cell.updated_at.replace(/\.(\d{1,6})(?=Z|[+-])/,(_,s)=>'.'+s.padEnd(3,'0').slice(0,3)));
  return editMs>now+5*60*1000;
}

function queueHistoryEdit(field) {
  try {
    if(state.store==='saiwaichou') throw Error('幸町の優・良はPCで入力・修正してください。');
    if(!state.historyDocument?.shared_editing) throw Error('共有用Apps Scriptを更新してから読み込み直してください。');
    const local=localHistoryEdits();
    const fields=JSON.parse(decodeURIComponent(field.dataset.historyEdit));
    const key=historyEditKey({...fields,store:state.historyDocument.base.store}), now=Date.now();
    // 自分の未送信を選び直すとき、誤った未来時刻を新しい編集へ引き継がない。
    // 共有済みの編集と、正常な時刻で送信中の編集は従来どおり比較する。
    const clockEdits=local.filter(c=>!(c?.pending===true && historyEditKey(c)===key && historyEditIsAhead(c,now)));
    const doc=mergeHistoryCells(state.historyDocument,clockEdits,{strict:false});
    const cell=newHistoryCell(doc,fields,field.value,now);
    if(historyEditIsAhead(cell,now)) throw Error('共有済みの編集時刻が未来のため保存できません。共有元の端末の日時を確認してください。');
    const next=local.filter(c=>historyEditKey(c)!==historyEditKey(cell));
    next.push({...cell,pending:true});
    if(next.length>30000) throw Error('端末の履歴の保存件数が上限に達しています。');
    localStorage.setItem(HISTORY_LOCAL_KEY+state.id,JSON.stringify(next));
    state.eventHistory=parsePrivateHistory(mergeHistoryCells(state.historyDocument,next,{strict:false}));
    state.historySaveNotice='端末に保存しました。共有へ送信中です。';
    flushHistoryEdits();
  } catch(error) { toast(`記号を保存できません：${error.message}`); }
}

async function flushHistoryEdits() {
  const id=state.id;
  if(!id || !state.historyDocument?.shared_editing || historySending.has(id)) return;
  historySending.add(id);
  try {
    while(true) {
      if(id!==state.id) break;
      const pending=localHistoryEdits(id).filter(c=>c?.pending===true);
      if(!pending.length) break;
      const model=parsePrivateHistory(state.historyDocument);
      const cells=[], batch=[];
      let blocked=0;
      for(const c of pending) {
        try {
          const cell=historyCell(c,model);
          // 進んだ時計で作った分も、日時修正後の正常な編集を止めず端末へ残す。
          if(historyEditIsAhead(cell)) { blocked++;continue; }
          if(cells.length<100) { cells.push(cell);batch.push(c); }
        } catch { blocked++; }
      }
      if(!cells.length) {
        state.historySaveNotice=`送信できない編集${count(blocked)}件は端末に残しています。現在の週表と端末の日時を確認し、「最新を読む」後に再送してください。`;
        state.historyRedraw?.();
        break;
      }
      const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),TIMEOUT_MS);
      let answer;
      try {
        const response=await fetch(`https://script.google.com/macros/s/${id}/exec`,{
          method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},signal:abort.signal,
          body:JSON.stringify({file:'event-history',cells}),
        });
        if(!response.ok) throw Error(`HTTP ${response.status}`);
        answer=await response.json();
        if(!answer.ok || !answer.history) throw Error((answer.error||'保存に対応したApps Scriptへ更新してください。')+'「最新を読む」後に再送してください。');
        parsePrivateHistory(answer.history);
      } finally { clearTimeout(timer); }
      const sent=new Map(batch.map(c=>[historyEditKey(c),c.updated_at]));
      const local=localHistoryEdits(id).map(c=>sent.get(historyEditKey(c))===c.updated_at?{...c,pending:false}:c);
      let acknowledged=true;
      try { localStorage.setItem(HISTORY_LOCAL_KEY+id,JSON.stringify(local)); }
      catch { acknowledged=false; /* 共有保存は成功済み。端末に残った未送信の原文は消さない。 */ }
      if(id!==state.id) break;
      state.historyDocument=answer.history;
      state.eventHistory=parsePrivateHistory(mergeHistoryCells(answer.history,local,{strict:false}));
      const remaining=local.filter(c=>c.pending===true).length;
      state.historySaveNotice=!acknowledged?'共有に保存しました。端末の送信済み状態を更新できませんでした。再読み込み時は再送します。':
        remaining?`端末に保存しました。残り${count(remaining)}件を共有へ送信中です。`:
        answer.keptNewer?'ほかの端末の新しい結果を表示しています。':'共有に保存しました。';
      // この端末の編集は上の保存済み一覧に残る。ほかの共有設定のキャッシュを上書きしない。
      state.historyRedraw?.();
      if(!acknowledged) break;
    }
  } catch(error) {
    if(id===state.id) {
      state.historySaveNotice=`共有への送信待ちです。端末には残っています。${error.message}`;
      state.historyRedraw?.();
    }
  } finally { historySending.delete(id); }
}

function machinePickupSection(racks) {
  const pickups = machinePickups(racks);
  return `
    <section aria-labelledby="machine-pickup-title">
      <h3 id="machine-pickup-title">機種別データピックアップ</h3>
      ${pickups.length ? `<p class="caption">合計差枚の多い順に最大7機種。機種名を押すと台一覧が見られます。</p>
      <div class="machine-pickups">
        ${pickups.map((x, i) => {
          const rank = i + 1;
          const rankClass = rank <= 3 ? ` pickup-rank-${rank}` : '';
          const winRateClass = x.judged
            ? (x.won * 100 >= x.judged * 70 ? ' pickup-win-high' : x.won * 2 >= x.judged ? ' pickup-win-good' : '')
            : ' zero';
          const netNotes = [x.estimated ? '推定を含む' : '', x.captured < x.racks ? `差枚取得 ${x.captured}/${x.racks}台` : '']
            .filter(Boolean);
          return `<div class="pickup-card${rankClass}"><table class="machine-pickup">
            <caption>
              <button type="button" class="row-link" data-machine="${esc(x.machine)}">
                <span class="pickup-rank num">${rank}位</span>
                <span class="pickup-name">${esc(displayMachineName(x.machine))}</span>
                <span class="pickup-chev" aria-hidden="true">›</span>
              </button>
              ${netNotes.length ? `<small class="pickup-notes">${netNotes.map(n => `<span class="pickup-note-tag">${n}</span>`).join(' ')}</small>` : ''}
            </caption>
            <thead><tr><th scope="col">機種別差枚</th><th scope="col">平均差枚</th><th scope="col">平均G数</th><th scope="col">勝率</th></tr></thead>
            <tbody><tr>
              <td class="pickup-total num ${tone(x.total)}">${signed(x.total)}</td>
              <td class="pickup-avg num ${tone(x.averageNet)}">${signed(x.averageNet)}</td>
              <td class="pickup-games num">${count(x.averageGames)}</td>
              <td class="pickup-win num${winRateClass}">${x.judged ? `${(100 * x.won / x.judged).toFixed(1)}% <span class="pickup-ratio">(${x.won}/${x.judged})</span>` : '—'}</td>
            </tr></tbody>
          </table></div>`;
        }).join('')}
      </div>` : '<p class="note">この日は差枚がわかる機種がありません。</p>'}
    </section>`;
}

/**
 * 日付を押したときのシート。機種別データピックアップ・差枚TOP50（11位からは折りたたみ）・強かった機種10選 →
 * 台や機種を押すと、その日のその機種の台一覧 → 台を押すと、その台のその日のデータ（利用者指定 2026-10-10）。
 */
function openDay(first) {
  const racksOf = (day) => state.model.byDay.get(`${state.store}|${day}`) ?? [];
  if (!racksOf(first).length) return;
  // 選んだ末尾（{day, digit}）。このシートの中だけ（閉じる・店を変えると消える）。日付を変えたら消す（suffixOf）。
  let suffix = null;
  const suffixOf = (view) => {
    if (suffix && suffix.day !== view.day) suffix = null;
    return suffix?.digit ?? null;
  };
  const rankRows = (list, from, index, digit) => list.map((r, i) => ({
    lead: from + i + 1, attrs: `data-machine-of="${index.get(r)}"`,
    main: `<span class="rack num">${r.rack}番${rackMark(r)}${suffixMark(r, digit)}</span><span class="machine" style="display:block">${esc(displayMachineName(r.machine))}</span>`,
    right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
  }));
  const netNameOf = (list) => (list.some(r => r.net != null && r.estimated) ? '推定差枚' : '差枚');

  const dayView = (view) => {
    const racks = racksOf(view.day);
    view.items = racks;
    const index = new Map(racks.map((r, i) => [r, i]));
    const net = dayNet(racks);
    const {top, machines} = daySummary(racks);
    const netName = netNameOf(racks);
    const digit = suffixOf(view);
    return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateLabel(view.day)}</h2>
      ${eventLine(view.day)}
      ${birthdayLines(view.day)}
      ${net.total != null ? `<p class="total total-card total-${tone(net.total)}"><span class="label">総${netName}</span>
        <span class="value num ${tone(net.total)}">${signed(net.total)}</span>
        <span class="sub num">${netName}がわかった台 ${net.captured}/${net.racks}台${lowGamesNote(racks)}</span></p>` : ''}
      ${net.winRate ? `<p class="total total-card total-rate" data-win-rate><span class="label">勝率</span>
        <span class="value num zero">${winRateText(net.won, net.judged)}</span>
        <span class="sub num">${net.judged}台中${net.won}台プラス（${netName}の分からない台が多い日）</span></p>` : ''}
      ${machinePickupSection(racks)}
      <h3>TOP50</h3>
      <p class="caption">${netName}の多い順。台を押すと、その機種の台一覧が見られます。末尾を選ぶと、その末尾の台番に印が付きます（機種の台一覧にも引き継ぎます）。</p>
      ${top.length ? suffixPicker(digit) : ''}
      ${top.length ? tapList(rankRows(top.slice(0, TOP_RACKS_OPEN), 0, index, digit))
        : '<p class="note">この日は差枚がわかる台がありません。</p>'}
      ${top.length > TOP_RACKS_OPEN ? `<details class="more"><summary>${TOP_RACKS_OPEN + 1}〜${top.length}位を見る（${top.length - TOP_RACKS_OPEN}台）</summary>
        ${tapList(rankRows(top.slice(TOP_RACKS_OPEN), TOP_RACKS_OPEN, index, digit), TOP_RACKS_OPEN + 1)}</details>` : ''}
      <h3>強かった機種10選</h3>
      <p class="caption">1台あたりの平均回転数（2台以上ある機種）</p>
      ${machines.length ? tapList(machines.map((x, i) => ({
        lead: i + 1, attrs: `data-machine="${esc(x.machine)}"`,
        main: `<span class="machine" style="display:block">${esc(displayMachineName(x.machine))}</span>`,
        right: `<span class="value num" style="display:block">${count(x.average)}G</span><span class="small num">${x.racks}台</span>`,
      }))) : '<p class="note">2台以上ある機種がありません。</p>'}
      ${(() => {
        const others = nonVarietyRacks(racks, state.store);
        return others.length ? `<h3>全機種の台一覧</h3>
      <p class="caption">バラエティ以外の台を1つの一覧で。機種で絞り込み、回転数・${netName}で並べ替えられます。</p>
      ${tapList([{lead: '', attrs: 'data-all-racks', main: '<span class="machine" style="display:block">全機種の台一覧を見る</span>',
        right: `<span class="small num">${new Set(others.map(r => r.machine)).size}機種・${others.length}台</span>`}])}` : '';
      })()}
      ${netEstimateNote(racks) ? `<p class="note">${esc(netEstimateNote(racks))}</p>` : ''}`;
  };

  const machineView = (view) => {
    const racks = racksOf(view.day);
    view.items = racks;
    const index = new Map(racks.map((r, i) => [r, i]));
    const list = racks.filter(r => sameMachineName(r.machine, view.machine)).sort((a, b) => a.rack - b.rack);
    const netName = netNameOf(list);
    view.rackList = list;
    const nets = list.filter(r => r.net != null);
    const total = nets.length ? nets.reduce((s, r) => s + r.net, 0) : null;
    const average = list.length ? Math.round(list.reduce((s, r) => s + r.games, 0) / list.length) : 0;
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateLabel(view.day)}</p>
      <h2 id="sheet-title" class="long">${esc(displayMachineName(view.machine))}</h2>
      <p class="event-line num">${list.length}台・平均${count(average)}G</p>
      ${suffixClear(suffixOf(view))}
      ${total != null ? `<p class="total total-card total-${tone(total)}"><span class="label">この機種の総${netName}</span>
        <span class="value num ${tone(total)}">${signed(total)}</span>
        <span class="sub num">${netName}がわかった台 ${nets.length}/${list.length}台</span></p>` : ''}
      <h3>台一覧</h3>
      <p class="caption">台番号の順。台を押すと、その台のデータが見られます。</p>
      ${tapList(list.map(r => ({
        lead: '', attrs: `data-rack="${index.get(r)}"`, current: !!view.picked && r.rack === view.picked.rack,
        main: `<span class="machine num" style="display:block">${r.rack}番${rackMark(r)}${suffixMark(r, suffixOf(view))}</span><span class="rack num">BB ${r.bb}・RB ${r.rb}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      })))}`;
  };

  // 全機種の台一覧（点数は出さない。2026-11-01 利用者「共有カレンダーには採点はいらないよ」）。
  const allRacksView = (view) => {
    const racks = racksOf(view.day);
    view.items = racks;
    const index = new Map(racks.map((r, i) => [r, i]));
    const others = nonVarietyRacks(racks, state.store);
    const names = [...new Set(others.map(r => r.machine))].sort((a, b) => displayMachineName(a).localeCompare(displayMachineName(b), 'ja'));
    const only = names.includes(view.only) ? view.only : '';
    const list = allRacksOrder(others.filter(r => !only || r.machine === only), view.sort);
    const netName = netNameOf(list);
    view.rackList = list;
    const nets = list.filter(r => r.net != null);
    const total = nets.length ? nets.reduce((sum, r) => sum + r.net, 0) : null;
    const varietyScope = rainbowVarietyMax(state.store) === 1 ? '1台だけ' : `1〜${rainbowVarietyMax(state.store)}台`;
    const varietyCaption = Object.hasOwn(MERUHEN_STORES, state.store)
      ? `バラエティ（${varietyScope}の機種）はバラエティ${RAINBOW}にあります。`
      : `バラエティ（${varietyScope}の機種）以外の台です。`;
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateLabel(view.day)}</p>
      <h2 id="sheet-title">全機種の台一覧</h2>
      <p class="event-line num">${only ? `${esc(displayMachineName(only))}・` : `${names.length}機種・`}${list.length}台</p>
      ${total != null ? `<p class="total total-card total-${tone(total)}"><span class="label">総${netName}</span>
        <span class="value num ${tone(total)}">${signed(total)}</span>
        <span class="sub num">${netName}がわかった台 ${nets.length}/${list.length}台</span></p>` : ''}
      <label class="variety-sort">機種 <select data-all-machine aria-label="機種">
        <option value=""${only ? '' : ' selected'}>すべての機種</option>
        ${names.map(name => `<option value="${esc(name)}"${name === only ? ' selected' : ''}>${esc(displayMachineName(name))}</option>`).join('')}</select></label>
      <label class="variety-sort">並べ方 <select data-all-sort aria-label="並べ方">
        ${Object.entries(ALL_RACKS_SORTS).map(([key, label]) => `<option value="${key}"${view.sort === key ? ' selected' : ''}>${label.replace('差枚', netName)}</option>`).join('')}</select></label>
      <p class="caption">${varietyCaption}台を押すと、その台のデータが見られます。</p>
      ${suffixClear(suffixOf(view))}
      ${list.length ? tapList(list.map(r => ({
        lead: '', attrs: `data-rack="${index.get(r)}"`,
        main: `<span class="machine num" style="display:block">${r.rack}番${rackMark(r)}${suffixMark(r, suffixOf(view))}</span><span class="rack">${esc(displayMachineName(r.machine))}</span><span class="rack num" style="display:block">BB ${r.bb}・RB ${r.rb}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      }))) : '<p class="note">この日はバラエティ以外の台の記録がありません。</p>'}`;
  };

  openSheet({
    first: {kind: 'day', day: first},
    body: (view) => (view.kind === 'day' ? dayView(view) : view.kind === 'machine' ? machineView(view)
      : view.kind === 'allRacks' ? allRacksView(view) : rackView(view)),
    // 押した行は、いま出している画面の日の台（描いたときの items）から選ぶ。
    onRow: (row, push, view) => {
      const racks = view.items ?? [];
      if (row.dataset.allRacks != null) {
        const saved = store.get(ALL_RACKS_SORT_KEY);
        push({kind: 'allRacks', day: view.day, only: '', sort: Object.hasOwn(ALL_RACKS_SORTS, saved) ? saved : 'rack'});
      } else if (row.dataset.rack != null) push(rackPage(racks[Number(row.dataset.rack)], view.rackList));
      else if (row.dataset.machineOf != null) {
        const picked = racks[Number(row.dataset.machineOf)];
        push({kind: 'machine', machine: picked.machine, picked, day: view.day});
      } else push({kind: 'machine', machine: row.dataset.machine, day: view.day});
    },
    onSuffix: (button, view) => {
      suffix = button.matches('[data-suffix-clear]') ? null : {day: view.day, digit: Number(button.dataset.suffixDigit)};
    },
    onChange: (select, view) => {
      if (select.matches('[data-all-machine]')) view.only = select.value;
      if (select.matches('[data-all-sort]')) {
        view.sort = select.value;
        store.set(ALL_RACKS_SORT_KEY, view.sort);
      }
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
      if (row.dataset.idleRack != null) push(rackPage(view.racks[Number(row.dataset.idleRack)].latest, view.racks.map(x => x.latest)));
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
  let saved;
  try {
    saved = storedRainbowMarks(localStorage.getItem(MARKS_KEY));
  } catch {
    toast('保存済みの🌈を確認できません。元の内容を保持して操作を止めました。');
    return;
  }
  const old = saved.find(m => m.store === s && m.day === day && m.rack === rack);
  const mark = {store: s, day, rack, on: !r.rainbow, updated_at: markTime(Date.now(), r.rainbowAt, old?.updated_at)};
  const marks = mergeMarks(saved, [mark]);
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
    const result = await sendRainbowBatches(marks, async body => {
      const response = await fetch(`https://script.google.com/macros/s/${state.id}/exec`, {
        method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, credentials: 'omit',
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`共有先の応答：${response.status}`);
      return response.json();
    }, async () => sharedRainbowCanBatch(await getJson(`https://script.google.com/macros/s/${state.id}/exec?file=diagnostic`)));
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
  const savedSort = store.get(VARIETY_SORT_KEY);
  const first = {kind: 'variety', day: mode === 'grid' ? today : days[0], todayDay: today, mode,
    sort: savedSort === 'gap' || Object.hasOwn(ROTATION_SORTS, savedSort) ? savedSort : 'grid'};
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
    // 回転数で並べたときだけ、台名の下に表示中の日の回転数を出す（行の番号は元の rows の位置。押したときの台を取り違えない）。
    const byGames = view.sort !== 'grid' && Object.hasOwn(ROTATION_SORTS, view.sort);
    const gamesText = x => (Number.isFinite(x.record?.games) ? `${x.record.games.toLocaleString('ja-JP')}G` : '回転数なし');
    const head = window.map(d => `<span class="d num${d === view.day ? ' today' : ''}">${Number(d.slice(8))}</span>`).join('');
    return `<p class="caption">マスを押すとその日の${RAINBOW}を付け外し（記録の無い日は押せません）。右端＝最後の${RAINBOW}から何日。台番号を押すとその台のデータ。</p>
      <div class="rotation" role="table" aria-label="ローテーション表">
        <div class="r head" role="row"><span class="who">台</span>${head}<span class="gap">日数</span></div>
        ${rotationOrder(rows, view.sort).map(x => `<div class="r" role="row">
          <button type="button" class="who row-link" data-variety-rack="${rows.indexOf(x)}"${x.open ? '' : ' disabled'}><span class="num">${x.rack}</span><span class="m">${esc(displayMachineName(x.machine))}</span>${byGames ? `<span class="g">${gamesText(x)}</span>` : ''}</button>
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
      ${Object.entries(ROTATION_SORTS).map(([key, label]) => `<option value="${key}"${view.sort === key ? ' selected' : ''}>${label}</option>`).join('')}
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
    view.weekShown = [...report.noRainbow, ...marked];
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
      // 前後の台は、画面に並んでいる順（候補は「候補」→「🌈が付いた台」、空き順は空きの長い順）で開ける台だけ。
      if (row.dataset.weekRack != null) {
        const r = view.weekRows[Number(row.dataset.weekRack)]?.openRecord;
        if (r) push(rackPage(r, view.weekShown.map(x => x.openRecord).filter(Boolean)));
        return;
      }
      const x = row.dataset.varietyRack != null ? view.rows[Number(row.dataset.varietyRack)] : null;
      const shown = view.sort === 'gap' ? byLongestGap(view.rows, view.day) : rotationOrder(view.rows, view.sort);
      if (x?.open) push(rackPage(x.open, shown.map(y => y.open).filter(Boolean)));
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
    const netName = pscube ? 'サイトの差枚・サイトセブンやアナスロからの推定差枚' : '推定差枚。ジャグラーオンラインの差枚があればそれ';
    const title = view.period === 'day' ? `${dateLabel(view.day)}の末尾順位` : `${periodLabel}（${shortDate(report.start)}〜${shortDate(view.day)}）の末尾順位`;
    return `<h2 id="sheet-title" class="sr-only">末尾別データまとめ</h2>
      <p class="caption">${esc(storeLabel(state.store))}・末尾${suffixesOf(state.store).join('・')}とゾロ目（下2桁が${endings}。末尾の集計にも入る）。順位は平均差枚（${netName}）の高い順です。</p>
      <label class="variety-sort">比較期間 <select data-suffix-period>${Object.entries(SUFFIX_PERIODS).map(([k, [label]]) => `<option value="${k}"${k === view.period ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
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
      else if (row.dataset.suffixRack != null) {
        // 画面は日ごとにまとめて並ぶ。その順で前後の台へ（日の境目では次の日の先頭へ）。
        const listDays = [...new Set(view.entries.map(r => r.day))];
        push(rackPage(view.entries[Number(row.dataset.suffixRack)], listDays.flatMap(d => view.entries.filter(r => r.day === d))));
      }
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
      <h1 class="headline">共有カレンダー</h1>
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
  if (state.id === id && reload.disabled) return;
  if (state.id !== id) {
    state.model = null; state.eventHistory=null; state.historyDocument=null; state.historySaveNotice='';state.recommendationNotice='';
    document.querySelectorAll('.sheet-backdrop [data-close]').forEach(e=>e.click());
    state.historyRedraw=null;
    app.innerHTML='<p class="status">保存した記録を読み込んでいます…</p>';
  }
  state.loading = false; reload.disabled = true;
  state.auxStatus = {};
  state.id = id;
  state.sources = {meruhen:'保存済みデータを表示', pscube:'保存済みデータを表示'};
  store.set(ID_KEY, id);
  reload.hidden = false;
  const base = `https://script.google.com/macros/s/${id}/exec`;
  try {
    const results = await Promise.allSettled([readViewerHistory(base, 'meruhen'), readViewerHistory(base, 'pscube'), readOfflineMetadata(id)]);
    const [m, p, metadata] = results.map(r => r.status === 'fulfilled' ? r.value : null);
    if (state.id !== id) return;
    const held = shareRefreshHeld(id);
    if (m || p) {
      state.notice = results.some(r => r.status === 'rejected')
        ? '一部の保存データを開けませんでした。「最新を読む」で復元してください。'
        : '端末に保存したデータを表示しています。更新するには「最新を読む」を押してください。';
      if (held) state.notice += ` ${REFRESH_HELD_NOTICE}`;
      showDocuments(m, p, metadata || {});
      flushHistoryEdits();
      reload.disabled = false;
      return;
    }
    if (held) {
      app.innerHTML = `<p class="status" role="status">${esc(REFRESH_HELD_NOTICE)}</p>`;
      reload.disabled = false;
      return;
    }
    if (results.some(r => r.status === 'rejected')) throw new Error('保存した履歴を開けませんでした。');
  } catch {
    if (state.id !== id) return;
    app.innerHTML = '<p class="status">保存したデータを開けませんでした。オンラインで右上の「最新を読む」を押してください。保存データは消していません。</p>';
    reload.disabled = false;
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
      return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateLabel(view.day)}</h2>
      ${eventLine(view.day)}
      ${birthdayLines(view.day)}
      <p class="total total-card total-rate" data-win-rate><span class="label">勝率</span>
        <span class="value num zero">${winRateText(s.won, s.judged)}</span>
        <span class="sub num">${s.judged}台中${s.won}台プラス</span></p>
      <p class="note">保存したアナスロのHTMLから数えた、この日の勝ち負けだけです。グラフの終点がゼロ線より上で終わった台をプラスとし、回っていない台・終わり方の分からない台は数えていません（この日の台 ${s.racks}台）。台ごとのデータはこのページにはありません。</p>`;
    },
    onRow: () => {},
  });
}

/** 台もHTMLの集計も無い日の、キャラ誕生日だけのシート。 */
function openBirthdays(first) {
  if (!characterBirthdaysOn(state.birthdays, first).length) return;
  openSheet({
    first: {kind: 'birthday', day: first},
    body: (view) => {
      return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateLabel(view.day)}</h2>
      ${eventLine(view.day)}
      ${birthdayLines(view.day)}
      <p class="note">この日は台のデータがありません。</p>`;
    },
    onRow: () => {},
  });
}

// 4機種の構成はPCの定義を使い、顔文字の未送信分だけを接続先ごとに端末保存する。
const recommendationSending=new Set();
const recommendationRowsCache=new WeakMap();
function validRecommendationResult(raw) {try {recommendationResult(raw);return true;}catch{return false;}}
function localRecommendationResults(id=state.id) {
  const text=store.get(`database-share-recommendation-results:${id}`);
  if(!text)return [];
  const raw=JSON.parse(text);
  if(!Array.isArray(raw))throw Error('端末の台別結果を読めません。');
  return raw;
}
function recommendationView(view) {
  const plans=recommendationPlans(state.historyDocument?.recommendations??[]);
  if(!plans.some(p=>p.week===view.recWeek))view.recWeek=plans[0].week;
  const current=plans.find(p=>p.week===view.recWeek),days=recommendationDays(view.recWeek);
  let cached=[];
  try{cached=localRecommendationResults();}catch(e){state.recommendationNotice=e.message;}
  const results=mergeRecommendationResults(state.historyDocument?.recommendation_results??[],cached,{strict:false});
  const resultIndex=new Map();
  for(const raw of results)try{const r=recommendationResult(raw);resultIndex.set(recommendationResultKey(r),r);}catch{/* 不正な原文は保存先に残す。 */}
  const pending=cached.filter(r=>r?.pending===true&&validRecommendationResult(r));
  const byDay=state.model.byDay, machineKey=JSON.stringify(current.machines);
  let recData=recommendationRowsCache.get(byDay);
  // 表示中の週だけを展開する。顔文字の変更や保存で描き直すときは同じ行を使う。
  if(recData?.week!==current.week||recData.machineKey!==machineKey) {
    const records=days.flatMap(day=>byDay.get(`nagamachiminami|${day}`)??[]);
    recData={week:current.week,machineKey,
      rows:current.machines.map(machine=>recommendationRows(records,current.week,machine))};
    recommendationRowsCache.set(byDay,recData);
  }
  view.recRows=[];
  return `<div class="history-navigation"><label>対象週 <select data-recommendation-week aria-label="4大オススメの対象週">${plans.map(p=>`<option value="${p.week}"${p===current?' selected':''}>${p.week}〜${recommendationDays(p.week)[6]}</option>`).join('')}</select></label></div>
    <p class="note">機種構成・週の追加はPCで行います。顔文字はここで選んで保存できます。</p>
    <p class="note" role="status" data-recommendation-status>${esc(state.recommendationNotice||(pending.length?'顔文字は端末に保存済み、共有への送信待ちです。':state.historyDocument?.recommendation_results_editing?'顔文字を選ぶと共有へ保存します。':'顔文字は端末に保存できます。共有するには閲覧・共有用Apps Scriptの更新が必要です。'))}</p>
    ${pending.length?'<button type="button" class="pill pill-outline" data-recommendation-retry>未送信の顔文字を再送</button>':''}
    ${current.machines.map((machine,slot)=>{
      const rows=recData.rows[slot];
      return `<section class="history-week recommendation-card"><h3>${esc(displayMachineName(machine))}</h3>
      <div class="history-overflow"><table class="recommendation-table"><thead><tr><th>台番号</th>${days.map((d,i)=>`<th>${'月火水木金土日'[i]}<small>${d.slice(5)}</small></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${row.rack}番</th>${row.cells.map((r,i)=>{
        const at=view.recRows.length;if(r)view.recRows.push(r);
        const value=r?.net,fields={store:'nagamachiminami',week:current.week,machine,rack:row.rack,day:days[i]},saved=resultIndex.get(recommendationResultKey(fields));
        const choice=saved?.value==null?'auto':saved.value,face=choice==='auto'?recommendationFace(value):choice;
        // 欄には顔文字だけを出し、透明の選択欄を上に重ねる。選択欄の文字（「😌 自動」）と矢印は1列（約40px）に
        // 収まらず、iPhoneで顔文字が見切れていた（2026-10-27）。押すと今までどおり選択肢が出る。
        return `<td><span class="recommendation-pick"><span class="recommendation-face-shown" aria-hidden="true">${face||'—'}<span class="recommendation-caret">▾</span></span><select class="recommendation-face" data-recommendation-result="${esc(encodeURIComponent(JSON.stringify(fields)))}" aria-label="${days[i]} ${row.rack}番の顔文字">${['auto','',...RECOMMENDATION_FACES].map(f=>`<option value="${f}"${f===choice?' selected':''}>${f==='auto'?`${recommendationFace(value)||'—'} 自動`:f||'空欄'}</option>`).join('')}</select></span>${r?`<button type="button" class="row recommendation-cell" data-recommendation-rack="${at}" aria-label="${days[i]} ${row.rack}番のデータを開く">`:'<span class="recommendation-cell">'}<small class="num ${value==null?'zero':tone(value)}">${value==null?'—':`${r.estimated?'約':''}${signed(value)}`}</small>${r?'</button>':'</span>'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="note">この週の保存データはまだありません。</p>'}</section>`;
    }).join('')}
    <p class="note">「自動」は台ごとの差枚で判定：3,000枚以上😍 · 1,000枚以上😀 · 0枚以上😌 · マイナス🥶 · 不明—。約は推定差枚です。顔文字だけ手動で変更でき、差枚は変更しません。</p>`;
}
function queueRecommendationResult(field) {
  try {
    const fields=JSON.parse(decodeURIComponent(field.dataset.recommendationResult)),key=recommendationResultKey(fields),local=localRecommendationResults();
    let now=Date.now();
    for(const r of [...(state.historyDocument?.recommendation_results??[]),...local]) {
      try {if(recommendationResultKey(r)===key)now=Math.max(now,recommendationEditMs(r)+1);}
      catch { /* 不正な原文は残し、有効な編集だけを時刻比較する。 */ }
    }
    if(now>Date.now()+5*60*1000)throw Error('共有済みの編集時刻が未来です。端末の日時を確認してください。');
    const entry=recommendationResult({...fields,value:field.value==='auto'?null:field.value,updated_at:new Date(now).toISOString(),device:'shared'});
    const pending=local.filter(r=>recommendationResultKey(r)!==key);pending.push({...entry,pending:true});
    if(pending.length>30000)throw Error('端末の結果一覧が上限に達しています。');
    localStorage.setItem(`database-share-recommendation-results:${state.id}`,JSON.stringify(pending));
    state.recommendationNotice='顔文字を端末に保存しました。共有への送信待ちです。';
    flushRecommendationResults();
  }catch(e){state.recommendationNotice=`顔文字を保存できません：${e.message}`;}
}
async function flushRecommendationResults() {
  const id=state.id,key=`database-share-recommendation-results:${id}`;
  if(recommendationSending.has(id))return;
  if(!state.historyDocument?.recommendation_results_editing){state.recommendationNotice='顔文字は端末に保存済みです。共有するには閲覧・共有用Apps Scriptを更新し「最新を読む」後に再送してください。';state.historyRedraw?.();return;}
  recommendationSending.add(id);
  try {
    while(state.id===id) {
      const pending=localRecommendationResults(id).filter(r=>r?.pending===true&&validRecommendationResult(r)).slice(0,100);if(!pending.length)break;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);let answer;
      try {
        const response=await fetch(`https://script.google.com/macros/s/${id}/exec`,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({file:'event-history',cells:[],recommendation_results:pending}),signal:controller.signal});
        if(!response.ok)throw Error(`共有へ送信できません（${response.status}）。`);
        answer=await response.json();
      }finally{clearTimeout(timer);}
      if(!answer.ok||!answer.history?.recommendation_results_editing)throw Error(answer.error||'共有の保存確認ができませんでした。');
      const returned=mergeRecommendationResults(answer.history.recommendation_results??[],[],{strict:false});
      for(const r of pending)if(!returned.some(v=>recommendationResultKey(v)===recommendationResultKey(r)&&recommendationNotOlder(v,r)))throw Error('共有の保存確認ができませんでした。');
      const remaining=localRecommendationResults(id).map(r=>{
        if(!pending.some(sent=>JSON.stringify(sent)===JSON.stringify(r)))return r;
        const saved=returned.find(v=>recommendationResultKey(v)===recommendationResultKey(r)&&recommendationNotOlder(v,r));
        return {...saved,pending:false};
      });
      localStorage.setItem(key,JSON.stringify(remaining));
      if(state.id===id){state.historyDocument=answer.history;state.eventHistory=parsePrivateHistory(mergeHistoryCells(answer.history,localHistoryEdits(id),{strict:false}));state.recommendationNotice=remaining.some(r=>r?.pending===true&&validRecommendationResult(r))?'残りの顔文字を送信中です。':'顔文字を共有へ保存しました。';}
    }
  }catch(e){state.recommendationNotice=`顔文字は共有への送信待ちです。端末には残っています。${e.message}`;}
  finally{recommendationSending.delete(id);if(state.id===id)state.historyRedraw?.();}
}

/** 画像から記録した長町南のイベント履歴。記号は意味付けせず、同日の機種一覧へつなぐ。 */
function openEventHistory() {
  if (!['nagamachiminami','saiwaichou'].includes(state.store)) return;
  const location=state.store, saiwaichou=location==='saiwaichou';
  const types=saiwaichou?['バラエティ']:[...HISTORY_TYPES,RECOMMENDATION_TYPE];
  let varietyModel;
  if(saiwaichou) {
    if(!state.historyDocument?.saiwaichou_variety) { toast('PCで幸町のバラエティ履歴を共有へ反映してください。');return; }
    try { varietyModel=parsePrivateHistory(state.historyDocument.saiwaichou_variety,location); }
    catch(error) { toast(`幸町の履歴を読めません：${error.message}`);return; }
  }
  const index = new Map();
  for (const [key, records] of state.model.byDay) {
    if (key.startsWith(location+'|')) index.set(key.slice(location.length+1), new Set(records.map(r=>r.machine)));
  }
  // 幸町：機種のその日の合計差枚（全台・週表の台数と一致するときだけ）。
  const machineNet=(item,day)=>{
    const name=historySavedName(item,index.get(day)??new Set());
    return name?saiwaichouMachineNet((state.model.byDay.get(`${location}|${day}`)??[]).filter(r=>r.machine===name),item.count):null;
  };
  // 手入力の優・良（赤字の判定用。前週にまたがる日も同じ機種名・明示的な保存名の週表から探す）。
  const savedGrade=(item,day)=>{
    for(const w of varietyModel.weeks) {
      if(day<w.from||day>w.to) continue;
      const m=w.machines.find(m=>m.name===item.name||(item.record_name&&m.record_name===item.record_name));
      if(m) return m.results[Math.round((Date.parse(`${day}T00:00:00Z`)-Date.parse(`${w.from}T00:00:00Z`))/86400000)];
    }
    return '';
  };
  // 空欄のマスは差枚から優・良を自動で表示する（2026-10-29 利用者指定、保存しない）。
  const autoModel=saiwaichou?{...varietyModel,weeks:varietyModel.weeks.map(w=>({...w,machines:w.machines.map(m=>({...m,
    results:m.results.map((v,i)=>v||saiwaichouGrade(machineNet(m,historyDay(w.from,i)))) }))}))}:null;
  const historyView = view => {
    const model=(saiwaichou?autoModel:state.eventHistory)??{weeks:[],symbols:[]};
    const weeks = model.weeks.filter(w=>w.type===view.type).sort((a,b)=>b.from.localeCompare(a.from));
    if (!weeks.some(w=>w.from===view.week)) view.week=weeks[0]?.from;
    const selected=weeks.find(w=>w.from===view.week), weekIndex=weeks.indexOf(selected);
    const lastRecordDay=selected?[...index.keys()].filter(d=>d>=selected.from&&d<=selected.to).sort().at(-1):null;
    const gapEnd=saiwaichou?saiwaichouGapEnd(lastRecordDay):null;
    const heading = `<h2 id="sheet-title">${saiwaichou?'幸町のバラエティ履歴':'長町南のイベント履歴'}</h2><div class="history-types">${types.map(t=>`<button type="button" class="pill ${t===view.type?'':'pill-outline'}" data-history-type="${esc(t)}" aria-pressed="${t===view.type}">${esc(t)}</button>`).join('')}</div>`;
    if(view.type===RECOMMENDATION_TYPE) return heading+recommendationView(view);
    let pending=0;
    try { if(!saiwaichou) pending=localHistoryEdits().filter(c=>c.pending===true).length; } catch { /* 読み込み時の警告を表示する。 */ }
    const notice = (state.historyNotice ? `<p class="note">${esc(state.historyNotice)}</p>` : '')
      + `<p class="note" role="status" data-history-save-status>${esc(saiwaichou?'優・良は差枚から自動で表示します。手入力・修正はPCで行います。':state.historyDocument?.shared_editing?(state.historySaveNotice||'顔文字を選ぶと共有へ保存します。'):'記号を編集するには共有用Apps Scriptを更新してから読み込み直してください。')}</p>`
      + (pending?`<button type="button" class="pill pill-outline" data-history-retry>未送信${count(pending)}件を再送する</button>`:'');
    const rejected = model.rejected ? `<p class="note">形式が合わない編集${count(model.rejected)}件を表示していません。</p>` : '';
    if (!weeks.length) return `${heading}${notice}<p class="note">この種別の週表はまだありません。</p>`;
    const navigation=`<div class="history-navigation" aria-label="週を選ぶ">
      <label for="history-week-select">表示する週</label>
      <div class="history-week-picker"><button type="button" class="pill pill-outline" data-history-week-step="1" aria-label="前の週"${weekIndex>=weeks.length-1?' disabled':''}>‹</button>
      <select id="history-week-select" data-history-week aria-label="対象週">${weeks.map(w=>`<option value="${w.from}"${w===selected?' selected':''}>${esc(w.from)} 〜 ${esc(w.to)}</option>`).join('')}</select>
      <button type="button" class="pill pill-outline" data-history-week-step="-1" aria-label="次の週"${weekIndex<=0?' disabled':''}>›</button></div>
      <div class="history-week-meta"><span>${selected.machines.length}機種 · ${weekIndex+1} / ${weeks.length}週</span><button type="button" class="history-latest" data-history-latest${weekIndex===0?' disabled':''}>最新の週へ</button></div>
      ${saiwaichou?`<p class="history-gap-note">${gapEnd?`赤字：${esc(gapEnd)}までの5日間、+${SAIWAICHOU_GAP_NET}枚超えなし（今日を除く）`:'この週は記録がないため赤字判定はしません。'}</p>`:''}</div>`;
    return `${heading}${navigation}${notice}${rejected}${[selected].map(w=>{
      const days=Array.from({length:7},(_,i)=>historyDay(w.from,i));
      // 日ごとの、表の上から下の順の機種（記録のある機種だけ）。開いた画面から「次の機種」「次の台」で下の行へ送るため（2026-10-22 利用者）。
      view.dayNames=Object.fromEntries(days.map(d=>[d,[...new Set(w.machines.map(item=>historySavedName(item,index.get(d)??new Set())).filter(Boolean))]]));
      const rows=w.machines.map(item=>`<tr><th scope="row"><span${saiwaichou&&saiwaichouGap(gapEnd,d=>({net:machineNet(item,d),grade:savedGrade(item,d)}))?' class="history-grade-gap"':!saiwaichou&&w.type==='バラエティ'&&!item.results.includes('😍')?' class="history-no-heart"':''}>${esc(displayMachineName(item.name))}</span><small>${count(item.count)}台</small></th>${days.map((d,i)=>{
        const name=historySavedName(item,index.get(d)??new Set());
        const key=encodeURIComponent(JSON.stringify({type:w.type,week:w.from,machine:item.name,day:d}));
        const result=saiwaichou?`<span class="history-symbol ${item.results[i]==='優'?'history-excellent':item.results[i]==='良'?'history-good':'history-empty'}">${esc(item.results[i]||'—')}</span>`:`<select class="history-symbol" data-history-edit="${esc(key)}"${state.historyDocument?.shared_editing?'':' disabled'} aria-label="${esc(d)} ${esc(displayMachineName(item.name))}の結果">${['',...model.symbols].map(s=>`<option value="${esc(s)}"${s===item.results[i]?' selected':''}>${esc(s||'—')}</option>`).join('')}</select>`;
        return `<td><span class="history-mobile-day" aria-hidden="true">${'月火水木金土日'[i]}<small>${d.slice(8)}</small></span>${result}${name ? `<button type="button" class="row history-cell" data-history-machine="${esc(name)}" data-history-day="${d}" aria-label="${esc(d)} ${esc(displayMachineName(name))}のデータを開く"><span class="history-open-label">開く </span>↗</button>` : '<small class="history-no-record"><span class="history-no-record-label">この日の記録なし</span><span class="history-mobile-none" aria-hidden="true">—</span></small>'}</td>`;
      }).join('')}</tr>`).join('');
      return `<section class="history-week"><h3>${esc(w.from)}〜${esc(w.to)}</h3>${w.lineup_day?`<p class="note">分類日：${esc(w.lineup_day)}（作成時の構成で固定）</p>`:''}<div class="history-overflow"><table class="history-table"><thead><tr><th>機種名・台数</th>${days.map(d=>`<th>${esc(shortDateWeek(d))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('')}<p class="note">${saiwaichou?'空欄の日は差枚から自動（2,500枚以上＝優、0〜2,499枚＝良、マイナス・不明は—）。手入力はPCのみで優先。':'記号の意味は未設定です。'}「↗」は、その機種・その日の保存データを表示します。</p>`;
  };
  const racksOf=(day,machine)=>(state.model.byDay.get(`${location}|${day}`)??[]).filter(r=>r.machine===machine).sort((a,b)=>a.rack-b.rack);
  const machineView = view => {
    const racks=racksOf(view.day,view.machine);
    view.items=racks;
    // 台のデータの前後は、表の順に機種をまたいで送る（この機種の最後の台の次は、下の行の機種の台）。日付を送ったあとはこの機種の中だけ。
    view.rackOrder=view.names&&view.day===view.namesDay?view.names.flatMap(m=>racksOf(view.day,m)):racks;
    return `<p class="store">${esc(storeLabel(location))}　${dateLabel(view.day)}</p><h2 id="sheet-title" class="long">${esc(displayMachineName(view.machine))}</h2><p class="caption">台を押すと、その日のデータを開きます。</p>${racks.length?tapList(racks.map((r,i)=>({lead:'',attrs:`data-history-rack="${i}"`,main:`<span class="machine num" style="display:block">${r.rack}番${rackMark(r)}</span><span class="rack num">BB ${r.bb}・RB ${r.rb}</span>`,right:`${netCell(r)}<span class="small num">${count(r.games)}G</span>`}))):'<p class="note">この日の機種データはありません。</p>'}`;
  };
  state.historyRedraw=openSheet({first:{kind:'history',type:types[0]},
    body:view=>view.kind==='history'?historyView(view):view.kind==='historyMachine'?machineView(view):rackView(view),
    onAction:(action,view)=>{
      if(action.dataset.historyType) { view.type=action.dataset.historyType; view.week=null; }
      if(view.type===RECOMMENDATION_TYPE) {
        if(action.dataset.recommendationRetry!=null)flushRecommendationResults();
        return;
      }
      const weeks=((saiwaichou?varietyModel:state.eventHistory)?.weeks??[]).filter(w=>w.type===view.type).sort((a,b)=>b.from.localeCompare(a.from));
      if(action.dataset.historyWeekStep) view.week=weeks[weeks.findIndex(w=>w.from===view.week)+Number(action.dataset.historyWeekStep)]?.from??view.week;
      if(action.dataset.historyLatest!=null) view.week=weeks[0]?.from;
    },
    onChange:(field,view)=>{
      if(field.matches('[data-recommendation-week]')) {view.recWeek=field.value;view.scroll=0;}
      if(field.matches('[data-recommendation-result]'))queueRecommendationResult(field);
      if(field.matches('[data-history-edit]')) queueHistoryEdit(field);
      if(field.matches('[data-history-week]')) { view.week=field.value; view.scroll=0; }
    },
    onRow:(row,push,view)=>{
      if(row.dataset.historyRetry!=null) { flushHistoryEdits(); return; }
      if(row.dataset.recommendationRack!=null) {const r=view.recRows[Number(row.dataset.recommendationRack)];push(rackPage(r,view.recRows));return;}
      if(view.kind==='history' && row.dataset.historyMachine && row.dataset.historyDay) push({kind:'historyMachine',machine:row.dataset.historyMachine,day:row.dataset.historyDay,picked:null,names:view.dayNames?.[row.dataset.historyDay],namesDay:row.dataset.historyDay});
      else if(view.kind==='historyMachine' && row.dataset.historyRack!=null) push(rackPage(view.items[Number(row.dataset.historyRack)],view.rackOrder));
    }});
}

/**
 * 月別・年間の勝率（2026-10-18 利用者「月ごとに月間の勝率出すのと、年間でも見れるページつくっておいてね」）。
 * 年の勝率と、1〜12月の勝率（勝ち負けの分かる日がある月だけ）。月を押すと、その月のカレンダーへ。
 */
function openYear() {
  openSheet({
    first: {kind: 'year', year: state.year},
    body: (view) => {
      const {months, total} = yearWinRates(state.model.byDay, state.model.summaries, state.store, view.year);
      const shown = months.filter(m => m.judged > 0);
      return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${view.year}年</h2>
      ${total.judged ? `<p class="total total-card total-rate" data-year-total><span class="label">年間の勝率</span>
        <span class="value num zero">${winRateText(total.won, total.judged)}</span>
        <span class="sub num">${total.days}日・${count(total.judged)}台中${count(total.won)}台プラス</span></p>` : '<p class="note">この年は勝ち負けの分かる日がありません。</p>'}
      ${shown.length ? `<h3>月別</h3>
      <p class="caption">月を押すと、その月のカレンダーが見られます。</p>
      ${tapList(shown.map(m => {
        const pct = Math.min(100, Math.max(0, Math.floor((200 * m.won + m.judged) / (2 * m.judged))));
        return {
          lead: '', attrs: `data-month-jump="${m.month}"`,
          main: `<span class="machine num" style="display:block">${m.month}月</span><span class="rack num">${m.days}日・${count(m.judged)}台中${count(m.won)}台プラス</span>`,
          right: `<span class="value num ${pct >= 50 ? 'plus' : 'zero'}" style="display:block">${winRateText(m.won, m.judged)}</span><span class="rate-bar" aria-hidden="true"><span class="rate-bar-fill${pct >= 50 ? ' good' : ''}" style="width:${pct}%"></span></span>`,
        };
      }))}` : ''}
      <p class="note">勝率＝プラスで終わった台の割合。台のデータがある日はその日の台から、無い日は保存したアナスロのHTMLから数えます（回っていない台・終わり方の分からない台は数えません）。月・年の勝率は、日ごとの台数を足して割ったものです。</p>`;
    },
    onRow: (row, push, view) => {
      if (row.dataset.monthJump == null) return;
      state.year = view.year;
      state.month = Number(row.dataset.monthJump);
      row.closest('.sheet-backdrop').querySelector('[data-close]').click();
      render();
    },
  });
}

/**
 * 機種名・台番号のクイック検索（2026-11-27）。
 * 読み込み済みの記録だけを使い、半角カナ・ひらがな・カタカナのゆらぎを吸収して機種や台番号を絞り込む。
 * 機種を押すとその機種の日別推移 → その日の台一覧 → 台詳細へ、台番号を押すとその台の日別推移 → 台詳細へ進む。
 */
function openSearch() {
  const allDays = storeDays(state.model.byDay, state.store);
  const latestYm = allDays[0]?.slice(0, 7) ?? '';
  const currentYm = `${state.year}-${String(state.month).padStart(2, '0')}`;
  const initialPeriod = latestYm && currentYm !== latestYm && allDays.some(d => d.startsWith(`${currentYm}-`)) ? 'month' : 'recent30';
  const periodLabels = {month: `${state.month}月`, recent30: '過去30日', all: '全期間'};
  const searchDaysOf = (period) => {
    if (period === 'month') return allDays.filter(d => d.startsWith(`${currentYm}-`));
    if (period === 'recent30') {
      if (!allDays.length) return [];
      const start = windowDays(allDays[0], 30)[0];
      return allDays.filter(d => d >= start);
    }
    return allDays;
  };
  const periodBar = (period) => `
    <div class="segmented search-periods" role="group" aria-label="検索する期間">
      ${Object.entries(periodLabels).map(([key, label]) =>
        `<button type="button" class="pill ${period === key ? 'pill-blue' : 'pill-outline'}" data-search-period="${key}" aria-pressed="${period === key}">${esc(label)}</button>`).join('')}
    </div>`;
  const sortBar = (sort) => `
    <div class="segmented search-sorts" role="group" aria-label="並べ替え">
      <button type="button" class="pill ${sort === 'day' ? 'pill-blue' : 'pill-outline'}" data-search-sort="day" aria-pressed="${sort === 'day'}">新しい順</button>
      <button type="button" class="pill ${sort === 'net' ? 'pill-blue' : 'pill-outline'}" data-search-sort="net" aria-pressed="${sort === 'net'}">差枚の高い順</button>
    </div>`;
  const machineRowItem = (m) => ({
    lead: '', attrs: `data-search-machine="${esc(m.machine)}"`,
    main: `<span class="machine" style="display:block">${esc(m.machine)}</span>`
      + `<span class="rack num">記録${m.daysCount}日（＋${m.plusDays}日）・${m.racks}台・平均${count(m.averageGames)}G</span>`,
    right: `<span class="value num ${m.totalNet == null ? 'zero' : tone(m.totalNet)}" style="display:block">${m.totalNet != null ? signed(m.totalNet) : '—'}</span>`
      + `<span class="small num">${m.averageNet != null ? `平均${signed(m.averageNet)}` : m.winRatePct != null ? `勝率${m.winRatePct}%` : '差枚なし'}</span>`,
  });
  const rackRowItem = (k) => ({
    lead: '', attrs: `data-search-rack="${k.rack}"`,
    main: `<span class="machine num" style="display:block">${k.rack}番台${k.rainbowDays ? ` ${RAINBOW}×${k.rainbowDays}` : ''}</span>`
      + `<span class="rack">${esc(k.latestMachine)}</span>`
      + `<span class="rack num" style="display:block">記録${k.daysCount}日（＋${k.plusDays}日）・平均${count(k.averageGames)}G</span>`,
    right: `<span class="value num ${k.totalNet == null ? 'zero' : tone(k.totalNet)}" style="display:block">${k.totalNet != null ? signed(k.totalNet) : '—'}</span>`
      + `<span class="small num">最終 ${shortDate(k.latestDay)}</span>`,
  });
  const renderSearchResults = (view) => {
    const days = searchDaysOf(view.period);
    if (!days.length) {
      return `<p class="note">${view.period === 'month'
        ? `${state.year}年${state.month}月は台データがありません。「過去30日」や「全期間」に切り替えてお試しください。`
        : 'この店舗には検索できる台データがありません。'}</p>`;
    }
    const res = searchStoreEntities(state.model.byDay, state.store, days, view.query);
    if (!res.query) {
      const topMachines = res.machines.slice(0, 50);
      const restMachines = res.machines.slice(50);
      return `
        ${res.featured.length ? `<div class="search-section">
          <h3 class="search-sub">主要機種から選ぶ</h3>
          <div class="search-chips">${res.featured.map(m =>
            `<button type="button" class="pill pill-outline row-link search-chip" data-search-machine="${esc(m.machine)}"><span class="search-chip-name">${esc(m.machine)}</span><span class="search-chip-count num">${m.racks}台</span></button>`).join('')}</div>
        </div>` : ''}
        <div class="search-section">
          <h3 class="search-sub">期間内の機種一覧（${res.machines.length}機種・${days.length}日分）</h3>
          <p class="caption">記録の多い順。機種を押すと日別の推移が見られます。</p>
          ${tapList(topMachines.map(machineRowItem))}
          ${restMachines.length ? `<details class="more"><summary>残り${restMachines.length}機種を見る</summary>${tapList(restMachines.map(machineRowItem))}</details>` : ''}
        </div>`;
    }
    const rackSection = res.racks.length ? `<div class="search-section">
      <h3 class="search-sub">台番号の一致（${res.totalRacks}台${res.totalRacks > res.racks.length ? `中 上位${res.racks.length}台` : ''}）</h3>
      ${tapList(res.racks.map(rackRowItem))}
    </div>` : '';
    const machineSection = res.machines.length ? `<div class="search-section">
      <h3 class="search-sub">機種の一致（${res.machines.length}機種）</h3>
      ${tapList(res.machines.slice(0, 50).map(machineRowItem))}
      ${res.machines.length > 50 ? `<p class="note">上位50機種を表示しています。さらに文字を足すと絞り込めます。</p>` : ''}
    </div>` : '';
    if (!rackSection && !machineSection) {
      return `<p class="note">「${esc(view.query)}」に一致する機種・台番号が見つかりません。ひらがな・カタカナや台番号の数字、または「全期間」でお試しください。</p>`;
    }
    return res.numericOnly ? rackSection + machineSection : machineSection + rackSection;
  };
  const searchView = (view) => `
    <p class="store">${esc(storeLabel(state.store))}</p>
    <h2 id="sheet-title" class="sr-only">機種・台番を検索</h2>
    ${periodBar(view.period)}
    <div class="search-box">
      <input type="search" class="search-input" data-search-input value="${esc(view.query)}" placeholder="機種名（ひらがなOK）または台番号" aria-label="機種名または台番号で検索" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button type="button" class="pill pill-outline search-clear" data-search-clear aria-label="検索文字を消す"${view.query ? '' : ' hidden'}>×</button>
    </div>
    <p class="caption">半角・全角・ひらがな・カタカナを区別せず検索します。数字を入れると台番号も探せます。</p>
    <div data-search-results>${renderSearchResults(view)}</div>`;

  const searchMachineView = (view) => {
    const days = searchDaysOf(view.period);
    const {entries, summary} = machineDayHistory(state.model.byDay, state.model.events, state.store, view.machine, days);
    const ordered = view.sort === 'net'
      ? [...entries].sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity) || b.day.localeCompare(a.day))
      : entries;
    const totalTone = summary.totalNet != null ? tone(summary.totalNet) : 'zero';
    const netLabel = summary.estimated ? '期間合計差枚（推定含む）' : '期間合計差枚';
    return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title" class="long">${esc(view.machine)}</h2>
      ${periodBar(view.period)}
      ${entries.length ? `<p class="total total-card total-${totalTone}">
        <span class="label">${netLabel}</span>
        <span class="value num ${totalTone}">${summary.totalNet != null ? signed(summary.totalNet) : '—'}</span>
        <span class="sub num">記録${summary.days}日（プラス${summary.plusDays}日）・延べ${count(summary.totalRecords)}台${summary.averageNet != null ? `・1台平均${signed(summary.averageNet)}枚` : ''}${summary.winRatePct != null ? `・勝率${summary.winRatePct}%` : ''}・平均${count(summary.averageGames)}G</span>
      </p>
      ${entries.length > 1 ? sortBar(view.sort) : ''}
      <h3>日別の推移</h3>
      <p class="caption">日付を押すと、その日の台一覧が見られます。</p>
      ${tapList(ordered.map(e => ({
        lead: '', attrs: `data-search-machine-day="${e.day}" data-search-machine-raw="${esc(e.rawMachine)}"`,
        main: `<span class="machine num" style="display:block">${esc(shortDateWeek(e.day))}${e.rainbowCount ? ` ${RAINBOW}×${e.rainbowCount}` : ''}${e.event ? ` <span class="search-event-tag">${esc(e.event)}</span>` : ''}</span>`
          + `<span class="rack num">${e.racks}台・平均${count(e.averageGames)}G${e.judged ? `・プラス${e.won}/${e.judged}台` : ''}</span>`,
        right: `<span class="value num ${e.total == null ? 'zero' : tone(e.total)}" style="display:block">${e.total != null ? signed(e.total) : '—'}</span>`
          + `<span class="small num">${e.averageNet != null ? `平均${signed(e.averageNet)}` : '差枚なし'}</span>`,
      })))}` : '<p class="note">この期間に記録がありません。上のボタンで期間を切り替えてお試しください。</p>'}`;
  };

  const searchRackView = (view) => {
    const days = searchDaysOf(view.period);
    const {entries, summary} = rackDayHistory(state.model.byDay, state.model.events, state.store, view.rack, days);
    const ordered = view.sort === 'net'
      ? [...entries].sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity) || b.day.localeCompare(a.day))
      : entries;
    view.entries = ordered;
    const totalTone = summary.totalNet != null ? tone(summary.totalNet) : 'zero';
    const netLabel = summary.estimated ? '期間合計差枚（推定含む）' : '期間合計差枚';
    return `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${view.rack}番台</h2>
      ${summary.latestMachine ? `<p class="event-line">${esc(summary.latestMachine)}</p>` : ''}
      ${periodBar(view.period)}
      ${entries.length ? `<p class="total total-card total-${totalTone}">
        <span class="label">${netLabel}</span>
        <span class="value num ${totalTone}">${summary.totalNet != null ? signed(summary.totalNet) : '—'}</span>
        <span class="sub num">記録${summary.days}日${summary.judged ? `（プラス${summary.plusDays}/${summary.judged}日）` : ''}・平均${count(summary.averageGames)}G${summary.rainbowDays ? `・${RAINBOW}${summary.rainbowDays}日` : ''}</span>
      </p>
      ${entries.length > 1 ? sortBar(view.sort) : ''}
      <h3>日別の推移</h3>
      <p class="caption">日付を押すと、その日の台詳細が見られます。</p>
      ${tapList(ordered.map((e, i) => ({
        lead: '', attrs: `data-search-rack-entry="${i}"`,
        main: `<span class="machine num" style="display:block">${esc(shortDateWeek(e.day))}${e.rainbow ? ` ${RAINBOW}` : ''}${e.event ? ` <span class="search-event-tag">${esc(e.event)}</span>` : ''}</span>`
          + `<span class="rack">${esc(displayMachineName(e.machine))} ・ BB ${e.bb}・RB ${e.rb}</span>`,
        right: `${netCell(e)}<span class="small num">${count(e.games)}G</span>`,
      })))}` : '<p class="note">この期間に記録がありません。上のボタンで期間を切り替えてお試しください。</p>'}`;
  };

  const machineDayView = (view) => {
    const racks = state.model.byDay.get(`${state.store}|${view.day}`) ?? [];
    const target = displayMachineName(view.machine);
    const list = racks.filter(r => displayMachineName(r.machine) === target).sort((a, b) => a.rack - b.rack);
    view.rackList = list;
    const netName = list.some(r => r.net != null && r.estimated) ? '推定差枚' : '差枚';
    const nets = list.filter(r => r.net != null);
    const total = nets.length ? nets.reduce((s, r) => s + r.net, 0) : null;
    const average = list.length ? Math.round(list.reduce((s, r) => s + r.games, 0) / list.length) : 0;
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateLabel(view.day)}</p>
      <h2 id="sheet-title" class="long">${esc(target)}</h2>
      <p class="event-line num">${list.length}台・平均${count(average)}G</p>
      ${total != null ? `<p class="total total-card total-${tone(total)}"><span class="label">この機種の総${netName}</span>
        <span class="value num ${tone(total)}">${signed(total)}</span>
        <span class="sub num">${netName}がわかった台 ${nets.length}/${list.length}台</span></p>` : ''}
      <h3>台一覧</h3>
      <p class="caption">台番号の順。台を押すと、その台のデータが見られます。</p>
      ${list.length ? tapList(list.map((r, i) => ({
        lead: '', attrs: `data-search-day-rack="${i}"`,
        main: `<span class="machine num" style="display:block">${r.rack}番${rackMark(r)}</span><span class="rack num">BB ${r.bb}・RB ${r.rb}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      }))) : '<p class="note">この日の記録はありません。</p>'}`;
  };

  openSheet({
    first: {kind: 'search', query: '', period: initialPeriod},
    body: (view) => (view.kind === 'search' ? searchView(view)
      : view.kind === 'searchMachine' ? searchMachineView(view)
      : view.kind === 'searchRack' ? searchRackView(view)
      : view.kind === 'searchMachineDay' ? machineDayView(view) : rackView(view)),
    onInput: (target, view, sheet) => {
      if (view.kind !== 'search' || !target.matches('[data-search-input]')) return;
      view.query = target.value;
      const clear = sheet.querySelector('[data-search-clear]');
      if (clear) clear.hidden = !view.query;
      const results = sheet.querySelector('[data-search-results]');
      if (results) results.innerHTML = renderSearchResults(view);
    },
    onAction: (action, view) => {
      if (action.dataset.searchPeriod) view.period = action.dataset.searchPeriod;
      if (action.dataset.searchSort) view.sort = action.dataset.searchSort;
      if (action.dataset.searchClear != null) view.query = '';
    },
    onRow: (row, push, view) => {
      if (row.dataset.searchMachine != null) {
        push({kind: 'searchMachine', machine: row.dataset.searchMachine, period: view.period, sort: 'day'});
      } else if (row.dataset.searchRack != null) {
        push({kind: 'searchRack', rack: Number(row.dataset.searchRack), period: view.period, sort: 'day'});
      } else if (row.dataset.searchMachineDay && row.dataset.searchMachineRaw) {
        push({kind: 'searchMachineDay', machine: row.dataset.searchMachineRaw, day: row.dataset.searchMachineDay, picked: null});
      } else if (row.dataset.searchRackEntry != null) {
        const entry = view.entries?.[Number(row.dataset.searchRackEntry)];
        if (entry?.record) push(rackPage(entry.record, []));
      } else if (row.dataset.searchDayRack != null) {
        const r = view.rackList?.[Number(row.dataset.searchDayRack)];
        if (r) push(rackPage(r, view.rackList));
      }
    },
  });
}

app.addEventListener('click', (e) => {
  const target = e.target.closest('[data-open], [data-summary-open], [data-birthday-open], [data-event-open], [data-store], [data-compare-store], [data-month], [data-search-open], [data-idle-open], [data-variety-open], [data-suffix-open], [data-year-open], [data-event-history-open]');
  if (!target || !state.model) return;
  if (target.dataset.open) { openDay(target.dataset.open); return; }
  if (target.dataset.summaryOpen) { openSummary(target.dataset.summaryOpen); return; }
  if (target.dataset.birthdayOpen) { openBirthdays(target.dataset.birthdayOpen); return; }
  if (target.dataset.eventOpen) { openSheet({first: eventCompareView(target.dataset.eventOpen)}); return; }
  if (target.dataset.searchOpen != null) { openSearch(); return; }
  if (target.dataset.idleOpen != null) { openIdle(); return; }
  if (target.dataset.varietyOpen != null) { openVariety(); return; }
  if (target.dataset.suffixOpen != null) { openSuffix(); return; }
  if (target.dataset.yearOpen != null) { openYear(); return; }
  if (target.dataset.eventHistoryOpen != null) { openEventHistory(); return; }
  if (target.dataset.compareStore) {
    const mode = target.dataset.compareMode;
    if (mode === 'switch') {
      state.store = target.dataset.compareStore;
      store.set(STORE_KEY, state.store);
      render();
    } else if (mode === 'day' && target.dataset.compareDay) {
      openDay(target.dataset.compareDay);
    } else if (mode === 'summary' && target.dataset.compareDay) {
      openSummary(target.dataset.compareDay);
    }
    return;
  }
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
loadBirthdays();
start();
