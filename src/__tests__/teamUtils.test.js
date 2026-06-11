import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  findDuplicateNameIndices,
  mergeRosterPlayers,
  renamePlayersInGame,
} from '../teamUtils.js';

describe('normalizeName', () => {
  it('全角・半角スペースを除去する', () => {
    expect(normalizeName(' 山田 太郎 ')).toBe('山田太郎');
    expect(normalizeName('山田　太郎')).toBe('山田太郎');
    expect(normalizeName(null)).toBe('');
  });
});

describe('findDuplicateNameIndices', () => {
  it('空白違いの表記ゆれを重複として検出する', () => {
    const players = [
      { name: '山田太郎' },
      { name: '佐藤' },
      { name: '山田 太郎' },
      { name: '' },
    ];
    const dup = findDuplicateNameIndices(players);
    expect(dup).toEqual(new Set([0, 2]));
  });

  it('旧形式(文字列)の選手も扱える', () => {
    expect(findDuplicateNameIndices(['山田', { name: '山田' }])).toEqual(new Set([0, 1]));
  });

  it('空名は重複扱いしない', () => {
    expect(findDuplicateNameIndices([{ name: '' }, { name: '' }])).toEqual(new Set());
  });
});

describe('mergeRosterPlayers', () => {
  it('残す選手以外の選択選手を名簿から削除する', () => {
    const players = [{ name: 'A' }, { name: 'B' }, { name: 'A2' }, { name: 'C' }];
    const merged = mergeRosterPlayers(players, [0, 2], 0);
    expect(merged.map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('renamePlayersInGame', () => {
  const game = {
    lineups: {
      top: [{ name: '山田 太郎', pos: '遊' }, { name: '佐藤', pos: '捕' }],
      bottom: [{ name: '田中', pos: '投' }],
    },
    pitches: [
      // 表(top打席): 打者=top側, 投手=bottom側
      { isTop: true, batterName: '山田 太郎', pitcherName: '田中', result: 'ストライク' },
      // 裏(bottom打席): 打者=bottom側, 投手=top側
      { isTop: false, batterName: '田中', pitcherName: '山田 太郎', result: 'ボール' },
      { isTop: true, batterName: '佐藤', pitcherName: '田中', result: 'ボール' },
    ],
  };

  it('top側チームの選手名を打席・投球・オーダーの全てで改名する', () => {
    const r = renamePlayersInGame(game, 'top', ['山田 太郎'], '山田太郎');
    expect(r.lineups.top[0].name).toBe('山田太郎');
    expect(r.pitches[0].batterName).toBe('山田太郎'); // top打席の打者
    expect(r.pitches[1].pitcherName).toBe('山田太郎'); // bottom打席の投手(=top側)
    expect(r.changed).toBe(3);
  });

  it('反対側チームの同名選手には影響しない', () => {
    const r = renamePlayersInGame(game, 'top', ['田中'], '田中改');
    // 田中はbottom側の選手なので、top側の改名指定では一切変わらない
    expect(r.lineups.top.map((p) => p.name)).toEqual(['山田 太郎', '佐藤']);
    expect(r.pitches[0].pitcherName).toBe('田中');
    expect(r.pitches[1].batterName).toBe('田中');
    expect(r.changed).toBe(0);
  });

  it('bottom側の改名は打者(裏)と投手(表)に適用される', () => {
    const r = renamePlayersInGame(game, 'bottom', ['田中'], '田中改');
    expect(r.lineups.bottom[0].name).toBe('田中改');
    expect(r.pitches[0].pitcherName).toBe('田中改');
    expect(r.pitches[1].batterName).toBe('田中改');
    expect(r.pitches[2].pitcherName).toBe('田中改');
    expect(r.changed).toBe(4);
  });

  it('元データを変更しない(イミュータブル)', () => {
    renamePlayersInGame(game, 'top', ['山田 太郎'], 'X');
    expect(game.lineups.top[0].name).toBe('山田 太郎');
    expect(game.pitches[0].batterName).toBe('山田 太郎');
  });
});
