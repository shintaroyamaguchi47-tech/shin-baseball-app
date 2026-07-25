import { describe, it, expect } from 'vitest';
import { autoPositions, buildAdvanceChoices, buildAdvanceEvents, previewAdvanceResult, isAdjustableEventType, describeRunners } from '../runnerAdvance.js';

const bases = (...on) => ({ first: on.includes(1), second: on.includes(2), third: on.includes(3) });

describe('autoPositions', () => {
  it('単打は全走者を1つずつ進め、3塁走者は生還する', () => {
    expect(autoPositions(bases(2), 'single')).toEqual({ second: 3, batter: 1 });
    expect(autoPositions(bases(3), 'single')).toEqual({ third: 4, batter: 1 });
    expect(autoPositions(bases(1, 2, 3), 'single')).toEqual({ third: 4, second: 3, first: 2, batter: 1 });
  });

  it('二塁打・三塁打・本塁打の自動進塁がアプリの既存ルールと一致する', () => {
    expect(autoPositions(bases(1), 'double')).toEqual({ first: 3, batter: 2 });
    expect(autoPositions(bases(1, 2), 'triple')).toEqual({ second: 4, first: 4, batter: 3 });
    expect(autoPositions(bases(1), 'homerun')).toEqual({ first: 4, batter: 4 });
  });

  it('四球は押し出しのときだけ走者が動く', () => {
    expect(autoPositions(bases(1), 'walk')).toEqual({ first: 2, batter: 1 });
    expect(autoPositions(bases(2), 'walk')).toEqual({ second: 2, batter: 1 });
    expect(autoPositions(bases(1, 2, 3), 'walk')).toEqual({ third: 4, second: 3, first: 2, batter: 1 });
  });

  it('犠打・犠飛・アウトは打者が塁に残らない', () => {
    expect(autoPositions(bases(1), 'sac_bunt')).toEqual({ first: 2 });
    expect(autoPositions(bases(3), 'sac_fly')).toEqual({ third: 4 });
    expect(autoPositions(bases(2), 'out')).toEqual({ second: 2 });
  });
});

describe('buildAdvanceChoices', () => {
  it('1死2塁の単打では2塁走者に3塁/生還/本塁アウト、打者走者に1〜3塁/アウトを出す', () => {
    const rows = buildAdvanceChoices(bases(2), 'single', 1);
    expect(rows.map((r) => r.id)).toEqual(['second', 'batter']);
    expect(rows[0].choices.map((c) => c.value)).toEqual([3, 4, 'out']);
    expect(rows[1].autoPos).toBe(1);
    expect(rows[1].choices.map((c) => c.value)).toEqual([1, 2, 3, 4, 'out']);
  });

  it('自動進塁より手前の塁は選べない', () => {
    const rows = buildAdvanceChoices(bases(1), 'double', 0);
    const first = rows.find((r) => r.id === 'first');
    expect(first.choices.map((c) => c.value)).toEqual([3, 4, 'out']);
  });

  it('2アウトでは、自動進塁で生還する走者のアウトを選択肢から外す(打席結果より前に3アウトが成立してしまうため)', () => {
    const rows = buildAdvanceChoices(bases(3), 'single', 2);
    const third = rows.find((r) => r.id === 'third');
    expect(third.choices.map((c) => c.value)).toEqual([4]);
    // 打者走者はアウトを選べる(打席結果より後のイベントとして記録できる)
    const batter = rows.find((r) => r.id === 'batter');
    expect(batter.choices).toContainEqual({ value: 'out', label: 'アウト' });
  });
});

describe('buildAdvanceEvents', () => {
  it('自動進塁のままなら記録を追加しない', () => {
    const plan = autoPositions(bases(2), 'single');
    expect(buildAdvanceEvents(bases(2), 'single', plan)).toEqual({ pre: [], post: [] });
  });

  it('1死2塁の単打で2塁走者が生還 → 「3塁走者 打球で本塁へ」を追加する', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 4 };
    expect(buildAdvanceEvents(bases(2), 'single', plan)).toEqual({ pre: [], post: ['3塁走者 打球で本塁へ'] });
  });

  it('送球間に打者走者が進んだら「1塁走者 送球間で2塁へ」を追加する', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 4, batter: 2 };
    const { pre, post } = buildAdvanceEvents(bases(2), 'single', plan);
    expect(pre).toEqual([]);
    // 前の走者から先に処理しないと塁が埋まったままになる
    expect(post).toEqual(['3塁走者 打球で本塁へ', '1塁走者 送球間で2塁へ']);
  });

  it('走者が本塁で憤死したら走塁死の記録を追加する', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 'out' };
    expect(buildAdvanceEvents(bases(2), 'single', plan)).toEqual({ pre: [], post: ['3塁走者が本塁憤死'] });
  });

  it('自動進塁だと生還してしまう走者のアウトは、打席結果より前の記録にする', () => {
    const plan = { ...autoPositions(bases(3), 'single'), third: 'out' };
    expect(buildAdvanceEvents(bases(3), 'single', plan)).toEqual({ pre: ['3塁走者が本塁憤死'], post: [] });
  });

  it('複数走者の進塁は前の走者(上位の塁)から順に記録する', () => {
    const plan = { third: 4, second: 4, first: 3, batter: 2 };
    const { post } = buildAdvanceEvents(bases(1, 2, 3), 'single', plan);
    expect(post).toEqual(['3塁走者 打球で本塁へ', '2塁走者 打球で3塁へ', '1塁走者 送球間で2塁へ']);
  });
});

describe('previewAdvanceResult', () => {
  it('1死2塁の単打(自動)は1死1・3塁', () => {
    const r = previewAdvanceResult(bases(2), 'single', autoPositions(bases(2), 'single'), 1);
    expect(r).toEqual({ runners: bases(1, 3), runs: 0, outs: 1 });
  });

  it('2塁走者が生還すれば1死1塁で1点', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 4 };
    const r = previewAdvanceResult(bases(2), 'single', plan, 1);
    expect(r).toEqual({ runners: bases(1), runs: 1, outs: 1 });
  });

  it('2塁走者が生還し送球間に打者走者が進めば1死2塁で1点', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 4, batter: 2 };
    const r = previewAdvanceResult(bases(2), 'single', plan, 1);
    expect(r).toEqual({ runners: bases(2), runs: 1, outs: 1 });
  });

  it('2塁走者が本塁で憤死すれば2死1塁', () => {
    const plan = { ...autoPositions(bases(2), 'single'), second: 'out' };
    const r = previewAdvanceResult(bases(2), 'single', plan, 1);
    expect(r).toEqual({ runners: bases(1), runs: 0, outs: 2 });
  });
});

describe('補助関数', () => {
  it('確認シートを出すのは打者が出塁する打席結果だけ', () => {
    expect(isAdjustableEventType('single')).toBe(true);
    expect(isAdjustableEventType('error')).toBe(true);
    expect(isAdjustableEventType('homerun')).toBe(false);
    expect(isAdjustableEventType('out')).toBe(false);
    expect(isAdjustableEventType('walk')).toBe(false);
  });

  it('塁状況を日本語で表す', () => {
    expect(describeRunners(bases())).toBe('走者なし');
    expect(describeRunners(bases(2))).toBe('2塁');
    expect(describeRunners(bases(1, 3))).toBe('1・3塁');
    expect(describeRunners(bases(1, 2, 3))).toBe('満塁');
  });
});
