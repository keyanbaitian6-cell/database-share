// メルヘンの推定差枚（グラフの座標と最大持玉から計算）。database_android/lib/meruhen_net.dart・
// PC core.meruhen_net_estimate と同じ規則をそのまま移したもの（閲覧専用の共有ページ用、2026-10-09）。
// 規則を変えるときは3つを一緒に変え、database_android/tool/test_share_viewer.mjs の例も合わせる。

export const AXIS_STEPS = [1000, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000,
  22000, 24000, 26000, 28000, 30000, 32000, 34000, 36000, 38000, 40000];
const PLAUSIBLE_USE_PER_GAME = 1.75;
const MAX_USE_PER_GAME = 3.0;
const ZERO_Y = 200.5, TOP_Y = 20.5;
const HALF = ZERO_Y - TOP_Y;

function rise(values) {
  let low = 0, result = 0;
  for (const v of values) {
    if (v < low) low = v;
    if (v - low > result) result = v - low;
  }
  return result;
}

// Dartの round()（0.5は0から遠い方）と同じ丸め。
export function roundHalfAway(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 推定差枚と要確認の印。計算できないときは {value: null, needsCheck: false}。 */
export function meruhenNetDetail(measurement, maxHold, games) {
  const none = {value: null, needsCheck: false};
  if (!measurement || typeof measurement !== 'object') return none;
  const baselineY = num(measurement.baseline_y), peakY = num(measurement.peak_y);
  const endY = num(measurement.end_y);
  const troughY = num(measurement.trough_y ?? measurement.end_y);
  if (baselineY == null || peakY == null || endY == null || troughY == null) return none;
  if (Math.abs(baselineY - ZERO_Y) > 0.01) return none;
  if (maxHold == null || maxHold < 0 || maxHold > 100000) return none;
  const peak = baselineY - peakY, trough = baselineY - troughY, end = baselineY - endY;
  const amp = Math.max(Math.abs(peak), Math.abs(trough), Math.abs(end));
  if (amp === 0) return {value: 0, needsCheck: false};

  const fits = (index) => {
    const range = AXIS_STEPS[index];
    const previous = index === 0 ? 0 : AXIS_STEPS[index - 1];
    const unit = range / HALF;
    return amp * unit > previous - unit / 2 && amp * unit <= range + unit / 2;
  };

  let chosen = null, needsCheck = false;
  const curve = Array.isArray(measurement.curve) ? measurement.curve : null;
  if (curve && curve.length >= 2) {
    const values = curve.map(p => baselineY - p[1]);
    const r = rise(values);
    if (r <= 0) return none;
    const candidates = AXIS_STEPS.filter((step, i) => fits(i) && maxHold / (r * step / HALF) >= 0.98);
    let drops = 0;
    for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1]) drops += values[i - 1] - values[i];
    const within = (step, perGame) => games == null || games <= 0 || drops * step / HALF <= perGame * games;
    const plausible = candidates.filter(step => within(step, PLAUSIBLE_USE_PER_GAME));
    needsCheck = plausible.length !== candidates.length;
    if (plausible.length) chosen = plausible[plausible.length - 1];
    else if (candidates.length && within(candidates[0], MAX_USE_PER_GAME)) chosen = candidates[0];
  } else {
    const peakX = num(measurement.peak_x), troughX = num(measurement.trough_x), endX = num(measurement.end_x);
    let low;
    if (peakX == null || troughX == null) {
      low = peak > 0 ? peak : 0;
    } else {
      const points = [[0, 0], [peakX, peak], [troughX, trough], [endX ?? Infinity, end]]
        .map((p, i) => [...p, i]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
      low = rise(points.map(p => p[1]));
    }
    const high = (peak > 0 ? peak : 0) - (trough < 0 ? trough : 0);
    const feasible = AXIS_STEPS.filter((step, i) => {
      const unit = step / HALF;
      return fits(i) && maxHold >= low * unit * 0.98 - unit && maxHold <= high * unit * 1.3 + unit;
    });
    if (feasible.length === 1) chosen = feasible[0];
  }
  if (chosen == null) return none;
  return {value: roundHalfAway(end * chosen / HALF), needsCheck};
}
