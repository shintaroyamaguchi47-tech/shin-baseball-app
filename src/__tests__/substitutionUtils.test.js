import { describe, it, expect } from 'vitest';
import {
  buildSubstitutionEventText,
  findSlotPlayerAt,
  findPitcherAt,
  lineupSnapshotAt,
  insertSubstitution,
  applySubstitutionToLineup,
} from '../substitutionUtils.js';

// 先攻(top)の1番・2番が打ち、後攻(bottom)が守っている想定の記録
const pitch = (over) => ({
  inning: 1, isTop: true, batter: 1, isEvent: false, pitchNumber: 1, result: 'ボール',
  batterName: 'A1', batterBats: '右', batterThrows: '右', batterPos: '中',
  pitcherName: 'P1', pitcherThrows: '右',
  runners: { first: false, second: false, third: false }, outs: 0,
  ...over,
});

const lineupOf = (names) => names.map((name, i) => ({ order: i + 1, name, pos: '未', throws: '右', bats: '右' }));

describe('buildSubstitutionEventText', () => {
  it('試合中の交代と同じ形式のテキストを組み立てる', () => {
    const text = buildSubstitutionEventText({ order: 3, oldPos: '遊', oldName: 'A3', newPos: '打', newName: 'B3', type: '代打' });
    expect(text).toBe('選手交代: [退]3番/遊 A3 ➡️ [入]打 B3 (代打)');
  });

  it('控え(10番)は「控/投」と表記する', () => {
    const text = buildSubstitutionEventText({ order: 10, oldPos: '投', oldName: 'P1', newPos: '投', newName: 'P2', type: '投手' });
    expect(text).toContain('[退]控/投/投 P1');
  });

  it('ポジション移動を伴う場合は移動先を併記する', () => {
    const text = buildSubstitutionEventText({
      order: 5, oldPos: '左', oldName: 'A5', newPos: '遊', newName: 'B5', type: '守備',
      shift: { order: 6, name: 'A6', toPos: '左' },
    });
    expect(text).toBe('選手交代: [退]5番/左 A5 ➡️ [入]遊 B5 (守備) / [移]A6 遊→左');
  });
});

describe('findSlotPlayerAt', () => {
  const records = [
    pitch({ batter: 1, batterName: 'A1' }),
    pitch({ batter: 2, batterName: 'A2', batterPos: '二' }),
    pitch({ inning: 3, batter: 2, batterName: 'B2', batterPos: '打' }),
  ];

  it('挿入位置より前の記録からその時点の選手を求める', () => {
    expect(findSlotPlayerAt(records, 2, 'top', 2).name).toBe('A2');
    expect(findSlotPlayerAt(records, 2, 'top', 2).pos).toBe('二');
  });

  it('前に記録がない場合は後ろの記録から補完する', () => {
    expect(findSlotPlayerAt(records, 0, 'top', 2).name).toBe('A2');
  });

  it('記録が全く無いスロットは現在のオーダーで補完する', () => {
    const fallback = { name: 'A9', pos: '右', bats: '左', throws: '左' };
    expect(findSlotPlayerAt(records, 3, 'top', 9, fallback)).toEqual({ name: 'A9', pos: '右', bats: '左', throws: '左' });
  });

  it('相手チーム(表裏違い)の記録は参照しない', () => {
    const mixed = [pitch({ isTop: false, batter: 1, batterName: 'H1' })];
    expect(findSlotPlayerAt(mixed, 1, 'top', 1)).toBeNull();
  });
});

describe('findPitcherAt', () => {
  const records = [
    pitch({ isTop: true, pitcherName: 'P1', pitcherThrows: '右' }),
    pitch({ isTop: true, inning: 5, pitcherName: 'P2', pitcherThrows: '左' }),
  ];

  it('守備側チームの投手を、相手の打席記録から求める', () => {
    expect(findPitcherAt(records, 1, 'bottom')).toEqual({ name: 'P1', throws: '右' });
    expect(findPitcherAt(records, 2, 'bottom')).toEqual({ name: 'P2', throws: '左' });
  });

  it('攻撃側チームを指定した場合は自分の投球記録を参照しない', () => {
    expect(findPitcherAt(records, 2, 'top')).toBeNull();
  });
});

describe('lineupSnapshotAt', () => {
  it('その時点のオーダーを記録から復元し、記録が無いスロットは現在の値を残す', () => {
    const records = [
      pitch({ batter: 1, batterName: 'A1', batterPos: '中' }),
      pitch({ inning: 4, batter: 1, batterName: 'B1', batterPos: '打' }),
    ];
    const snapshot = lineupSnapshotAt(records, 1, lineupOf(['B1', 'A2', 'A3']), 'top');
    expect(snapshot[0].name).toBe('A1');
    expect(snapshot[0].pos).toBe('中');
    expect(snapshot[0].order).toBe(1);
    expect(snapshot[1].name).toBe('A2');
  });
});

describe('insertSubstitution', () => {
  // 3回表に代打を出し忘れた想定: 3番の打席が1回・3回・5回にある
  const records = [
    pitch({ inning: 1, batter: 3, batterName: 'A3', batterPos: '遊', result: '空振り' }),
    pitch({ inning: 3, batter: 3, batterName: 'A3', batterPos: '遊', result: 'ボール' }),
    pitch({ inning: 3, batter: 3, batterName: 'A3', batterPos: '遊', pitchNumber: 2, result: '中前安打' }),
    pitch({ inning: 5, batter: 3, batterName: 'A3', batterPos: '遊', result: '三振' }),
  ];
  const params = {
    side: 'top', type: '代打', order: 3,
    oldPlayer: { name: 'A3', pos: '遊' },
    newPlayer: { name: 'B3', pos: '打', bats: '左', throws: '左' },
  };

  it('指定位置の直前に交代イベントを挿入する', () => {
    const r = insertSubstitution(records, 1, params);
    expect(r.records).toHaveLength(5);
    expect(r.records[1].isEvent).toBe(true);
    expect(r.records[1].result).toBe('選手交代: [退]3番/遊 A3 ➡️ [入]打 B3 (代打)');
    expect(r.records[1].inning).toBe(3);
    expect(r.records[1].isTop).toBe(true);
  });

  it('挿入位置以降の同じ打順の記録を新しい選手に書き換える', () => {
    const r = insertSubstitution(records, 1, params);
    expect(r.records.map((p) => p.batterName)).toEqual(['A3', 'B3', 'B3', 'B3', 'B3']);
    expect(r.battingUpdated).toBe(3);
    expect(r.records[2].batterBats).toBe('左');
    expect(r.records[2].batterPos).toBe('打');
  });

  it('挿入位置より前の記録は元の選手のまま残す', () => {
    const r = insertSubstitution(records, 1, params);
    expect(r.records[0].batterName).toBe('A3');
    expect(r.records[0].batterBats).toBe('右');
  });

  it('あとで別の交代が記録済みの場合、その交代以降は書き換えない', () => {
    const withLater = [
      pitch({ inning: 3, batter: 3, batterName: 'A3' }),
      pitch({ inning: 5, batter: 3, batterName: 'A3' }),
      pitch({ inning: 7, batter: 3, batterName: 'C3' }),
    ];
    const r = insertSubstitution(withLater, 0, params);
    // 先頭のイベントは交代直後の打者(=新しい選手)を持つ
    expect(r.records.map((p) => p.batterName)).toEqual(['B3', 'B3', 'B3', 'C3']);
    expect(r.records[0].isEvent).toBe(true);
    expect(r.battingUpdated).toBe(2);
  });

  it('元の配列を変更しない', () => {
    const before = JSON.parse(JSON.stringify(records));
    insertSubstitution(records, 1, params);
    expect(records).toEqual(before);
  });

  it('投手交代では相手の打席記録の投手名を書き換える', () => {
    const pitcherRecords = [
      pitch({ isTop: true, inning: 1, batter: 1, batterName: 'A1', pitcherName: 'P1' }),
      pitch({ isTop: true, inning: 4, batter: 2, batterName: 'A2', pitcherName: 'P1' }),
      pitch({ isTop: false, inning: 4, batter: 1, batterName: 'H1', pitcherName: 'Q1' }),
    ];
    const r = insertSubstitution(pitcherRecords, 1, {
      side: 'bottom', type: '投手', order: 9,
      oldPlayer: { name: 'P1', pos: '投' },
      newPlayer: { name: 'P2', pos: '投', bats: '右', throws: '左' },
      oldPitcherName: 'P1',
    });
    expect(r.pitchingUpdated).toBe(1);
    expect(r.records.map((p) => p.pitcherName)).toEqual(['P1', 'P2', 'P2', 'Q1']);
    expect(r.records[2].pitcherThrows).toBe('左');
    // 自チームが打っている記録の投手名(相手投手)は変えない
    expect(r.records[3].pitcherName).toBe('Q1');
  });

  it('守備の玉突き移動では移動した選手のポジションも書き換える', () => {
    const shiftRecords = [
      pitch({ inning: 4, batter: 5, batterName: 'A5', batterPos: '左' }),
      pitch({ inning: 4, batter: 6, batterName: 'A6', batterPos: '遊' }),
    ];
    const r = insertSubstitution(shiftRecords, 0, {
      side: 'top', type: '守備', order: 5,
      oldPlayer: { name: 'A5', pos: '左' },
      newPlayer: { name: 'B5', pos: '遊', bats: '右', throws: '右' },
      shift: { order: 6, name: 'A6', toPos: '左' },
    });
    expect(r.records[0].result).toContain('/ [移]A6 遊→左');
    expect(r.records[2].batterPos).toBe('左');
  });

  it('記録の末尾(index=長さ)に挿入できる', () => {
    const r = insertSubstitution(records, records.length, params);
    expect(r.records).toHaveLength(5);
    expect(r.records[4].isEvent).toBe(true);
    expect(r.records[4].inning).toBe(5);
    expect(r.battingUpdated).toBe(0);
  });
});

describe('applySubstitutionToLineup', () => {
  const params = {
    order: 3,
    oldPlayer: { name: 'A3', pos: '遊' },
    newPlayer: { name: 'B3', pos: '打', bats: '左', throws: '左' },
  };

  it('現在のオーダーに退いた選手が残っていれば差し替える', () => {
    const { lineup, applied } = applySubstitutionToLineup(lineupOf(['A1', 'A2', 'A3']), params);
    expect(applied).toBe(true);
    expect(lineup[2]).toMatchObject({ order: 3, name: 'B3', pos: '打', bats: '左', throws: '左' });
  });

  it('あとで別の交代が済んでいる場合は現在のオーダーを変えない', () => {
    const current = lineupOf(['A1', 'A2', 'C3']);
    const { lineup, applied } = applySubstitutionToLineup(current, params);
    expect(applied).toBe(false);
    expect(lineup).toBe(current);
  });

  it('ポジション移動も現在のオーダーへ反映する', () => {
    const { lineup } = applySubstitutionToLineup(lineupOf(['A1', 'A2', 'A3', 'A4']), {
      ...params,
      newPlayer: { name: 'B3', pos: '遊', bats: '右', throws: '右' },
      shift: { order: 4, name: 'A4', toPos: '三' },
    });
    expect(lineup[3].pos).toBe('三');
  });
});
