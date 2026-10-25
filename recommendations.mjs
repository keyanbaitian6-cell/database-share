// 長町南の4大オススメ。既存の週表・結果記号と独立した4枠を週ごとに保存する。
export const RECOMMENDATION_TYPE = '4大オススメ';
export const RECOMMENDATION_DEFAULT = {
  store:'nagamachiminami', week:'2026-10-26',
  machines:['L 甲鉄城のｶﾊﾞﾈﾘ 海門決戦 XX','L戦国乙女5L8','L戦国乙女4S3','Lﾓﾝｷｰﾀｰﾝ5CE'],
  updated_at:'2026-10-24T00:00:00Z',device:'pc',
};
export function recommendationWeek(raw) {
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw Error('週開始日は月曜日を指定してください。');
  const d=new Date(raw+'T00:00:00Z');
  if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==raw||d.getUTCDay()!==1||raw.startsWith('0000')) throw Error('週開始日は月曜日を指定してください。');
  return raw;
}
export const recommendationDays = week => Array.from({length:7},(_,i)=>new Date(Date.parse(recommendationWeek(week)+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const validName=n=>typeof n==='string'&&n.trim().length>0&&[...n].length<=300&&!/[\x00-\x1f]/.test(n);
const normal=n=>n.replaceAll('+',' ').replace(/\s+/g,'').toLowerCase();
export function recommendationPlan(raw) {
  if(!raw||raw.store!=='nagamachiminami'||!Array.isArray(raw.machines)||raw.machines.length!==4||raw.machines.some(n=>!validName(n))||new Set(raw.machines.map(normal)).size!==4) throw Error('異なる4機種を選んでください。');
  recommendationWeek(raw.week);
  if(typeof raw.updated_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.updated_at)||!Number.isFinite(Date.parse(raw.updated_at))) throw Error('4機種の編集時刻が不正です。');
  const at=raw.updated_at.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
  const date=new Date(at[1]+'T00:00:00Z');
  if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==at[1]||at[1].startsWith('0000')||+at[2]>23||+at[3]>59||+at[4]>59||(at[5]!=='Z'&&(+at[5].slice(1,3)>23||+at[5].slice(4,6)>59)))throw Error('4機種の編集時刻が不正です。');
  return {store:raw.store,week:raw.week,machines:[...raw.machines],updated_at:raw.updated_at,device:['pc','android','shared'].includes(raw.device)?raw.device:'pc'};
}
// 小数秒6桁の編集順を落とさず比較する（Apps Scriptの生成時にも使用）。
const time=p=>{
  const m=p.updated_at.match(/\.(\d{1,6})(?=Z|[+-])/);
  return BigInt(Math.floor(Date.parse(p.updated_at)/1000))*1000000n+BigInt((m?.[1]??'').padEnd(6,'0'));
};
export function mergeRecommendations(stored=[],incoming=[],{strict=true}={}) {
  if(!Array.isArray(stored)||!Array.isArray(incoming)||stored.length>3000||incoming.length>3000) throw Error('4機種の週一覧が不正です。');
  const plans=new Map(),orphans=[];
  for(const [items,check] of [[stored,false],[incoming,strict]]) for(const raw of items) {
    try {const p=recommendationPlan(raw),old=plans.get(p.week);if(!old||time(p)>=time(old)) plans.set(p.week,p);}
    catch(e){if(check) throw e;orphans.push(raw);}
  }
  const result=[...plans.values()].sort((a,b)=>b.week.localeCompare(a.week)).concat(orphans);
  if(result.length>3000) throw Error('4機種の週一覧が上限に達しています。');
  return result;
}
export function recommendationPlans(raw=[]) {
  return mergeRecommendations([RECOMMENDATION_DEFAULT],raw,{strict:false}).flatMap(p=>{try{return [recommendationPlan(p)];}catch{return [];}});
}
export function recommendationName(selected,names) {
  if(names.includes(selected))return selected;
  const hits=names.filter(n=>normal(n)===normal(selected));
  return hits.length===1?hits[0]:null;
}
export function recommendationCandidates(records,week) {
  const end=recommendationDays(week)[6];
  const rows=records.filter(r=>r.store==='nagamachiminami'&&r.day<=end);
  const day=rows.map(r=>r.day).sort().at(-1)??null,groups=new Map();
  for(const r of rows)if(r.day===day){if(!groups.has(r.machine))groups.set(r.machine,new Set());groups.get(r.machine).add(r.rack);}
  return {day,machines:[...groups].filter(([,racks])=>racks.size>=7).map(([name,racks])=>({name,count:racks.size})).sort((a,b)=>a.name.localeCompare(b.name,'ja'))};
}
export function recommendationRows(records,week,selected) {
  const days=recommendationDays(week),rows=records.filter(r=>r.store==='nagamachiminami'&&days.includes(r.day));
  const names=new Map(days.map(day=>[day,recommendationName(selected,[...new Set(rows.filter(r=>r.day===day).map(r=>r.machine))]) ]));
  const cells=rows.filter(r=>r.machine===names.get(r.day)),racks=[...new Set(cells.map(r=>r.rack))].sort((a,b)=>a-b);
  // 同一日に同じ台が重複していたら、どちらかを推測で採用しない。
  return racks.map(rack=>({rack,cells:days.map(day=>{const hits=cells.filter(r=>r.rack===rack&&r.day===day);return hits.length===1?hits[0]:null;})}));
}
export function recommendationFace(net) {
  return typeof net!=='number'||!Number.isFinite(net)?'':net>=3000?'😍':net>=1000?'😀':net>=0?'😌':'🥶';
}

export const RECOMMENDATION_FACES=['😀','😍','🥶','😌','😇'];
export const recommendationResultKey=r=>JSON.stringify([r.store,r.week,r.machine,r.rack,r.day]);
export function recommendationResult(raw) {
  if(!raw||typeof raw!=='object'||!['store','week','machine','rack','day','value','updated_at'].every(k=>Object.hasOwn(raw,k)))throw Error('台ごとの顔文字が不正です。');
  // 店舗・週・時刻の検証は構成と同じ。結果から機種構成を変更することはない。
  recommendationPlan({...RECOMMENDATION_DEFAULT,...raw,machines:RECOMMENDATION_DEFAULT.machines});
  if(!validName(raw.machine)||!Number.isSafeInteger(raw.rack)||raw.rack<0||raw.rack>99999||!recommendationDays(raw.week).includes(raw.day)||![null,'',...RECOMMENDATION_FACES].includes(raw.value))throw Error('台ごとの顔文字が不正です。');
  return {store:raw.store,week:raw.week,machine:raw.machine,rack:raw.rack,day:raw.day,value:raw.value,updated_at:raw.updated_at,device:['pc','android','shared'].includes(raw.device)?raw.device:'pc'};
}
export function mergeRecommendationResults(stored=[],incoming=[],{strict=true}={}) {
  if(!Array.isArray(stored)||!Array.isArray(incoming)||stored.length>30000||incoming.length>30000)throw Error('台ごとの結果一覧が不正です。');
  const results=new Map(),orphans=[];
  for(const [items,check] of [[stored,false],[incoming,strict]])for(const raw of items){
    try {const r=recommendationResult(raw),k=recommendationResultKey(r),old=results.get(k);if(!old||time(r)>=time(old))results.set(k,r);}
    catch(e){if(check)throw e;orphans.push(raw);}
  }
  const out=[...results.values()].sort((a,b)=>recommendationResultKey(a).localeCompare(recommendationResultKey(b))).concat(orphans);
  if(out.length>30000)throw Error('台ごとの結果一覧が上限に達しています。');
  return out;
}
export function recommendationResultValue(results,fields,automatic) {
  const key=recommendationResultKey(fields);
  const r=mergeRecommendationResults(results,[],{strict:false}).find(r=>{try{return recommendationResultKey(recommendationResult(r))===key;}catch{return false;}});
  return !r||r.value===null?automatic:r.value;
}

export const recommendationNotOlder=(a,b)=>time(a)>=time(b);
