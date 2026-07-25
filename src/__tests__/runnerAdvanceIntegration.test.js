// 進塁補正(runnerAdvance.js)が生成する走者イベント記録が、
// 速報(playByPlay.js)とスコアブック(scorebookData.js)で正しく解釈されることを確認する。
// この3者は同じ文字列表現を共有しているため、表現がずれると記録全体が壊れる。
import { describe, it, expect } from 'vitest';
import { buildPlayByPlayReport } from '../playByPlay.js';
import { buildScorebookData } from '../scorebookData.js';
import { autoPositions, buildAdvanceEvents } from '../runnerAdvance.js';

const lineup = (prefix) => Array.from({ length: 10 }, (_, i) => ({
  order: i < 9 ? i + 1 : '投', name: `${prefix}${i + 1}`, pos: i === 9 ? '投' : String(i + 1), throws: '右', bats: '右',
}));
const lineups = { top: lineup('攻'), bottom: lineup('守') };
const gameInfo = { date: '2026-07-25', gameType: '練習試合', teamTop: '攻チーム', teamBottom: '守チーム' };

const pitch = (batter, result, outs, runners) => ({
  course: 4, type: 'ストレート', result, inning: 1, isTop: true, batter, pitchNumber: 1,
  pitcherName: '守10', pitcherThrows: '右', batterName: `攻${batter}`, batterBats: '右', batterThrows: '右',
  batterPos: String(batter), isEvent: false, outs, runners, hitX: 120, hitY: 60,
});
const event = (batter, result, outs, runners) => ({
  course: null, type: '-', result, inning: 1, isTop: true, batter, pitchNumber: '-',
  pitcherName: '守10', pitcherThrows: '右', batterName: `攻${batter}`, batterBats: '右',
  isEvent: true, outs, runners,
});

const NONE = { first: false, second: false, third: false };
const ON_SECOND = { first: false, second: true, third: false };

// 1回表: 1番=投ゴロ(1死) → 2番=左二塁打(2塁) → 3番=中安
// 3番の打席に、進塁補正で生成した走者イベントを続けて記録する。
const buildPitches = (corrections) => [
  pitch(1, 'ピッチャーゴロ', 0, NONE),
  pitch(2, 'レフト二塁打', 1, NONE),
  pitch(3, 'センター安', 1, ON_SECOND),
  ...corrections.map((text) => event(3, text, 1, ON_SECOND)),
];

const finalBases = (pitches) => {
  // 速報データから半イニング終了時の塁状況を読み取れないため、
  // スコアブックの basesReachedFinal(各打者が最後に到達した塁)で確認する
  const sb = buildScorebookData(pitches, lineups, gameInfo, { inning: 1, runs: { top: [], bottom: [] } });
  const cellOf = (slot) => sb.top.slots[slot - 1].cellsByInning[1][0];
  return { sb, cellOf };
};

describe('進塁補正イベントの解釈(1死2塁でのシングルヒット)', () => {
  it('補正なし: 自動進塁どおり1死1・3塁になる', () => {
    const { cellOf } = finalBases(buildPitches([]));
    expect(cellOf(2).basesReachedFinal).toBe(3);
    expect(cellOf(2).scored).toBe(false);
    expect(cellOf(3).basesReachedFinal).toBe(1);
    expect(cellOf(3).rbi).toBe(0);
  });

  it('2塁走者が生還: 打者に打点1がつき、走者は生還扱いになる', () => {
    const plan = { ...autoPositions(ON_SECOND, 'single'), second: 4 };
    const { post } = buildAdvanceEvents(ON_SECOND, 'single', plan);
    const { cellOf } = finalBases(buildPitches(post));
    expect(cellOf(2).scored).toBe(true);
    expect(cellOf(2).scoredUnearned).toBe(false); // 打球による生還は自責点
    expect(cellOf(3).basesReachedFinal).toBe(1);
    expect(cellOf(3).rbi).toBe(1);
  });

  it('2塁走者が生還し、送球間に打者走者が2塁へ進む', () => {
    const plan = { ...autoPositions(ON_SECOND, 'single'), second: 4, batter: 2 };
    const { post } = buildAdvanceEvents(ON_SECOND, 'single', plan);
    const { sb, cellOf } = finalBases(buildPitches(post));
    expect(cellOf(2).scored).toBe(true);
    expect(cellOf(3).basesReachedFinal).toBe(2);
    expect(cellOf(3).rbi).toBe(1);
    expect(sb.top.inningSummary[0].LOB).toBe(1); // 残塁は打者走者の1人だけ
  });

  it('2塁走者が本塁で憤死: 走者アウトとして数え、打者は1塁に残る', () => {
    const plan = { ...autoPositions(ON_SECOND, 'single'), second: 'out' };
    const { post } = buildAdvanceEvents(ON_SECOND, 'single', plan);
    const { cellOf } = finalBases(buildPitches(post));
    expect(cellOf(2).scored).toBe(false);
    expect(cellOf(2).outOnBasesReason).toBe('本塁憤死');
    expect(cellOf(2).outOnBasesOrderInInning).toBe(2); // 1番の投ゴロに続く2つ目のアウト
    expect(cellOf(3).basesReachedFinal).toBe(1);
    expect(cellOf(3).rbi).toBe(0);
  });

  it('速報の実況にも進塁と生還が並ぶ', () => {
    const plan = { ...autoPositions(ON_SECOND, 'single'), second: 4, batter: 2 };
    const { post } = buildAdvanceEvents(ON_SECOND, 'single', plan);
    const report = buildPlayByPlayReport(buildPitches(post));
    const play = report[0].plays.find((p) => p.batter === 3);
    expect(play.narrative.join('\n')).toContain('攻2、打球で生還。');
    expect(play.narrative.join('\n')).toContain('攻3、送球間で二塁へ進塁。');
  });
});
