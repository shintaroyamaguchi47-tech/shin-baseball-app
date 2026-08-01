import { describe, it, expect } from 'vitest';
import { buildPlayByPlayReport, parseFieldResult, outsAddedFor } from '../playByPlay.js';
import { buildScorebookData } from '../scorebookData.js';

// 打者アウトのカウントは守備位置の表記に左右されてはいけない。
// 「ライトゴロ」(アプリの入力)も「右ゴロ」(スコアブック様式の手入力)も同じ1アウト。
describe('打者アウトのカウント', () => {
  const pitch = (batter, result) => ({
    inning: 1, isTop: true, batter, pitchNumber: 1, result,
    course: 24, type: 'ストレート', pitcherName: '投手A', pitcherThrows: '右',
    batterName: `打者${batter}`, batterBats: '右', batterPos: '投',
    isEvent: false, runners: { first: false, second: false, third: false }, outs: batter - 1,
  });

  it('外野ゴロ(ライトゴロ)を1アウトとして数える', () => {
    const play = buildPlayByPlayReport([pitch(1, 'ライトゴロ')])[0].plays[0];
    expect(play.isOut).toBe(true);
    expect(play.count.outs).toBe(1);
    expect(play.fielder).toBe('ライト');
  });

  it('漢字略記のゴロ(右ゴロ/二ゴロ)も守備位置つきの1アウトとして数える', () => {
    ['右ゴロ', '二ゴロ', '遊ゴロ', '中飛'].forEach((result) => {
      const play = buildPlayByPlayReport([pitch(1, result)])[0].plays[0];
      expect(play.count.outs, result).toBe(1);
      expect(play.fielder, result).toBeTruthy();
    });
    expect(parseFieldResult('右ゴロ')).toEqual({ fielder: 'ライト', suffix: 'ゴロ' });
    expect(parseFieldResult('二ゴロ')).toEqual({ fielder: 'セカンド', suffix: 'ゴロ' });
  });

  it('守備位置と紛らわしい結果(三振・二塁打)は打球結果として解釈しない', () => {
    expect(parseFieldResult('三振')).toBeNull();
    expect(parseFieldResult('二塁打')).toBeNull();
    expect(parseFieldResult('三塁打')).toBeNull();
  });

  it('併殺打は2アウト、犠打/犠飛は1アウト、出塁と未確定の打球は0アウト', () => {
    expect(outsAddedFor('セカンド併殺打')).toBe(2);
    expect(outsAddedFor('ライト犠飛')).toBe(1);
    expect(outsAddedFor('中犠飛')).toBe(1);
    expect(outsAddedFor('三振')).toBe(1);
    expect(outsAddedFor('ライト安')).toBe(0);
    expect(outsAddedFor('四球')).toBe(0);
    expect(outsAddedFor('ライト捕球エラー')).toBe(0);
    expect(outsAddedFor('インプレー')).toBe(0); // 打球結果が未選択の1球
    expect(outsAddedFor('ストライク')).toBe(0); // 打席途中で3アウト(中断打席)
  });

  it('スコアブックでも外野ゴロが打者アウト・投球回に反映される', () => {
    const pitches = [pitch(1, 'ライトゴロ'), pitch(2, '右ゴロ'), pitch(3, 'ショートゴロ')];
    const lineups = { top: [1, 2, 3].map((i) => ({ name: `打者${i}`, pos: '投', bats: '右', throws: '右' })), bottom: [] };
    const gameState = { inning: 1, isTop: false, runs: { top: [0], bottom: [0] }, earnedRuns: { top: [0], bottom: [0] } };
    const sb = buildScorebookData(pitches, lineups, { teamTop: 'A', teamBottom: 'B' }, gameState);
    const cells = [1, 2, 3].map((i) => sb.top.slots[i - 1].cellsByInning[1][0]);
    expect(cells.map((c) => c.isBatterOut)).toEqual([true, true, true]);
    expect(cells.map((c) => c.outOrderInInning)).toEqual([1, 2, 3]);
    expect(cells.map((c) => c.resultNotation)).toEqual(['9-3', '9-3', '6-3']);
    expect(sb.bottom.pitcherStats[0].outs).toBe(3); // 投球回 1.0
  });
});
