const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dailyPanel(doc, store, target) {
  if(doc?.format!=='daily-learning'||doc.version!==1||!Array.isArray(doc.days)) throw Error('日次学習の形式が不正です');
  const day=doc.days.find(d=>d.target===target);
  const groups=(day?.groups??[]).filter(g=>g.store===store);
  const dates=[...new Set([target,...doc.days.map(d=>d.target)])].sort().reverse();
  return `<h2>日次学習・採用中の候補</h2><p>最終処理 ${esc(doc.updated_at)}</p><p>${esc(doc.status)}</p>
    <p>PCで前日23:30〜当日8:00の間に固定した予測です。古い対象日の候補を本日の予測として使わないでください。</p>
    <label>対象日 <select data-learning-day>${dates.map(d=>`<option${d===target?' selected':''}>${esc(d)}</option>`).join('')}</select></label>
    ${groups.length?groups.map(g=>{
      const at=Date.parse(g.saved_at??day.saved_at), saved=new Date(at+9*3600000), minutes=saved.getUTCHours()*60+saved.getUTCMinutes();
      const savedDay=saved.toISOString().slice(0,10), before=new Date(Date.parse(target+'T00:00:00Z')-86400000).toISOString().slice(0,10);
      const inWindow=(savedDay===target&&minutes<480)||(savedDay===before&&minutes>=1410);
      if(!Number.isFinite(at)||!inWindow||
        !['current','learned'].includes(g.active)||!Array.isArray(g.selected)) throw Error('事前予測の確認に失敗しました');
      return `<section><h3>${esc(g.name)}</h3><p>採用中 ${g.active==='learned'?'日次学習版':'従来方式'}<br>${esc(g.status)}<br>保存 ${esc(g.saved_at??day.saved_at)}</p>
      <ul>${g.selected.map(id=>`<li>${esc(id[3])}番 ${esc(id[2])}</li>`).join('')}</ul></section>`;
    }).join(''):'<p>この日の保存済み候補はありません。データ不足・締切超過・PC停止などを確認してください。</p>'}
    <p>毎日学習しても毎日の改善を保証しません。採用判断は未使用の将来予測で行います。設定確率・勝率ではありません。</p>`;
}

export async function openDailyLearning({load,store,target}) {
  const dialog=document.createElement('dialog');
  dialog.style.cssText='max-width:700px;width:calc(100% - 32px);max-height:90vh;overflow:auto;padding:16px;border:1px solid #ccc;border-radius:12px';
  const close=document.createElement('button');
  close.type='button'; close.textContent='閉じる'; close.style.minHeight='44px';
  const content=document.createElement('div'); content.textContent='日次学習を読み込んでいます';
  close.onclick=()=>dialog.close();
  dialog.append(close,content); document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  try {
    const doc=await load();
    const render=day=>{
      content.innerHTML=dailyPanel(doc,store,day);
      content.querySelector('[data-learning-day]').onchange=e=>render(e.target.value);
    };
    render(target);
  } catch (_) {content.textContent='日次学習を読み込めません。PCの出力・同期・閲覧用スクリプトを確認してください。従来候補は引き続き参考にできます。';}
}
