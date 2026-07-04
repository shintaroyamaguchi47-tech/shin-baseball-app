import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  findDuplicateNameIndices,
  mergeRosterPlayers,
  renamePlayersInGame,
  detectLineupRenames,
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

describe('detectLineupRenames', () => {
  const pitches = [
    { isTop: true, batterName: '先攻1番', pitcherName: '田中', result: 'ストライク' },
    { isTop: true, batterName: '先攻1番', pitcherName: '田中', result: '中安打' },
    { isTop: false, batterName: '田中', pitcherName: '鈴木', result: 'ボール' },
  ];

  it('試合途中に登録し直した選手名を、記録件数付きで検出する', () => {
    const snapshot = { top: ['先攻1番', '鈴木'], bottom: ['田中'] };
    const lineups = {
      top: [{ name: '山田' }, { name: '鈴木' }],
      bottom: [{ name: '田中' }],
    };
    const renames = detectLineupRenames(snapshot, lineups, pitches);
    expect(renames).toEqual([{ side: 'top', from: '先攻1番', to: '山田', count: 2 }]);
  });

  it('投手として記録に現れる選手の改名も検出する(裏打席のpitcherName)', () => {
    const snapshot = { top: ['先攻1番', '鈴木'], bottom: ['田中'] };
    const lineups = {
      top: [{ name: '先攻1番' }, { name: '鈴木改' }],
      bottom: [{ name: '田中' }],
    };
    const renames = detectLineupRenames(snapshot, lineups, pitches);
    expect(renames).toEqual([{ side: 'top', from: '鈴木', to: '鈴木改', count: 1 }]);
  });

  it('記録が無い選手の変更は検出しない', () => {
    const snapshot = { top: ['先攻2番'], bottom: [] };
    const lineups = { top: [{ name: '新井' }], bottom: [] };
    expect(detectLineupRenames(snapshot, lineups, pitches)).toEqual([]);
  });

  it('打順の並び替え(同名が別の枠に残る)は改名扱いしない', () => {
    const snapshot = { top: ['先攻1番', '鈴木'], bottom: [] };
    const lineups = {
      top: [{ name: '鈴木' }, { name: '先攻1番' }],
      bottom: [],
    };
    expect(detectLineupRenames(snapshot, lineups, pitches)).toEqual([]);
  });

  it('スナップショットが無ければ空配列を返す', () => {
    expect(detectLineupRenames(null, { top: [], bottom: [] }, pitches)).toEqual([]);
  });
});
