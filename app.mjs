// 閲覧専用の共有ページ（お試し、2026-10-09。EVENT_CALENDAR.md「閲覧専用の共有ページ」）。
// 読むだけのApps Script（database_android/tool/viewer_drive_script_readonly.gs）からDriveのファイルを読み、
// イベントカレンダー（各日のイベント・総差枚）と、日付を押したときの差枚TOP50（11位からは折りたたみ）・強かった機種10選を出す。
// 何も書き込まない。端末に覚えるのは接続先（スクリプトのID）と選んだ店だけで、利用者自身の閲覧ページ
// （database-viewer の保存名）とは別の名前を使う。スクリプトのIDはページに書かず、渡すリンクの # の後ろに付ける。
import {
  MERUHEN_STORES, compactSigned, dayNet, daySummary, displayMachineName, eventLabel, indexRecords,
  meruhenRecords, mergeEvents, monthWeeks, pscubeRecords, scriptIdFrom, signed, storeLabel, TOP_RACKS_OPEN, viewerNameFrom,
} from './data.mjs?v=789e85d23233';

const ID_KEY = 'database-share-script-id';
const STORE_KEY = 'database-share-store';
// 渡したリンクの呼び名（# の u=）。最初の読み込みにだけ付けて送り、スクリプトが「実行数」に記録する。
const NAME_KEY = 'database-share-name';
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const RETRY_MS = [1500, 4000];
const TIMEOUT_MS = 30000;

const app = document.getElementById('app');
const reload = document.getElementById('reload');
const state = {id: null, name: null, model: null, store: null, year: 0, month: 0, loading: false};

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
  state.loading = true;
  reload.disabled = true;
  if (!state.model) {
    app.innerHTML = '<p class="status">Googleドライブから読み込んでいます…<br>最初の読み込みは、1分ほどかかることがあります。</p>';
  }
  const base = `https://script.google.com/macros/s/${state.id}/exec`;
  const [meruhen, pscube, events, pscubeEvents] = await Promise.allSettled(
    [state.name ? `?u=${state.name}` : '', '?file=pscube', '?file=events', '?file=pscube-events'].map(q => getJson(base + q)));
  state.loading = false;
  reload.disabled = false;
  const doc = (r) => (r.status === 'fulfilled' && r.value && !r.value.error ? r.value : null);
  const m = doc(meruhen), p = doc(pscube);
  if (!m && !p) {
    const reason = [meruhen, pscube].map(r => (r.status === 'rejected' ? r.reason?.message : r.value?.error)).find(Boolean);
    showSetup(`読み込めませんでした。リンクが正しいか、少し待ってからもう一度お試しください。${reason ? `（${reason}）` : ''}`);
    return;
  }
  const records = [...meruhenRecords(m), ...pscubeRecords(p)];
  const byDay = indexRecords(records);
  const stores = [...Object.keys(MERUHEN_STORES), ...new Set(records.map(r => r.store).filter(s => s.startsWith('pscube:')))]
    .filter(s => records.some(r => r.store === s));
  state.model = {
    byDay, stores,
    events: mergeEvents(m?.date_events, doc(events)?.events, p?.date_events, doc(pscubeEvents)?.events),
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
    const net = dayNet(racks);
    const event = eventLabel(model.events.get(`${state.store}|${day}`));
    const date = Number(day.slice(8));
    const label = [`${state.month}月${date}日`, event, net.total != null ? `総差枚 ${signed(net.total)}` : ''].filter(Boolean).join('、');
    const inner = `<span class="date num">${date}</span>`
      + (event ? `<span class="event">${esc(event)}</span>` : '')
      + (net.total != null ? `<span class="net num ${tone(net.total)}">${compactSigned(net.total)}</span>` : '');
    const cls = `day${day === today.day ? ' today' : ''}`;
    return racks.length
      ? `<button type="button" class="${cls}" data-open="${day}" aria-label="${esc(label)}">${inner}</button>`
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
      <p class="legend">${esc(exportedText(model.exportedAt))}${model.exportedAt ? '。' : ''}差枚＝その日の総差枚（メルヘンは推定）。＊＝前日までに入力した記録がないイベント。</p>
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

/**
 * 日付を押したときのシート。その日の差枚TOP50（11位からは折りたたみ）・強かった機種10選 →
 * 台や機種を押すと、その日のその機種の台一覧 → 台を押すと、その台のその日のデータ（利用者指定 2026-10-10）。
 * シートの中で画面を重ね、「戻る」で前の画面（開いていた折りたたみ・スクロール位置）へ戻る。
 */
function openDay(day) {
  const racks = state.model.byDay.get(`${state.store}|${day}`) ?? [];
  if (!racks.length) return;
  const net = dayNet(racks);
  const {top, machines} = daySummary(racks);
  const estimated = racks.some(r => r.estimated);
  const netName = estimated ? '推定差枚' : '差枚';
  const outputName = state.store.startsWith('pscube:') ? 'MY' : '最大持玉';
  const event = eventLabel(state.model.events.get(`${state.store}|${day}`));
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dateText = `${m}月${d}日（${weekday}）`;
  const index = new Map(racks.map((r, i) => [r, i]));
  const views = [{kind: 'day'}];

  const rankRows = (list, from) => list.map((r, i) => ({
    lead: from + i + 1, attrs: `data-machine-of="${index.get(r)}"`,
    main: `<span class="rack num">${r.rack}番</span><span class="machine" style="display:block">${esc(displayMachineName(r.machine))}</span>`,
    right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
  }));

  const dayView = () => `
      <p class="store">${esc(storeLabel(state.store))}</p>
      <h2 id="sheet-title">${dateText}</h2>
      <p class="event-line">${event ? `イベント：${esc(event)}` : 'イベントなし'}</p>
      ${net.total != null ? `<p class="total"><span class="label">総${netName}</span>
        <span class="value num ${tone(net.total)}">${signed(net.total)}</span>
        <span class="sub num">${netName}がわかった台 ${net.captured}/${net.racks}台</span></p>` : ''}
      <h3>TOP50</h3>
      <p class="caption">${netName}の多い順。台を押すと、その機種の台一覧が見られます。</p>
      ${top.length ? tapList(rankRows(top.slice(0, TOP_RACKS_OPEN), 0))
        : '<p class="note">この日は差枚がわかる台がありません。</p>'}
      ${top.length > TOP_RACKS_OPEN ? `<details class="more"><summary>${TOP_RACKS_OPEN + 1}〜${top.length}位を見る（${top.length - TOP_RACKS_OPEN}台）</summary>
        ${tapList(rankRows(top.slice(TOP_RACKS_OPEN), TOP_RACKS_OPEN), TOP_RACKS_OPEN + 1)}</details>` : ''}
      <h3>強かった機種10選</h3>
      <p class="caption">1台あたりの平均回転数（2台以上ある機種）</p>
      ${machines.length ? tapList(machines.map((x, i) => ({
        lead: i + 1, attrs: `data-machine="${esc(x.machine)}"`,
        main: `<span class="machine" style="display:block">${esc(displayMachineName(x.machine))}</span>`,
        right: `<span class="value num" style="display:block">${count(x.average)}G</span><span class="small num">${x.racks}台</span>`,
      }))) : '<p class="note">2台以上ある機種がありません。</p>'}
      ${estimated ? '<p class="note">推定差枚はグラフと最大持玉からの計算で、確定値ではありません（※は要確認）。</p>' : ''}`;

  const machineView = ({machine, picked}) => {
    const list = racks.filter(r => r.machine === machine).sort((a, b) => a.rack - b.rack);
    const nets = list.filter(r => r.net != null);
    const total = nets.length ? nets.reduce((s, r) => s + r.net, 0) : null;
    const average = Math.round(list.reduce((s, r) => s + r.games, 0) / list.length);
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateText}</p>
      <h2 id="sheet-title" class="long">${esc(displayMachineName(machine))}</h2>
      <p class="event-line num">${list.length}台・平均${count(average)}G</p>
      ${total != null ? `<p class="total"><span class="label">この機種の総${netName}</span>
        <span class="value num ${tone(total)}">${signed(total)}</span>
        <span class="sub num">${netName}がわかった台 ${nets.length}/${list.length}台</span></p>` : ''}
      <h3>台一覧</h3>
      <p class="caption">台番号の順。台を押すと、その台のデータが見られます。</p>
      ${tapList(list.map(r => ({
        lead: '', attrs: `data-rack="${index.get(r)}"`, current: r === picked,
        main: `<span class="machine num" style="display:block">${r.rack}番</span><span class="rack num">BB ${r.bb}・RB ${r.rb}</span>`,
        right: `${netCell(r)}<span class="small num">${count(r.games)}G</span>`,
      })))}`;
  };

  const rackView = ({rack: r}) => {
    const stats = [
      ['回転数', `${count(r.games)}G`], ['BB', count(r.bb)], ['RB', count(r.rb)],
      ['BB確率', odds(r.games, r.bb)], ['RB確率', odds(r.games, r.rb)], ['合成確率', odds(r.games, r.bb + r.rb)],
    ];
    if (r.output != null) stats.push([outputName, count(r.output)]);
    const name = r.estimated ? '推定差枚' : '差枚';
    return `
      <p class="store">${esc(storeLabel(state.store))}　${dateText}</p>
      <h2 id="sheet-title">${r.rack}番台</h2>
      <p class="event-line">${esc(displayMachineName(r.machine))}</p>
      <p class="total"><span class="label">${name}</span>
        <span class="value num ${r.net != null ? tone(r.net) : 'zero'}">${r.net != null ? `${signed(r.net)}${r.needsCheck ? '※' : ''}` : '—'}</span>
        ${r.net == null ? `<span class="sub">${name}はわかりません。</span>` : ''}</p>
      <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>
      ${r.estimated && r.net != null ? `<p class="note">推定差枚はグラフと最大持玉からの計算で、確定値ではありません${r.needsCheck ? '（※は要確認）' : ''}。</p>` : ''}`;
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></div>';
  const sheet = backdrop.firstElementChild;
  const render = () => {
    const view = views[views.length - 1];
    const body = view.kind === 'day' ? dayView() : view.kind === 'machine' ? machineView(view) : rackView(view);
    sheet.innerHTML = `
      <div class="sheet-head">${views.length > 1 ? '<button type="button" class="pill pill-outline" data-back>‹ 戻る</button>' : ''}
        <span class="spacer"></span><button type="button" class="pill pill-outline" data-close>閉じる</button></div>${body}`;
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
    const row = e.target.closest('[data-machine-of], [data-machine], [data-rack]');
    if (!row) return;
    if (row.dataset.rack != null) push({kind: 'rack', rack: racks[Number(row.dataset.rack)]});
    else if (row.dataset.machineOf != null) {
      const picked = racks[Number(row.dataset.machineOf)];
      push({kind: 'machine', machine: picked.machine, picked});
    } else push({kind: 'machine', machine: row.dataset.machine});
  });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);
  render();
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

function connect(id) {
  state.id = id;
  store.set(ID_KEY, id);
  reload.hidden = false;
  load();
}

app.addEventListener('click', (e) => {
  const target = e.target.closest('[data-open], [data-store], [data-month]');
  if (!target || !state.model) return;
  if (target.dataset.open) { openDay(target.dataset.open); return; }
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

start();
