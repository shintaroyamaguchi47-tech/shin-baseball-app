// 相手投手の分析(次戦に向けたスカウティング)。
// 保存済みの投球記録から、カウント別の球種傾向・決め球・コース・牽制・盗塁・球数による変化を集計する。
// 画面に依存しない純粋関数にしてあり、テストからも直接呼べる。
import { isBallResult, isStrikeResult, isFoulResult, isPitchClockViolation } from './pitchResults.js';

const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const rate = (a, b) => b ? (a / b).toFixed(3) : '0.000';
const isHitResult = r => ['安', '塁打', '本塁打'].some(v => r?.includes(v));
const isPickoff = r => typeof r === 'string' && r.startsWith('牽制');
// 「投げた球」ではない記録(牽制・違反・その他出塁・盗塁死の旧形式)は球数や球種の集計から外す
const isThrownPitch = p => !p.isEvent && !isPickoff(p.result) && !isPitchClockViolation(p.result) && !['その他出塁', '盗塁死'].includes(p.result);
const normType = t => (t && t !== '-' ? String(t).replace(/系$/, '') : '不明');
const isFastball = t => /ストレート|シュート/.test(t || '');
const sideOf = bats => (String(bats || '').includes('左') ? '左' : '右');

export const COUNTS = [0, 1, 2, 3].flatMap(b => [0, 1, 2].map(s => `${b}-${s}`));
// 打者有利(ボール先行)・追い込まれ のカウント
const HITTER_COUNTS = new Set(['1-0', '2-0', '3-0', '2-1', '3-1']);
export const PITCH_COUNT_BANDS = [
  { label: '1〜25球', min: 1, max: 25 },
  { label: '26〜50球', min: 26, max: 50 },
  { label: '51〜75球', min: 51, max: 75 },
  { label: '76〜100球', min: 76, max: 100 },
  { label: '101球〜', min: 101, max: Infinity },
];

const typeShares = (list) => {
  const counts = {};
  list.forEach(p => { const t = normType(p.type); counts[t] = (counts[t] || 0) + 1; });
  return Object.entries(counts).map(([type, n]) => ({ type, n, pct: pct(n, list.length) })).sort((a, b) => b.n - a.n);
};

// コース(7×7、捕手目線で保存)を 高め/真ん中/低め・内角/真ん中/外角 に分ける。
// 捕手から見て右打者は左側に立つので、右打者は列0〜2が内角、左打者は列4〜6が内角。
export const courseZone = (course, bats) => {
  if (course === null || course === undefined) return null;
  const row = Math.floor(course / 7), col = course % 7;
  const inZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
  const height = row <= 2 ? '高め' : row >= 4 ? '低め' : '真ん中';
  const insideCol = sideOf(bats) === '右' ? col <= 2 : col >= 4;
  const outsideCol = sideOf(bats) === '右' ? col >= 4 : col <= 2;
  const width = insideCol ? '内角' : outsideCol ? '外角' : '真ん中';
  return { row, col, inZone, height, width };
};

/**
 * 投手の一覧(そのチームが守備のときに投げた投手)を、投球数の多い順に返す。
 */
export function listTeamPitchers(db, games, teamId) {
  const map = new Map();
  games.forEach(g => {
    const pitchingIsTop = g.bottomTeamId === teamId; // 相手が表の攻撃 = 自分が守備
    if (g.topTeamId !== teamId && g.bottomTeamId !== teamId) return;
    db.pitches.filter(p => p.gameId === g.id && p.isTop === pitchingIsTop && p.pitcherName).forEach(p => {
      const row = map.get(p.pitcherName) || { name: p.pitcherName, throws: p.pitcherThrows || '', pitches: 0, games: new Set() };
      if (isThrownPitch(p)) row.pitches++;
      row.games.add(g.id);
      if (!row.throws && p.pitcherThrows) row.throws = p.pitcherThrows;
      map.set(p.pitcherName, row);
    });
  });
  return [...map.values()].map(r => {
    const player = db.players.find(pl => pl.teamId === teamId && pl.name === r.name);
    return { id: player?.id || `pitcher_${teamId}_${r.name}`, name: r.name, throws: r.throws || player?.throws || '', pitches: r.pitches, games: r.games.size };
  }).sort((a, b) => b.pitches - a.pitches);
}

/**
 * 投手1人(pitcherName=null ならチームの全投手)の分析レポートを作る。
 * @param {object} db normalizeArchive の戻り値
 * @param {Array} games 対象の試合(db.games の一部)
 * @param {string} teamId 投手が所属するチーム
 * @param {string|null} pitcherName
 */
export function buildPitcherReport(db, games, teamId, pitcherName = null) {
  const thrown = [];       // 投げた球(カウント・試合内の球数つき)
  const pickoffs = [];     // 牽制
  const events = [];       // 盗塁・牽制死など
  const plateAppearances = []; // 打席ごとの投球の並び
  const gameIds = new Set();

  games.forEach(g => {
    if (g.topTeamId !== teamId && g.bottomTeamId !== teamId) return;
    const pitchingIsTop = g.bottomTeamId === teamId;
    const rows = db.pitches.filter(p => p.gameId === g.id && p.isTop === pitchingIsTop);
    let pa = null, b = 0, s = 0;
    const gamePitchCount = {};
    const closePa = () => { if (pa && pa.pitches.length) plateAppearances.push({ ...pa, balls: b, strikes: s }); pa = null; b = 0; s = 0; };
    rows.forEach(p => {
      const paKey = `${p.inning}|${p.isTop}|${p.batter}`;
      const startsNewPa = !p.isEvent && p.pitchNumber === 1 && pa && pa.pitches.length;
      if (!pa || pa.key !== paKey || startsNewPa) { closePa(); pa = { key: paKey, gameId: g.id, pitcherName: p.pitcherName, batterBats: p.batterBats, pitches: [], runnersOn: false }; }
      const mine = !pitcherName || p.pitcherName === pitcherName;
      if (p.runners && (p.runners.first || p.runners.second || p.runners.third)) pa.runnersOn = true;
      if (p.isEvent) {
        if (mine) events.push({ ...p, gameId: g.id });
        return;
      }
      if (isPickoff(p.result)) {
        if (mine) pickoffs.push({ ...p, gameId: g.id, base: (p.result.match(/\((.+)\)/) || [])[1] || '不明' });
        return;
      }
      if (isPitchClockViolation(p.result)) {
        if (isBallResult(p.result)) b++; else if (isStrikeResult(p.result)) s++;
        return;
      }
      if (!isThrownPitch(p)) return;
      gamePitchCount[p.pitcherName] = (gamePitchCount[p.pitcherName] || 0) + 1;
      const row = { ...p, gameId: g.id, count: `${Math.min(b, 3)}-${Math.min(s, 2)}`, gamePitchNo: gamePitchCount[p.pitcherName], typeName: normType(p.type), bats: sideOf(p.batterBats) };
      if (mine) { thrown.push(row); gameIds.add(g.id); }
      pa.pitches.push(row);
      pa.pitcherName = p.pitcherName;
      if (isBallResult(p.result)) b++;
      else if (isStrikeResult(p.result)) s++;
      else if (isFoulResult(p.result) && s < 2) s++;
    });
    closePa();
  });

  const myPas = plateAppearances.filter(pa => !pitcherName || pa.pitcherName === pitcherName);
  // 打席の結末(最後の球)から、三振・四死球・安打を判定
  const outcomes = myPas.map(pa => {
    const last = pa.pitches.at(-1);
    // 打席の最後のカウント(ファウルやピッチクロック違反の宣告も反映済み)
    const { balls, strikes } = pa;
    const r = last?.result || '';
    const strikeout = (strikes >= 3 && isStrikeResult(r)) || /三振|振り逃げ|スリーバント失敗/.test(r);
    const walk = balls >= 4 && isBallResult(r);
    const hbp = r === '死球';
    const hit = isHitResult(r);
    const finished = strikeout || walk || hbp || hit || !(isBallResult(r) || isStrikeResult(r) || isFoulResult(r));
    return { pa, last, strikeout, walk, hbp, hit, finished, isAtBat: finished && !walk && !hbp && !r.includes('犠') };
  }).filter(o => o.finished);

  const strikes = thrown.filter(p => !isBallResult(p.result) && p.result !== '死球');
  const firstPitches = thrown.filter(p => p.count === '0-0');
  const swings = thrown.filter(p => p.isSwing);
  const whiffs = thrown.filter(p => /空振り/.test(p.result || ''));

  const summary = {
    games: gameIds.size,
    batters: outcomes.length,
    pitches: thrown.length,
    pitchesPerBatter: outcomes.length ? (thrown.length / outcomes.length).toFixed(1) : '0.0',
    strikePct: pct(strikes.length, thrown.length),
    firstStrikePct: pct(firstPitches.filter(p => !isBallResult(p.result) && p.result !== '死球').length, firstPitches.length),
    whiffPct: pct(whiffs.length, swings.length),
    KPct: pct(outcomes.filter(o => o.strikeout).length, outcomes.length),
    BBPct: pct(outcomes.filter(o => o.walk || o.hbp).length, outcomes.length),
    AVG: rate(outcomes.filter(o => o.hit).length, outcomes.filter(o => o.isAtBat).length),
    strikeouts: outcomes.filter(o => o.strikeout).length,
  };

  // 球種別: 割合・ストライク率・空振り率・被安打
  const byType = typeShares(thrown).map(({ type, n, pct: share }) => {
    const list = thrown.filter(p => p.typeName === type);
    const sw = list.filter(p => p.isSwing);
    return {
      type, n, share,
      strikePct: pct(list.filter(p => !isBallResult(p.result) && p.result !== '死球').length, n),
      whiffPct: pct(sw.filter(p => /空振り/.test(p.result || '')).length, sw.length),
      hits: outcomes.filter(o => o.hit && o.last?.typeName === type).length,
      strikeouts: outcomes.filter(o => o.strikeout && o.last?.typeName === type).length,
      vsRight: pct(list.filter(p => p.bats === '右').length, thrown.filter(p => p.bats === '右').length),
      vsLeft: pct(list.filter(p => p.bats === '左').length, thrown.filter(p => p.bats === '左').length),
    };
  });

  // カウント別: 最も多い球種(=狙い球の候補)とストライク率
  const byCount = COUNTS.map(count => {
    const list = thrown.filter(p => p.count === count);
    const shares = typeShares(list);
    return {
      count, n: list.length, shares,
      top: shares[0] || null,
      fastballPct: pct(list.filter(p => isFastball(p.typeName)).length, list.length),
      strikePct: pct(list.filter(p => !isBallResult(p.result) && p.result !== '死球').length, list.length),
      byBats: ['右', '左'].map(side => { const l = list.filter(p => p.bats === side); return { side, n: l.length, top: typeShares(l)[0] || null }; }),
    };
  });
  const group = (pred) => { const list = thrown.filter(pred); return { n: list.length, shares: typeShares(list), fastballPct: pct(list.filter(p => isFastball(p.typeName)).length, list.length), strikePct: pct(list.filter(p => !isBallResult(p.result) && p.result !== '死球').length, list.length) }; };
  const situations = {
    first: group(p => p.count === '0-0'),
    hitterAhead: group(p => HITTER_COUNTS.has(p.count)),
    twoStrikes: group(p => p.count.endsWith('-2')),
    full: group(p => p.count === '3-2'),
  };
  // 三振を奪った球種(決め球)
  const kPitches = typeShares(outcomes.filter(o => o.strikeout && o.last).map(o => o.last));

  // コース: 打者の左右別に 7×7 の回数と、高低・内外の割合
  const course = ['右', '左'].map(side => {
    const list = thrown.filter(p => p.bats === side && p.course !== null && p.course !== undefined);
    const grid = Array(49).fill(0);
    const height = { 高め: 0, 真ん中: 0, 低め: 0 }, width = { 内角: 0, 真ん中: 0, 外角: 0 };
    list.forEach(p => { grid[p.course]++; const z = courseZone(p.course, side); height[z.height]++; width[z.width]++; });
    return { side, n: list.length, grid, max: Math.max(1, ...grid), height, width };
  });

  // 牽制・走者
  const pickoffBases = pickoffs.reduce((acc, p) => { acc[p.base] = (acc[p.base] || 0) + 1; return acc; }, {});
  const pasWithRunners = myPas.filter(pa => pa.runnersOn).length;
  const stealEvents = events.filter(e => /盗塁/.test(e.result || ''));
  const running = {
    pickoffs: pickoffs.length,
    pickoffBases,
    pasWithRunners,
    pickoffsPerRunnerPa: pasWithRunners ? (pickoffs.length / pasWithRunners).toFixed(1) : '0.0',
    pickoffOuts: events.filter(e => /牽制死/.test(e.result || '')).length,
    stealsAllowed: stealEvents.filter(e => !/盗塁死/.test(e.result)).length,
    caughtStealing: stealEvents.filter(e => /盗塁死/.test(e.result)).length,
    balks: events.filter(e => /ボーク/.test(e.result || '')).length,
    wildPitches: events.filter(e => /暴投/.test(e.result || '')).length,
  };

  // 球数による変化(スタミナ)
  const stamina = PITCH_COUNT_BANDS.map(band => {
    const list = thrown.filter(p => p.gamePitchNo >= band.min && p.gamePitchNo <= band.max);
    const endPas = outcomes.filter(o => o.last && o.last.gamePitchNo >= band.min && o.last.gamePitchNo <= band.max);
    return { ...band, n: list.length, strikePct: pct(list.filter(p => !isBallResult(p.result) && p.result !== '死球').length, list.length), fastballPct: pct(list.filter(p => isFastball(p.typeName)).length, list.length), hits: endPas.filter(o => o.hit).length, walks: endPas.filter(o => o.walk || o.hbp).length };
  }).filter(b => b.n > 0);

  return { summary, byType, byCount, situations, kPitches, course, running, stamina };
}

const average = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
export const quickTimeStats = (times = []) => {
  const nums = times.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return { n: nums.length, avg: average(nums), min: Math.min(...nums), max: Math.max(...nums) };
};

/**
 * 集計とメモから「次戦の攻略ポイント」を文章で組み立てる。根拠の数字も添える。
 */
export function buildGamePlan(report, memo = {}) {
  const tips = [];
  const { summary, situations, kPitches, running, stamina } = report;
  if (!summary.pitches) return tips;
  const enough = n => n >= 5; // 少なすぎる球数では言い切らない

  if (enough(situations.first.n)) {
    const top = situations.first.shares[0];
    if (summary.firstStrikePct >= 65) tips.push({ tone: 'attack', text: `初球からストライクを取りに来る(初球ストライク率${summary.firstStrikePct}%)。初球の${top?.type}(${top?.pct}%)を積極的に打つ` });
    else if (summary.firstStrikePct <= 45) tips.push({ tone: 'wait', text: `初球はボールになりやすい(初球ストライク率${summary.firstStrikePct}%)。初球は見ていける` });
  }
  if (enough(situations.hitterAhead.n)) {
    const top = situations.hitterAhead.shares[0];
    if (top && top.pct >= 60) tips.push({ tone: 'attack', text: `ボール先行のカウントでは${top.type}が${top.pct}%。狙い球を${top.type}に絞る` });
    else if (situations.hitterAhead.fastballPct <= 40) tips.push({ tone: 'caution', text: `ボール先行でも変化球が多い(直球系${situations.hitterAhead.fastballPct}%)。変化球でカウントを取りに来る` });
  }
  if (enough(situations.twoStrikes.n)) {
    const top = situations.twoStrikes.shares[0];
    const k = kPitches[0];
    tips.push({ tone: 'caution', text: `追い込まれたら${top?.type}(${top?.pct}%)が多い${k ? `。三振は${k.type}で${k.n}個` : ''}` });
  }
  if (summary.pitchesPerBatter && Number(summary.pitchesPerBatter) >= 4.2) tips.push({ tone: 'wait', text: `打者1人あたり${summary.pitchesPerBatter}球と球数がかさむ。粘って球数を投げさせる` });

  if (summary.batters >= 5 || running.pickoffs) {
    if (running.pickoffs === 0 && running.pasWithRunners >= 2) tips.push({ tone: 'attack', text: `走者がいても牽制が記録されていない(走者ありの打者${running.pasWithRunners}人)。リードを大きく取れる` });
    else if (running.pickoffs > 0) {
      const most = Object.entries(running.pickoffBases).sort((a, b) => b[1] - a[1])[0];
      tips.push({ tone: Number(running.pickoffsPerRunnerPa) >= 1 ? 'caution' : 'info', text: `牽制${running.pickoffs}回(走者ありの打者1人あたり${running.pickoffsPerRunnerPa}回、${most[0]}が${most[1]}回)${running.pickoffOuts ? `・牽制死${running.pickoffOuts}` : ''}` });
    }
  }
  const quick = quickTimeStats(memo.quickTimes);
  if (quick) {
    if (quick.avg >= 1.3) tips.push({ tone: 'attack', text: `クイックが遅い(平均${quick.avg.toFixed(2)}秒)。盗塁・エンドランを積極的に` });
    else if (quick.avg <= 1.15) tips.push({ tone: 'caution', text: `クイックが速い(平均${quick.avg.toFixed(2)}秒)。盗塁はスタートを見極めて` });
    else tips.push({ tone: 'info', text: `クイックは平均${quick.avg.toFixed(2)}秒(${quick.n}回計測)` });
  }
  if (running.stealsAllowed + running.caughtStealing > 0) tips.push({ tone: 'info', text: `盗塁は許${running.stealsAllowed}・刺${running.caughtStealing}` });

  const early = stamina.find(b => b.min === 1), late = stamina.filter(b => b.min >= 76 && b.n >= 10);
  if (early && early.n >= 10 && late.length) {
    const lateStrike = Math.round(late.reduce((n, b) => n + b.strikePct * b.n, 0) / late.reduce((n, b) => n + b.n, 0));
    if (early.strikePct - lateStrike >= 8) tips.push({ tone: 'wait', text: `76球を超えるとストライク率が落ちる(${early.strikePct}%→${lateStrike}%)。序盤から球数を投げさせる` });
  }
  return tips;
}
