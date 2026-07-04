import { describe, it, expect } from 'vitest';
import { renumberPitchNumbers, reassignPitchBatter } from '../gameUtils.js';

const pitch = (over) => ({ inning: 1, isTop: true, batter: 1, isEvent: false, pitchNumber: 0, result: 'ボール', batterName: '先攻1番', batterBats: '右', batterThrows: '右', batterPos: '未', ...over });

describe('renumberPitchNumbers', () => {
  it('打席(回・表裏・打順)ごとに記録順の連番を振り直す', () => {
    const records = [
      pitch({ batter: 1, pitchNumber: 9 }),
      pitch({ batter: 1, pitchNumber: 9 }),
      pitch({ batter: 2, pitchNumber: 9 }),
      pitch({ inning: 2, isTop: false, batter: 1, pitchNumber: 9 }),
    ];
    const r = renumberPitchNumbers(records);
    expect(r.map((p) => p.pitchNumber)).toEqual([1, 2, 1, 1]);
  });

  it('球数に数えないイベント記録は変更しない', () => {
    const records = [
      pitch({ pitchNumber: 1 }),
      pitch({ isEvent: true, pitchNumber: '-', result: '1塁走者 盗塁で2塁へ' }),
      pitch({ pitchNumber: 5 }),
    ];
    const r = renumberPitchNumbers(records);
    expect(r[1].pitchNumber).toBe('-');
    expect(r.map((p) => p.pitchNumber)).toEqual([1, '-', 2]);
  });

  it('球数に数えるイベント(ボーク投球)は連番に含める', () => {
    const records = [
      pitch({ pitchNumber: 1 }),
      pitch({ isEvent: true, countAsPitch: true, pitchNumber: '-', result: '1塁走者 ボークで2塁へ' }),
      pitch({ pitchNumber: 2 }),
    ];
    const r = renumberPitchNumbers(records);
    expect(r.map((p) => p.pitchNumber)).toEqual([1, 2, 3]);
  });

  it('変更が無い記録は同一オブジェクトを保つ(イミュータブル最適化)', () => {
    const records = [pitch({ pitchNumber: 1 }), pitch({ pitchNumber: 2 })];
    const r = renumberPitchNumbers(records);
    expect(r[0]).toBe(records[0]);
    expect(r[1]).toBe(records[1]);
  });
});

describe('reassignPitchBatter', () => {
  const yamada = { name: '山田', bats: '左', throws: '右', pos: '遊' };

  it('1球だけを別の打順に付け替え、球数を振り直す', () => {
    const records = [
      pitch({ pitchNumber: 1 }),
      pitch({ pitchNumber: 2, result: 'ストライク' }),
    ];
    const r = reassignPitchBatter(records, 1, 2, yamada, false);
    expect(r[1].batter).toBe(2);
    expect(r[1].batterName).toBe('山田');
    expect(r[1].batterBats).toBe('左');
    expect(r[1].pitchNumber).toBe(1); // 2番打者としては1球目
    expect(r[0].batter).toBe(1);
    expect(r[0].pitchNumber).toBe(1);
  });

  it('applyToAtBat=true で同じ打席の記録(イベント含む)をまとめて付け替える', () => {
    const records = [
      pitch({ pitchNumber: 1 }),
      pitch({ isEvent: true, pitchNumber: '-', result: '1塁走者 盗塁で2塁へ' }),
      pitch({ pitchNumber: 2, result: 'ストライク' }),
      pitch({ batter: 3, pitchNumber: 1 }), // 別の打席は対象外
    ];
    const r = reassignPitchBatter(records, 0, 2, yamada, true);
    expect(r[0].batter).toBe(2);
    expect(r[1].batter).toBe(2); // イベントも移動
    expect(r[2].batter).toBe(2);
    expect(r[3].batter).toBe(3);
    expect(r.map((p) => p.pitchNumber)).toEqual([1, '-', 2, 1]);
  });

  it('別の回・表裏の同じ打順は巻き込まない', () => {
    const records = [
      pitch({ pitchNumber: 1 }),
      pitch({ inning: 2, pitchNumber: 1 }),
      pitch({ isTop: false, pitchNumber: 1 }),
    ];
    const r = reassignPitchBatter(records, 0, 5, yamada, true);
    expect(r[0].batter).toBe(5);
    expect(r[1].batter).toBe(1);
    expect(r[2].batter).toBe(1);
  });

  it('範囲外のインデックスでは元の配列を返す', () => {
    const records = [pitch({ pitchNumber: 1 })];
    expect(reassignPitchBatter(records, 9, 2, yamada, true)).toBe(records);
  });
});
