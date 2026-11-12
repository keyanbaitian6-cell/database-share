// 日次学習・採用中の候補（共有カレンダー）。PCが固定保存した候補をそのまま並べる。画面側で再学習・再計算しない。
// 2026-11-12：PC・Android・iPhone閲覧ページと同じ順にそろえた（切り替え → 重要な注意 → 候補数 → 機種ごとの候補 → 開閉式の説明）。
import {displayMachineName} from './data.mjs?v=386ade7eb470';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const DAILY_STORE_NAMES={nagamachiminami:'長町南',saiwaichou:'幸町','pscube:c740601:20':'P-STATION'};
const WEEK='日月火水木金土';
const jstDay=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
// 最初に開く対象日（日本時間）。23:30以降は、その夜に保存される翌日の分（2026-11-12）。
export function defaultDailyTarget(now=Date.now()) {
  const local=new Date(now+9*3600000), minutes=local.getUTCHours()*60+local.getUTCMinutes();
  return new Date(local.getTime()+(minutes>=1410?86400000:0)).toISOString().slice(0,10);
}
export function dailyDateLabel(day) {
  const d=new Date(day+'T00:00:00Z');
  return `${d.getUTCMonth()+1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
}
// 保存時刻などを日本時間の「11月12日 0:30」で出す。
export function dailyTime(stamp) {
  const ms=Date.parse(stamp);
  if(!Number.isFinite(ms)) return String(stamp??'');
  const d=new Date(ms+9*3600000);
  return `${d.getUTCMonth()+1}月${d.getUTCDate()}日 ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
// 状態の文（「長町南：…／幸町：…／同期先…」）を、この店舗の分と全体の分に分ける。
export function dailyStatusParts(status, store) {
  const prefixes=Object.entries(DAILY_STORE_NAMES).flatMap(([id,name])=>[id+'：',name+'：']);
  const own=[DAILY_STORE_NAMES[store]+'：',store+'：'], mine=[], general=[];
  for(const part of String(status??'').split('／').map(s=>s.trim()).filter(Boolean)) {
    const hit=own.find(p=>part.startsWith(p));
    if(hit) mine.push(part.slice(hit.length));
    else if(!prefixes.some(p=>part.startsWith(p))) general.push(part);
  }
  return {mine,general};
}
const IMPORTANT=/処理失敗|取り込み待ち|締切超過|同期先|書けません|読めません/;
function checkGroup(g, day, target) {
  const at=Date.parse(g.saved_at??day.saved_at), saved=new Date(at+9*3600000), minutes=saved.getUTCHours()*60+saved.getUTCMinutes();
  const savedDay=saved.toISOString().slice(0,10), before=new Date(Date.parse(target+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const inWindow=(savedDay===target&&minutes<480)||(savedDay===before&&minutes>=1410);
  if(!Number.isFinite(at)||!inWindow||!['current','learned'].includes(g.active)||!Array.isArray(g.selected)||
     g.selected.some(id=>!Array.isArray(id)||id.length!==4)) throw Error('事前予測の確認に失敗しました');
}
// 表示する中身（4画面で同じ意味・順序）。保存済みの selected の台と順番をそのまま使う。
export function dailyView(doc, store, target, now=Date.now()) {
  if(doc?.format!=='daily-learning'||doc.version!==1||!Array.isArray(doc.days)) throw Error('日次学習の形式が不正です');
  const day=doc.days.find(d=>d.target===target);
  const found=(day?.groups??[]).filter(g=>g.store===store);
  found.forEach(g=>checkGroup(g,day,target));
  const groups=found.map(g=>({name:g.name,learned:g.active==='learned',status:g.status,saved:g.saved_at??day.saved_at,
    racks:g.selected.map(id=>({rack:id[3],machine:id[2]!==g.name?id[2]:null}))}));
  const {mine,general}=dailyStatusParts(doc.status,store);
  const alerts=[...mine,...general].filter(s=>IMPORTANT.test(s));
  if(!String(doc.updated_at).startsWith(jstDay(now))) alerts.push('本日の処理結果は届いていません。古い候補を本日の予測として使わないでください。');
  if(target<defaultDailyTarget(now)) alerts.push(`${dailyDateLabel(target)}は過去の対象日です。記録として表示しています。次の営業日の候補として使わないでください。`);
  if(!groups.length) alerts.push('この日の保存済み候補はありません。データ不足・締切超過・PC停止などを確認してください。');
  const count=groups.reduce((n,g)=>n+g.racks.length,0);
  const machines=groups.filter(g=>g.name!=='バラエティ').length, variety=groups.some(g=>g.name==='バラエティ');
  const scope=machines&&variety?`${machines}機種とバラエティ`:variety?'バラエティ':`${machines}機種`;
  const dates=[...new Set([defaultDailyTarget(now),target,...doc.days.map(d=>d.target)])].sort().reverse();
  return {groups,count,scope,alerts,mine,general,updated:doc.updated_at,dates,
    past:target<defaultDailyTarget(now)};
}
const METHOD_TEXT={
  learned:'日次学習版：店舗ごとの判定で、将来の成績による改善を確認したため採用している方式です。',
  current:'従来方式：これまでの翌日候補と同じ選び方です。日次学習版は、将来の成績で改善を確認するまで採用しません。'};
export function dailyPanel(doc, store, target, now=Date.now(), stores=Object.keys(DAILY_STORE_NAMES)) {
  const v=dailyView(doc,store,target,now);
  const storeOptions=(stores.includes(store)?stores:[store,...stores]).filter(s=>DAILY_STORE_NAMES[s])
    .map(s=>`<option value="${esc(s)}"${s===store?' selected':''}>${esc(DAILY_STORE_NAMES[s])}</option>`).join('');
  const dayOptions=v.dates.map(d=>`<option value="${esc(d)}"${d===target?' selected':''}>${esc(dailyDateLabel(d))}${d<defaultDailyTarget(now)?'・過去日':''}</option>`).join('');
  const cards=v.groups.map(g=>`<section class="daily-group">
      <h3 class="daily-machine">${esc(displayMachineName(g.name))}</h3>
      <div class="daily-group-head"><span class="daily-badge${g.learned?' daily-badge-learned':''}">採用中 ${g.learned?'日次学習版':'従来方式'}</span><span class="daily-count num">${g.racks.length}台</span></div>
      <ul class="daily-racks" aria-label="保存済み候補の台番号">${g.racks.map(r=>`<li><span class="daily-rack num">${esc(r.rack)}<span class="daily-unit">番</span></span>${r.machine?`<span class="daily-rack-machine">${esc(displayMachineName(r.machine))}</span>`:''}</li>`).join('')}</ul>
      <details class="more daily-more"><summary>採用方式の説明・保存時刻</summary>
        <p>${esc(g.status)}</p><p>${esc(METHOD_TEXT[g.learned?'learned':'current'])}</p><p>保存 ${esc(dailyTime(g.saved))}（日本時間）</p></details>
    </section>`).join('');
  return `<div class="daily-filters">
      <label><span class="caption">店舗</span><select data-learning-store>${storeOptions}</select></label>
      <label><span class="caption">対象日</span><select data-learning-day>${dayOptions}</select></label>
    </div>
    ${v.alerts.length?`<div class="data-warning daily-alerts" role="status">${v.alerts.map(a=>`<p>${esc(a)}</p>`).join('')}</div>`:''}
    <div class="daily-summary"><strong class="num">${v.count?`${v.count}台`:'候補なし'}</strong><span>${esc(DAILY_STORE_NAMES[store]??store)}・${esc(dailyDateLabel(target))}${v.count?`・${esc(v.scope)}の保存済み候補`:''}</span></div>
    <p class="daily-sub">最終処理 ${esc(dailyTime(v.updated))}（日本時間）</p>
    ${cards}
    <details class="more daily-more"><summary>処理状況・日次学習について</summary>
      ${[...v.mine.map(s=>`${DAILY_STORE_NAMES[store]??store}：${s}`),...v.general].map(s=>`<p>${esc(s)}</p>`).join('')||'<p>処理状況の記録はありません。</p>'}
      <p>PCで前日23:30〜当日8:00の間に保存した候補を表示します。画面を開いても予測を作り直しません。</p>
      <p>採用は店舗ごとに、保存した予測の将来の成績で判定します。判定までは従来方式を採用します。</p></details>
    <p class="daily-footer">毎日学習しても、毎日の改善を保証しません。設定確率・勝率・期待収支を示すものではありません。</p>`;
}

export async function openDailyLearning({load,store,target,stores}) {
  const dialog=document.createElement('dialog');
  dialog.className='daily-sheet';
  dialog.setAttribute('aria-labelledby','daily-title');
  dialog.innerHTML='<div class="sheet-head"><div class="head-row"><span class="head-title" id="daily-title">日次学習・採用中の候補</span><button type="button" class="pill pill-outline" data-daily-close autofocus>閉じる</button></div></div>';
  const content=document.createElement('div'); content.className='daily-content'; content.textContent='日次学習を読み込んでいます';
  content.tabIndex=0; content.setAttribute('role','region'); content.setAttribute('aria-label','日次学習の候補一覧');
  dialog.querySelector('[data-daily-close]').onclick=()=>dialog.close();
  dialog.append(content); document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  try {
    const doc=await load();
    let current={store,target};
    const render=()=>{
      content.innerHTML=dailyPanel(doc,current.store,current.target,Date.now(),stores??[store]);
      content.querySelector('[data-learning-day]').onchange=e=>{current.target=e.target.value;render();};
      content.querySelector('[data-learning-store]').onchange=e=>{current.store=e.target.value;render();};
    };
    render();
  } catch (_) {content.innerHTML='<div class="data-warning daily-alerts" role="status"><p>日次学習を読み込めません。PCの出力・同期・閲覧用スクリプトを確認してください。従来候補は引き続き参考にできます。</p></div>';}
}
