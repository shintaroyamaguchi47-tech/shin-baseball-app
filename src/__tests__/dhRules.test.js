import { describe, it, expect } from 'vitest';
import {
  getDhState,
  validateDhLineup,
  resolveDhCancellation,
  cancelDh,
  clearPitcherSlot,
  vacantFieldPositions,
  DH_POS,
  DH_CANCEL_TYPE,
  PITCHER_SLOT_INDEX,
} from '../dhRules.js';

const slot = (order, name, pos) => ({ order, name, pos, throws: '右', bats: '右' });

// 指名打者制のオーダー: 打順1〜9(3番が指名打者)＋「控/投」に投手
const dhLineup = () => [
  slot(1, '1番', '中'),
  slot(2, '2番', '遊'),
  slot(3, '指名打者', DH_POS),
  slot(4, '4番', '一'),
  slot(5, '5番', '左'),
  slot(6, '6番', '三'),
  slot(7, '7番', '右'),
  slot(8, '8番', '二'),
  slot(9, '9番', '捕'),
  slot('投', '先発P', '投'),
];

// 投手が打席に立つ通常のオーダー
const noDhLineup = () => {
  const l = dhLineup();
  l[2] = slot(3, '3番', '投');
  l[PITCHER_SLOT_INDEX] = slot('投', '', '控');
  return l;
};

describe('getDhState', () => {
  it('打順に「指」がいて投手が打順にいなければ指名打者制と判定する', () => {
    const s = getDhState(dhLineup());
    expect(s.active).toBe(true);
    expect(s.dhOrder).toBe(3);
    expect(s.dh.name).toBe('指名打者');
    expect(s.pitcherOrder).toBe(10);
    expect(s.pitcher.name).toBe('先発P');
    expect(s.pitcherBats).toBe(false);
  });

  it('投手が打順に入っていれば指名打者制ではない', () => {
    const s = getDhState(noDhLineup());
    expect(s.active).toBe(false);
    expect(s.pitcherBats).toBe(true);
    expect(s.pitcherOrder).toBe(3);
  });

  it('「指」も投手もいないオーダーでも落ちない', () => {
    expect(getDhState([]).active).toBe(false);
    expect(getDhState(null).pitcherIndex).toBe(-1);
  });
});

describe('validateDhLineup', () => {
  it('正しい指名打者制のオーダーには警告を出さない', () => {
    expect(validateDhLineup(dhLineup())).toEqual([]);
  });

  it('「控/投」に投手がいない指名打者制を警告する', () => {
    const l = dhLineup();
    l[PITCHER_SLOT_INDEX] = slot('投', '', '控');
    expect(validateDhLineup(l).join()).toContain('「控/投」に投手を入れてください');
  });

  it('指名打者が複数いる場合を警告する', () => {
    const l = dhLineup();
    l[4] = slot(5, '5番', DH_POS);
    expect(validateDhLineup(l).join()).toContain('指名打者は1人だけです');
  });

  it('投手が打順に入ったまま「指」が残っている場合を警告する', () => {
    const l = dhLineup();
    l[4] = slot(5, '5番', '投');
    expect(validateDhLineup(l).join()).toContain('解除された状態');
  });
});

describe('vacantFieldPositions', () => {
  it('誰も守っていない守備位置を返す', () => {
    expect(vacantFieldPositions(dhLineup())).toEqual([]);
    const l = dhLineup();
    l[4] = slot(5, '5番', '投'); // 左翼手が投手になり、左が空く
    expect(vacantFieldPositions(l)).toEqual(['左']);
  });
});

describe('resolveDhCancellation', () => {
  it('出場中の野手が投手になり元投手が守備に回ると、元投手が指名打者の打順に入る', () => {
    const before = dhLineup();
    // 5番の左翼手が投手へ。玉突きで元投手(控/投)が左翼へ回る
    const after = before.map((p) => ({ ...p }));
    after[4] = { ...after[4], pos: '投' };
    after[PITCHER_SLOT_INDEX] = { ...after[PITCHER_SLOT_INDEX], pos: '左' };

    const res = resolveDhCancellation(before, after);
    expect(res).not.toBeNull();
    // 指名打者の打順(3番)に元投手が入り、指名打者は退く
    expect(res.order).toBe(3);
    expect(res.lineup[2].name).toBe('先発P');
    expect(res.lineup[2].pos).toBe('左');
    expect(res.incoming.name).toBe('先発P');
    expect(res.retired.name).toBe('指名打者');
    // 「控/投」は空になる
    expect(res.lineup[PITCHER_SLOT_INDEX].name).toBe('');
    expect(res.eventText).toContain(DH_CANCEL_TYPE);
    expect(res.eventText).toContain('先発P');
    // 解除後は投手が打順に入っている状態になる
    expect(getDhState(res.lineup).active).toBe(false);
    expect(getDhState(res.lineup).pitcherOrder).toBe(5);
  });

  it('元投手が試合から退いた場合は指名打者が空いた守備位置に就く', () => {
    const before = dhLineup();
    const after = before.map((p) => ({ ...p }));
    after[4] = { ...after[4], pos: '投' };            // 左翼手が投手へ
    after[PITCHER_SLOT_INDEX] = slot('投', '', '控'); // 元投手はベンチへ

    const res = resolveDhCancellation(before, after);
    expect(res).not.toBeNull();
    expect(res.lineup[2].name).toBe('指名打者');
    expect(res.lineup[2].pos).toBe('左');
    expect(res.positionOnly).toBe(true);
    expect(res.eventText).toContain('[移]');
    expect(getDhState(res.lineup).active).toBe(false);
  });

  it('投手が打順に入らない交代では解除しない', () => {
    const before = dhLineup();
    const after = before.map((p) => ({ ...p }));
    after[PITCHER_SLOT_INDEX] = slot('投', '継投P', '投'); // 投手交代だけ
    expect(resolveDhCancellation(before, after)).toBeNull();
  });

  it('もともと指名打者制でなければ何もしない', () => {
    const before = noDhLineup();
    const after = before.map((p) => ({ ...p }));
    after[4] = { ...after[4], pos: '投' };
    expect(resolveDhCancellation(before, after)).toBeNull();
  });
});

describe('cancelDh', () => {
  it('既定では指名打者の打順に投手が入る', () => {
    const res = cancelDh(dhLineup());
    expect(res.order).toBe(3);
    expect(res.lineup[2].name).toBe('先発P');
    expect(res.lineup[2].pos).toBe('投');
    expect(res.lineup[PITCHER_SLOT_INDEX].name).toBe('');
    expect(res.retired.name).toBe('指名打者');
    expect(getDhState(res.lineup).active).toBe(false);
  });

  it('打順と守備位置を指定して解除できる', () => {
    const res = cancelDh(dhLineup(), { order: 7, pos: '右' });
    expect(res.order).toBe(7);
    expect(res.lineup[6].name).toBe('先発P');
    expect(res.lineup[6].pos).toBe('右');
  });

  it('指名打者制でなければ null を返す', () => {
    expect(cancelDh(noDhLineup())).toBeNull();
  });
});

describe('clearPitcherSlot', () => {
  it('「控/投」を空にする', () => {
    const l = clearPitcherSlot(dhLineup());
    expect(l[PITCHER_SLOT_INDEX].name).toBe('');
    expect(l[PITCHER_SLOT_INDEX].pos).toBe('控');
    expect(l[0].name).toBe('1番'); // 他の打順は触らない
  });
});
