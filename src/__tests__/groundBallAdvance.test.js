import { describe, it, expect } from 'vitest';
import { makeInitialGameState, advanceGameState, rebuildGameStateFromPitches, resultToEventType } from '../gameState.js';
import { autoPositions, buildAdvanceChoices, buildAdvanceEvents, isAdjustableEventType } from '../runnerAdvance.js';
import { buildPlayByPlayReport } from '../playByPlay.js';

// ============================================================
// ゴロで打者がアウトになる打席の走者の扱い。
// 1死1塁でサードゴロを打つと、打者は一塁でアウト・1塁走者はフォースされて
// 2塁へ進む(2死2塁)。以前は走者が1塁に残ったままだった。
// ============================================================

const bases = (...on) => ({ first: on.includes(1), second: on.includes(2), third: on.includes(3) });
const state = (over = {}) => ({ ...makeInitialGameState(), ...over });

describe('ゴロの自動進塁 (advanceGameState)', () => {
  it('1死1塁のサードゴロは2死2塁になる', () => {
    const after = advanceGameState(state({ outs: 1, runners: bases(1) }), 'ground_out', 1);
    expect(after.outs).toBe(2);
    expect(after.runners).toEqual(bases(2));
  });

  it('1死1・2塁のゴロは走者が2・3塁へ進む', () => {
    const after = advanceGameState(state({ outs: 1, runners: bases(1, 2) }), 'ground_out', 1);
    expect(after.runners).toEqual(bases(2, 3));
  });

  it('満塁のゴロは3塁走者が押し出されて生還する', () => {
    const after = advanceGameState(state({ outs: 0, runners: bases(1, 2, 3) }), 'ground_out', 1);
    expect(after.outs).toBe(1);
    expect(after.runners).toEqual(bases(2, 3));
    expect(after.runs.top[0]).toBe(1);
  });

  it('フォースされていない走者(2塁のみ・3塁のみ)は動かない', () => {
    expect(advanceGameState(state({ runners: bases(2) }), 'ground_out', 1).runners).toEqual(bases(2));
    expect(advanceGameState(state({ runners: bases(3) }), 'ground_out', 1).runners).toEqual(bases(3));
  });

  it('3アウト目のゴロでは走者は動かず、押し出しの得点も入らない', () => {
    const after = advanceGameState(state({ outs: 2, runners: bases(1, 2, 3) }), 'ground_out', 1);
    expect(after.outs).toBe(0); // 攻守交代
    expect(after.runs.top[0]).toBe(0);
  });

  it('フライ(飛)や三振では走者は動かない', () => {
    expect(advanceGameState(state({ runners: bases(1) }), 'out', 1).runners).toEqual(bases(1));
  });

  it('併殺打はフォースの先頭走者が打者と一緒にアウトになる', () => {
    expect(advanceGameState(state({ outs: 0, runners: bases(1) }), 'double_play', 2).runners).toEqual(bases());
    expect(advanceGameState(state({ outs: 0, runners: bases(1, 2) }), 'double_play', 2).runners).toEqual(bases(3));
  });
});

describe('ゴロの自動進塁 (記録の再構築)', () => {
  const pitch = (batter, result, outs, runners) => ({
    inning: 1, isTop: true, batter, result, outs, runners,
    batterName: `打者${batter}`, pitcherName: '投手', course: 5, type: 'ストレート', pitchNumber: 1, isEvent: false,
  });

  it('四球 → サードゴロ で2死2塁になる', () => {
    const st = rebuildGameStateFromPitches([
      pitch(1, '死球', 0, bases()),
      pitch(2, 'ショートゴロ', 0, bases(1)),
      pitch(3, 'サードゴロ', 1, bases(1)),
    ]);
    expect(st.outs).toBe(2);
    expect(st.runners).toEqual(bases(2));
  });

  it('速報(playByPlay)でも走者が2塁まで進む', () => {
    const plays = buildPlayByPlayReport([
      pitch(1, '死球', 0, bases()),
      pitch(2, 'サードゴロ', 0, bases(1)),
      pitch(3, 'センター二塁打', 1, bases(2)),
    ])[0].plays;
    expect(plays[1].isOut).toBe(true);
    // 3人目の二塁打で、2塁まで進んでいた1人目が生還する
    expect(plays[2].narrative.some((line) => line.includes('打者1') && line.includes('生還'))).toBe(true);
  });
});

describe('進塁確認シート', () => {
  it('ゴロも確認の対象にする', () => {
    expect(isAdjustableEventType('ground_out')).toBe(true);
    expect(isAdjustableEventType('double_play')).toBe(true);
    expect(isAdjustableEventType('out')).toBe(false);
  });

  it('1死1塁のゴロは「2塁(自動)/3塁/生還/アウト」から選べる', () => {
    expect(autoPositions(bases(1), 'ground_out')).toEqual({ first: 2 });
    const rows = buildAdvanceChoices(bases(1), 'ground_out', 2);
    expect(rows.map((r) => r.id)).toEqual(['first']);
    expect(rows[0].autoPos).toBe(2);
    expect(rows[0].choices.map((c) => c.value)).toEqual([2, 3, 4, 'out']);
  });

  it('送球の間にもう1つ進んだ・走塁死した場合を走者イベントとして書き出す', () => {
    expect(buildAdvanceEvents(bases(1), 'ground_out', { first: 3 }).post).toEqual(['2塁走者 打球で3塁へ']);
    expect(buildAdvanceEvents(bases(1), 'ground_out', { first: 'out' }).post).toEqual(['2塁走者が走塁死']);
    expect(buildAdvanceEvents(bases(1), 'ground_out', { first: 2 }).post).toEqual([]);
  });

  it('併殺打で塁上から消える走者は選択肢に出さない(アウトは打席結果で数えているため)', () => {
    expect(autoPositions(bases(1), 'double_play')).toEqual({});
    expect(autoPositions(bases(1, 2), 'double_play')).toEqual({ second: 3 });
  });
});

describe('resultToEventType', () => {
  it('アプリの入力(サードゴロ)もスコアブック様式(三ゴロ)も同じ判定', () => {
    expect(resultToEventType('サードゴロ')).toBe('ground_out');
    expect(resultToEventType('三ゴロ')).toBe('ground_out');
    expect(resultToEventType('サード併殺打')).toBe('double_play');
    expect(resultToEventType('ライト飛')).toBe('out');
  });
});
