import { describe, it, expect } from 'vitest';
import {
  makeInitialGameState,
  makeInitialLineups,
  ensureRunArray,
  normalizeGameState,
  advanceGameState,
  resultToEventType,
  applyRunnerEventToState,
  rebuildGameStateFromPitches,
} from '../gameState.js';

// テスト用に盤面を組み立てる
const state = (over = {}) => normalizeGameState({ ...makeInitialGameState(), ...over });
const bases = (first, second, third) => ({ first, second, third });
const runsIn = (s, inning = 1, team = 'top') => s.runs[team][inning - 1];
const earnedIn = (s, inning = 1, team = 'top') => s.earnedRuns[team][inning - 1];

describe('normalizeGameState', () => {
  it('欠けたフィールドを初期値で埋める', () => {
    const s = normalizeGameState({ inning: 3 });
    expect(s.outs).toBe(0);
    expect(s.isTop).toBe(true);
    expect(s.runners).toEqual(bases(false, false, false));
  });

  it('null や未定義でも初期状態を返す', () => {
    expect(normalizeGameState(null)).toEqual(makeInitialGameState());
    expect(normalizeGameState(undefined).inning).toBe(1);
  });

  it('自責点を持たない旧データは得点をそのまま引き継ぐ', () => {
    const s = normalizeGameState({ runs: { top: [1, 2, 0], bottom: [0, 0, 3] } });
    expect(s.earnedRuns.top.slice(0, 3)).toEqual([1, 2, 0]);
    expect(s.earnedRuns.bottom.slice(0, 3)).toEqual([0, 0, 3]);
  });

  it('延長回まで得点配列を伸ばす', () => {
    const s = normalizeGameState({ inning: 12 });
    expect(s.runs.top).toHaveLength(12);
    expect(s.earnedRuns.bottom).toHaveLength(12);
  });

  it('イニングは1未満にならない', () => {
    expect(normalizeGameState({ inning: 0 }).inning).toBe(1);
    expect(normalizeGameState({ inning: -5 }).inning).toBe(1);
  });
});

describe('ensureRunArray', () => {
  it('9イニング分に満たない配列を埋める', () => {
    expect(ensureRunArray([1, 2], 1)).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('数値でない値を0に均す', () => {
    expect(ensureRunArray(['3', null, 'あ'], 1).slice(0, 3)).toEqual([3, 0, 0]);
  });

  it('配列でなければ空から作る', () => {
    expect(ensureRunArray(undefined, 1)).toHaveLength(9);
  });
});

describe('advanceGameState', () => {
  it('四球は打者を1塁へ置き、走者を押し出す', () => {
    const s = advanceGameState(state({ runners: bases(true, false, false) }), 'walk');
    expect(s.runners).toEqual(bases(true, true, false));
    expect(runsIn(s)).toBe(0);
  });

  it('満塁の四球は押し出しで1点入り、満塁のまま', () => {
    const s = advanceGameState(state({ runners: bases(true, true, true) }), 'walk');
    expect(s.runners).toEqual(bases(true, true, true));
    expect(runsIn(s)).toBe(1);
  });

  it('単打は走者を1つずつ進め、3塁走者が生還する', () => {
    const s = advanceGameState(state({ runners: bases(true, false, true) }), 'single');
    expect(s.runners).toEqual(bases(true, true, false));
    expect(runsIn(s)).toBe(1);
  });

  it('二塁打は2塁・3塁の走者を還す', () => {
    const s = advanceGameState(state({ runners: bases(true, true, true) }), 'double');
    expect(s.runners).toEqual(bases(false, true, true));
    expect(runsIn(s)).toBe(2);
  });

  it('三塁打は走者を一掃して打者が3塁に残る', () => {
    const s = advanceGameState(state({ runners: bases(true, true, true) }), 'triple');
    expect(s.runners).toEqual(bases(false, false, true));
    expect(runsIn(s)).toBe(3);
  });

  it('満塁本塁打は4点入って走者がいなくなる', () => {
    const s = advanceGameState(state({ runners: bases(true, true, true) }), 'homerun');
    expect(s.runners).toEqual(bases(false, false, false));
    expect(runsIn(s)).toBe(4);
    expect(earnedIn(s)).toBe(4);
  });

  it('犠打は走者を進めるが打者は出塁しない', () => {
    const s = advanceGameState(state({ runners: bases(true, false, false) }), 'sac_bunt', 1);
    expect(s.runners).toEqual(bases(false, true, false));
    expect(s.outs).toBe(1);
  });

  it('犠飛は3塁走者だけを還す', () => {
    const s = advanceGameState(state({ runners: bases(false, true, true) }), 'sac_fly', 1);
    expect(s.runners).toEqual(bases(false, true, false));
    expect(runsIn(s)).toBe(1);
  });

  it('3アウトで表裏が入れ替わり、走者とアウトが消える', () => {
    const s = advanceGameState(state({ outs: 2, runners: bases(true, true, false) }), 'out', 1);
    expect(s.outs).toBe(0);
    expect(s.isTop).toBe(false);
    expect(s.inning).toBe(1);
    expect(s.runners).toEqual(bases(false, false, false));
  });

  it('裏の3アウトで次のイニングに進む', () => {
    const s = advanceGameState(state({ isTop: false, outs: 2 }), 'out', 1);
    expect(s.inning).toBe(2);
    expect(s.isTop).toBe(true);
  });

  it('3アウト目の打球では走者は進まない(得点しない)', () => {
    const s = advanceGameState(state({ outs: 2, runners: bases(false, false, true) }), 'single', 1);
    expect(runsIn(s)).toBe(0);
  });

  it('併殺打は一度に2アウト増える', () => {
    const s = advanceGameState(state({ outs: 0, runners: bases(true, false, false) }), 'out', 2);
    expect(s.outs).toBe(2);
  });

  it('打順は9番の次に1番へ戻る', () => {
    expect(advanceGameState(state({ batterTop: 8 }), 'out', 1).batterTop).toBe(9);
    expect(advanceGameState(state({ batterTop: 9 }), 'out', 1).batterTop).toBe(1);
  });

  it('攻撃中でない側の打順は動かない', () => {
    const s = advanceGameState(state({ isTop: true, batterTop: 3, batterBottom: 5 }), 'out', 1);
    expect(s.batterTop).toBe(4);
    expect(s.batterBottom).toBe(5);
  });

  it('打席が終わるとボール・ストライクがリセットされる', () => {
    const s = advanceGameState(state({ balls: 3, strikes: 2 }), 'single');
    expect(s.balls).toBe(0);
    expect(s.strikes).toBe(0);
  });

  it('得点は打った回に記録される(回またぎでずれない)', () => {
    const s = advanceGameState(state({ inning: 3, outs: 2, runners: bases(false, false, true) }), 'homerun', 0);
    expect(runsIn(s, 3)).toBe(2);
    expect(earnedIn(s, 3)).toBe(2);
  });
});

describe('resultToEventType', () => {
  it.each([
    ['ソロ本塁打', 'homerun'],
    ['左中間三塁打', 'triple'],
    ['右二塁打', 'double'],
    ['中前安打', 'single'],
    ['エラー', 'error'],
    ['野手選択', 'error'],
    ['送りバント犠打', 'sac_bunt'],
    ['犠飛', 'sac_fly'],
    ['ショートゴロ', 'ground_out'],
    ['セカンド併殺打', 'double_play'],
    ['センター飛', 'out'],
  ])('%s を %s と判定する', (result, expected) => {
    expect(resultToEventType(result)).toBe(expected);
  });
});

describe('applyRunnerEventToState', () => {
  it('盗塁で走者が進む', () => {
    const s = applyRunnerEventToState(state({ runners: bases(true, false, false) }), '1塁走者 盗塁で2塁へ');
    expect(s.runners).toEqual(bases(false, true, false));
  });

  it('走者が刺されるとアウトが増えて塁が空く', () => {
    const s = applyRunnerEventToState(state({ runners: bases(false, true, false) }), '2塁走者が盗塁死');
    expect(s.outs).toBe(1);
    expect(s.runners).toEqual(bases(false, false, false));
  });

  it('3アウト目の走者アウトで攻守が入れ替わる', () => {
    const s = applyRunnerEventToState(state({ outs: 2, runners: bases(true, false, false) }), '1塁走者が牽制死');
    expect(s.outs).toBe(0);
    expect(s.isTop).toBe(false);
  });

  it('打球での生還は自責点に数える', () => {
    const s = applyRunnerEventToState(state({ runners: bases(false, false, true) }), '3塁走者 打球で本塁へ');
    expect(runsIn(s)).toBe(1);
    expect(earnedIn(s)).toBe(1);
  });

  it('盗塁での生還は自責点に数えない', () => {
    const s = applyRunnerEventToState(state({ runners: bases(false, false, true) }), '3塁走者 盗塁で本塁へ');
    expect(runsIn(s)).toBe(1);
    expect(earnedIn(s)).toBe(0);
  });

  it('走者を指さないテキストは状態を変えない', () => {
    const before = state({ runners: bases(true, false, false) });
    expect(applyRunnerEventToState(before, '選手交代: 代打').runners).toEqual(bases(true, false, false));
    expect(applyRunnerEventToState(before, '').outs).toBe(0);
  });
});

describe('rebuildGameStateFromPitches', () => {
  const pitch = (result, over = {}) => ({ inning: 1, isTop: true, batter: 1, result, ...over });

  it('記録がなければ初期状態を返す', () => {
    expect(rebuildGameStateFromPitches([])).toEqual(makeInitialGameState());
  });

  it('4球目のボールで四球になる', () => {
    const s = rebuildGameStateFromPitches([pitch('ボール'), pitch('ボール'), pitch('ボール')]);
    expect(s.balls).toBe(3);
    expect(s.runners.first).toBe(false);

    const walked = rebuildGameStateFromPitches([pitch('ボール'), pitch('ボール'), pitch('ボール'), pitch('ボール')]);
    expect(walked.runners.first).toBe(true);
    expect(walked.balls).toBe(0);
    expect(walked.batterTop).toBe(2);
  });

  it('3球目のストライクで三振アウトになる', () => {
    const s = rebuildGameStateFromPitches([pitch('ストライク'), pitch('空振り'), pitch('ストライク')]);
    expect(s.outs).toBe(1);
    expect(s.strikes).toBe(0);
  });

  it('ファウルは2ストライクからカウントを増やさない', () => {
    const s = rebuildGameStateFromPitches([pitch('ストライク'), pitch('ストライク'), pitch('ファウル'), pitch('ファウル')]);
    expect(s.strikes).toBe(2);
    expect(s.outs).toBe(0);
  });

  it('死球は打者を1塁へ進める', () => {
    const s = rebuildGameStateFromPitches([pitch('死球')]);
    expect(s.runners.first).toBe(true);
  });

  it('振り逃げは出塁扱いになる', () => {
    const s = rebuildGameStateFromPitches([pitch('振り逃げ')]);
    expect(s.runners.first).toBe(true);
    expect(s.outs).toBe(0);
  });

  it('牽制球はカウントにも盤面にも影響しない', () => {
    const s = rebuildGameStateFromPitches([pitch('ボール'), pitch('牽制'), pitch('牽制')]);
    expect(s.balls).toBe(1);
    expect(s.outs).toBe(0);
  });

  it('走者イベントを混ぜても順に反映される', () => {
    const s = rebuildGameStateFromPitches([
      pitch('中前安打'),
      pitch('1塁走者 盗塁で2塁へ', { isEvent: true, batter: 2 }),
    ]);
    expect(s.runners).toEqual(bases(false, true, false));
  });

  it('打者が変わるとカウントをリセットする(打順修正への追従)', () => {
    const s = rebuildGameStateFromPitches([
      pitch('ボール', { batter: 1 }),
      pitch('ボール', { batter: 1 }),
      pitch('ストライク', { batter: 2 }),
    ]);
    expect(s.balls).toBe(0);
    expect(s.strikes).toBe(1);
  });

  it('3アウトで回が進み、得点が正しい回に入る', () => {
    const s = rebuildGameStateFromPitches([
      pitch('ソロ本塁打'),
      pitch('ショートゴロ', { batter: 2 }),
      pitch('ショートゴロ', { batter: 3 }),
      pitch('ショートゴロ', { batter: 4 }),
    ]);
    expect(runsIn(s, 1)).toBe(1);
    expect(s.isTop).toBe(false);
    expect(s.outs).toBe(0);
  });

  it('併殺打で2アウト増える', () => {
    const s = rebuildGameStateFromPitches([pitch('中前安打'), pitch('併殺打', { batter: 2 })]);
    expect(s.outs).toBe(2);
  });
});

describe('makeInitialLineups', () => {
  it('打順9人と控/投の10枠を作る', () => {
    const l = makeInitialLineups();
    expect(l.top).toHaveLength(10);
    expect(l.bottom).toHaveLength(10);
    expect(l.top[8].order).toBe(9);
    expect(l.top[9].order).toBe('投');
    expect(l.top[9].pos).toBe('投');
  });
});
