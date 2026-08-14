// 試合状況(イニング・アウト・カウント・走者・得点)を進める純粋なルールエンジン。
//
// ここに置く関数は React に依存せず、同じ入力からは常に同じ出力を返す。
// 「記録から試合状況を作り直す」処理(rebuildGameStateFromPitches)が
// アプリの一番の要で、Undoやスコア修正、記録の遡り編集はすべてこれを通る。
// UIから切り離しておくことで、盤面のルールだけを単体テストで固められる。

import { outsAddedFor } from './playByPlay.js';
import { isEarnedAdvanceReason } from './runnerAdvance.js';

export const makeInitialGameState = () => ({
  inning: 1,
  isTop: true,
  outs: 0,
  balls: 0,
  strikes: 0,
  batterTop: 1,
  batterBottom: 1,
  runners: { first: false, second: false, third: false },
  runs: { top: [0, 0, 0, 0, 0, 0, 0, 0, 0], bottom: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  earnedRuns: { top: [0, 0, 0, 0, 0, 0, 0, 0, 0], bottom: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
});

export const makeInitialLineups = () => ({
  top: Array.from({ length: 10 }, (_, i) => ({ order: i < 9 ? i + 1 : '投', name: i < 9 ? `先攻${i + 1}番` : `先発投手`, pos: i === 9 ? '投' : '未', throws: '右', bats: '右' })),
  bottom: Array.from({ length: 10 }, (_, i) => ({ order: i < 9 ? i + 1 : '投', name: i < 9 ? `後攻${i + 1}番` : `先発投手`, pos: i === 9 ? '投' : '未', throws: '右', bats: '右' })),
});

// 得点配列を数値化し、少なくとも9イニング分(延長時は現在の回まで)の長さに揃える
export const ensureRunArray = (arr, inning) => {
  const runs = Array.isArray(arr) ? arr.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [];
  while (runs.length < Math.max(9, inning)) runs.push(0);
  return runs;
};

// 保存データや部分的な更新を、欠けたフィールドのない完全な状態に整える
export const normalizeGameState = (state) => {
  const base = makeInitialGameState();
  const merged = { ...base, ...(state || {}) };
  const inning = Math.max(1, merged.inning || 1);
  return {
    ...merged,
    inning,
    runs: {
      top: ensureRunArray(merged.runs?.top, inning),
      bottom: ensureRunArray(merged.runs?.bottom, inning),
    },
    earnedRuns: {
      // 旧データには自責点がないため得点を初期値として移行し、スコア修正画面で訂正できる。
      // merged ではなく引数の state を見る: merged は base の0埋め配列で必ず埋まるため、
      // merged.earnedRuns を見ると常に truthy になり移行が働かない。
      top: ensureRunArray(state?.earnedRuns?.top || merged.runs?.top, inning),
      bottom: ensureRunArray(state?.earnedRuns?.bottom || merged.runs?.bottom, inning),
    },
    runners: { ...base.runners, ...(merged.runners || {}) },
  };
};

// 打席結果1件で盤面を進める。addedOuts は併殺打などで増えるアウト数。
export const advanceGameState = (prev, eventType, addedOuts = 0) => {
  const state = normalizeGameState(prev);
  let newOuts = state.outs + addedOuts, newInning = state.inning, newIsTop = state.isTop, newBatterTop = state.batterTop, newBatterBottom = state.batterBottom;
  let newRunners = { ...state.runners }, newRunsArray = ensureRunArray(state.runs[state.isTop ? 'top' : 'bottom'], newInning), runScored = 0;
  if (newOuts < 3) {
    if (eventType === 'walk' || eventType === 'other') {
      if (newRunners.first && newRunners.second && newRunners.third) runScored = 1; else if (newRunners.first && newRunners.second) newRunners.third = true; else if (newRunners.first) newRunners.second = true; newRunners.first = true;
    } else if (['single', 'error'].includes(eventType)) {
      if (newRunners.third) runScored++; newRunners.third = newRunners.second; newRunners.second = newRunners.first; newRunners.first = true;
    } else if (eventType === 'double') {
      if (newRunners.third) runScored++; if (newRunners.second) runScored++; newRunners.third = newRunners.first; newRunners.second = true; newRunners.first = false;
    } else if (eventType === 'triple') {
      if (newRunners.third) runScored++; if (newRunners.second) runScored++; if (newRunners.first) runScored++; newRunners.third = true; newRunners.second = false; newRunners.first = false;
    } else if (eventType === 'homerun') {
      if (newRunners.third) runScored++; if (newRunners.second) runScored++; if (newRunners.first) runScored++; runScored++; newRunners = { first: false, second: false, third: false };
    } else if (eventType === 'sac_bunt') {
      if (newRunners.third) runScored++; newRunners.third = newRunners.second; newRunners.second = newRunners.first; newRunners.first = false;
    } else if (eventType === 'sac_fly') {
      if (newRunners.third) runScored++; newRunners.third = false;
    }
  }
  if (runScored > 0) newRunsArray[newInning - 1] = (newRunsArray[newInning - 1] || 0) + runScored;
  if (state.isTop) newBatterTop = newBatterTop === 9 ? 1 : newBatterTop + 1; else newBatterBottom = newBatterBottom === 9 ? 1 : newBatterBottom + 1;
  if (newOuts >= 3) { newOuts = 0; newRunners = { first: false, second: false, third: false }; if (state.isTop) newIsTop = false; else { newIsTop = true; newInning++; } }
  const scoringTeam = state.isTop ? 'top' : 'bottom';
  const nextRuns = { ...state.runs, [scoringTeam]: newRunsArray };
  const nextEarnedRuns = { ...state.earnedRuns, top: ensureRunArray(state.earnedRuns?.top, newInning), bottom: ensureRunArray(state.earnedRuns?.bottom, newInning) };
  if (runScored > 0) nextEarnedRuns[scoringTeam][state.inning - 1] = (nextEarnedRuns[scoringTeam][state.inning - 1] || 0) + runScored;
  nextRuns.top = ensureRunArray(nextRuns.top, newInning);
  nextRuns.bottom = ensureRunArray(nextRuns.bottom, newInning);
  return { ...state, outs: newOuts, balls: 0, strikes: 0, batterTop: newBatterTop, batterBottom: newBatterBottom, inning: newInning, isTop: newIsTop, runners: newRunners, runs: nextRuns, earnedRuns: nextEarnedRuns };
};

// 結果テキストから走者の進み方の種別を判定する
export const resultToEventType = (result) => {
  if (result.includes('本塁打')) return 'homerun';
  if (result.includes('三塁打')) return 'triple';
  if (result.includes('二塁打')) return 'double';
  if (result.includes('安')) return 'single';
  if (['エラー', '敵失(エラー)', '野手選択'].some((w) => result.includes(w))) return 'error';
  if (result.includes('犠打')) return 'sac_bunt';
  if (result.includes('犠飛')) return 'sac_fly';
  return 'out';
};

// 走者イベント記録(「2塁走者 盗塁で3塁へ」「1塁走者が牽制死」など)1件を試合状況へ反映する。
// 記録の再構築(rebuildGameStateFromPitches)と、打席直後の進塁補正の両方から使う。
export const applyRunnerEventToState = (prev, resultText) => {
  const state = normalizeGameState(prev);
  const res = resultText || '';
  const runnerKey = res.startsWith('1塁走者') ? 'first' : res.startsWith('2塁走者') ? 'second' : res.startsWith('3塁走者') ? 'third' : null;
  if (!runnerKey) return state;
  if (res.includes('が')) {
    let newOuts = state.outs + 1, newRunners = { ...state.runners, [runnerKey]: false }, newInning = state.inning, newIsTop = state.isTop;
    if (newOuts >= 3) { newOuts = 0; newRunners = { first: false, second: false, third: false }; if (state.isTop) newIsTop = false; else { newIsTop = true; newInning++; } }
    return normalizeGameState({ ...state, outs: newOuts, inning: newInning, isTop: newIsTop, runners: newRunners, balls: 0, strikes: 0 });
  }
  if (res.includes('で')) {
    const newRunners = { ...state.runners, [runnerKey]: false };
    const runs = { ...state.runs };
    const earnedRuns = { ...state.earnedRuns };
    if (res.includes('2塁へ')) newRunners.second = true;
    else if (res.includes('3塁へ')) newRunners.third = true;
    else if (res.includes('本塁へ')) {
      const team = state.isTop ? 'top' : 'bottom';
      const arr = ensureRunArray(runs[team], state.inning); arr[state.inning - 1] = (arr[state.inning - 1] || 0) + 1; runs[team] = arr;
      // 打球・送球間での生還は自責点に数える(盗塁・暴投など従来の理由は据え置き)
      const reason = (res.split(' ')[1] || '').split('で')[0];
      if (isEarnedAdvanceReason(reason)) {
        const er = ensureRunArray(earnedRuns[team], state.inning); er[state.inning - 1] = Math.min(arr[state.inning - 1], (er[state.inning - 1] || 0) + 1); earnedRuns[team] = er;
      }
    }
    return normalizeGameState({ ...state, runners: newRunners, runs, earnedRuns });
  }
  return state;
};

// 一球ごとの記録の配列から、試合状況を最初から組み立て直す。
// 記録の遡り修正・削除・打順変更のあと、必ずここを通して盤面を作り直す。
export const rebuildGameStateFromPitches = (records) => {
  let state = makeInitialGameState();
  let lastAtBatKey = null;
  records.forEach((p) => {
    state = normalizeGameState({ ...state, inning: p.inning || state.inning, isTop: p.isTop, ...(p.isTop ? { batterTop: p.batter || state.batterTop } : { batterBottom: p.batter || state.batterBottom }) });
    if (!p.isEvent) {
      // 打順修正などで途中から打者が変わった場合は新しい打席としてカウントをリセットする
      const atBatKey = `${p.inning}-${p.isTop}-${p.batter}`;
      if (lastAtBatKey !== null && atBatKey !== lastAtBatKey) state = { ...state, balls: 0, strikes: 0 };
      lastAtBatKey = atBatKey;
    }
    if (p.isEvent) {
      state = applyRunnerEventToState(state, p.result);
      return;
    }
    const res = p.result || '';
    if (['ボール', 'ウエスト'].includes(res)) state = state.balls >= 3 ? advanceGameState(state, 'walk', 0) : { ...state, balls: state.balls + 1 };
    else if (res === '死球' || res === 'その他出塁') state = advanceGameState(state, res === 'その他出塁' ? 'other' : 'walk', 0);
    else if (['ストライク', '空振り', 'バント空振り'].includes(res)) state = state.strikes >= 2 ? advanceGameState(state, 'out', 1) : { ...state, strikes: state.strikes + 1 };
    else if (['ファウル', 'バントファウル'].includes(res)) state = state.strikes < 2 ? { ...state, strikes: state.strikes + 1 } : state;
    else if (res === 'スリーバント失敗' || res === '三振' || res === '振り逃げアウト') state = advanceGameState(state, 'out', 1);
    else if (res === '振り逃げ') state = advanceGameState(state, 'error', 0);
    // 打者アウトの数は結果テキストから判定する(併殺打=2、犠打/犠飛=1、
    // 「ライトゴロ」「右ゴロ」など守備位置の表記ゆれも1アウト)
    else if (!res?.startsWith('牽制')) state = advanceGameState(state, resultToEventType(res), outsAddedFor(res));
  });
  return normalizeGameState(state);
};
