// @vitest-environment jsdom
// 「選手交代を忘れていた」ケースの回帰テスト。
// 試合後に記録修正画面からその場面へさかのぼって交代を挿入すると、
// 交代イベントが差し込まれ、それ以降の記録が交代後の選手に書き換わることを確認する。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

function findButton(root, text) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`ボタンが見つかりません: ${text}`);
  return btn;
}

function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const pitch = (over) => ({
  inning: 1, isTop: true, batter: 3, isEvent: false, pitchNumber: 1, result: 'ストライク', course: 24, type: 'ストレート',
  batterName: '山田', batterBats: '右', batterThrows: '右', batterPos: '遊',
  pitcherName: '相手投手', pitcherThrows: '右',
  runners: { first: false, second: false, third: false }, outs: 0,
  ...over,
});

// 3番(山田)が1回・4回・6回に打っている記録。4回から代打を出し忘れた想定。
const seedPitches = [
  pitch({ inning: 1, result: '三振' }),
  pitch({ inning: 4, result: 'ボール' }),
  pitch({ inning: 4, pitchNumber: 2, result: '右前安打' }),
  pitch({ inning: 6, result: '二ゴロ' }),
];

const seedLineups = {
  top: Array.from({ length: 10 }, (_, i) => ({ order: i < 9 ? i + 1 : '投', name: i === 2 ? '山田' : `先攻${i + 1}番`, pos: i === 2 ? '遊' : '未', throws: '右', bats: '右' })),
  bottom: Array.from({ length: 10 }, (_, i) => ({ order: i < 9 ? i + 1 : '投', name: i === 9 ? '相手投手' : `後攻${i + 1}番`, pos: i === 9 ? '投' : '未', throws: '右', bats: '右' })),
};

const storedPitches = () => JSON.parse(localStorage.getItem('baseball_pitches_v2'));
const storedLineups = () => JSON.parse(localStorage.getItem('baseball_lineups_v2'));

describe('試合後にさかのぼって選手交代を挿入する', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_pitches_v2', JSON.stringify(seedPitches));
    localStorage.setItem('baseball_lineups_v2', JSON.stringify(seedLineups));
    localStorage.setItem('baseball_gameInfo_v2', JSON.stringify({ date: '2026-07-25', gameType: '練習試合', teamTop: '自チーム', teamBottom: '相手チーム' }));
    localStorage.setItem('baseball_gameState_v2', JSON.stringify({ inning: 7, isTop: false, outs: 0, balls: 0, strikes: 0, batterTop: 4, batterBottom: 1, runners: { first: false, second: false, third: false }, runs: { top: [0,0,0,0,0,0,0,0,0], bottom: [0,0,0,0,0,0,0,0,0] } }));
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  // 記録修正 → 指定インデックスの「交代挿入」→ 交代内容を入力 → 挿入
  const insertSubAt = async (recordIndex, { name, type = null, team = null }) => {
    await act(async () => { findButton(container, '📝 記録修正').click(); });
    const insertButtons = [...container.querySelectorAll('button')].filter((b) => b.textContent.includes('交代挿入'));
    expect(insertButtons.length).toBe(storedPitches().length);
    await act(async () => { insertButtons[recordIndex].click(); });
    expect(container.textContent).toContain('この場面の直前に交代を挿入します');
    // 交代モーダル内に絞ってクリックする(チーム名はスコアボードのボタンにも含まれるため)
    const modal = [...container.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent.includes('選手交代'));
    if (team) await act(async () => { findButton(modal, team).click(); });
    if (type) await act(async () => { findButton(modal, type).click(); });
    const nameInput = [...container.querySelectorAll('input[placeholder="新しい選手名"]')][0];
    await act(async () => { typeInto(nameInput, name); });
    await act(async () => { findButton(container, 'この場面に挿入').click(); });
  };

  it('挿入した場面以降の打席だけが代打の選手に書き換わる', async () => {
    await insertSubAt(1, { name: '鈴木' });

    const after = storedPitches();
    expect(after).toHaveLength(5);
    expect(after[1].isEvent).toBe(true);
    expect(after[1].result).toBe('選手交代: [退]3番/遊 山田 ➡️ [入]打 鈴木 (代打)');
    expect(after[1].inning).toBe(4);
    // 1回の打席は山田のまま、4回以降は鈴木
    expect(after.map((p) => p.batterName)).toEqual(['山田', '鈴木', '鈴木', '鈴木', '鈴木']);
    expect(after[0].result).toBe('三振');
    expect(after[2].result).toBe('ボール');
  });

  it('挿入した交代が最新なら現在のオーダーにも反映される', async () => {
    await insertSubAt(1, { name: '鈴木' });
    expect(storedLineups().top[2]).toMatchObject({ name: '鈴木', pos: '打' });
  });

  it('挿入した交代は記録修正画面に交代イベントとして並ぶ', async () => {
    await insertSubAt(1, { name: '鈴木' });
    await act(async () => { findButton(container, '📝 記録修正').click(); });
    expect(container.textContent).toContain('選手交代: [退]3番/遊 山田 ➡️ [入]打 鈴木 (代打)');
  });

  it('さらに前の場面へ交代を挿入しても、あとの交代以降は書き換えない', async () => {
    await insertSubAt(1, { name: '鈴木' });   // 4回から鈴木
    await insertSubAt(0, { name: '佐藤' });   // 1回から佐藤(鈴木の交代より前)

    const after = storedPitches();
    expect(after).toHaveLength(6);
    // [佐藤の交代] 1回=佐藤 / [鈴木の交代] 4回以降=鈴木
    expect(after[0].result).toContain('➡️ [入]打 佐藤 (代打)');
    expect(after.map((p) => p.batterName)).toEqual(['佐藤', '佐藤', '鈴木', '鈴木', '鈴木', '鈴木']);
    // 現在のオーダーは最新の交代(鈴木)のまま
    expect(storedLineups().top[2].name).toBe('鈴木');
  });

  it('取り消し(元に戻す)で挿入前の記録へ戻せる', async () => {
    await insertSubAt(1, { name: '鈴木' });
    expect(storedPitches()).toHaveLength(5);
    await act(async () => { findButton(container, '↩️ 戻る').click(); });
    const after = storedPitches();
    expect(after).toHaveLength(4);
    expect(after.map((p) => p.batterName)).toEqual(['山田', '山田', '山田', '山田']);
    expect(storedLineups().top[2].name).toBe('山田');
  });

  it('投手交代を挿入すると、その場面以降の相手打席の投手名が書き換わる', async () => {
    await insertSubAt(1, { name: '新投手', type: '投手', team: '相手チーム' });

    const after = storedPitches();
    expect(after).toHaveLength(5);
    expect(after[1].result).toContain('➡️ [入]投 新投手 (投手)');
    // 1回の打席は元の投手、4回以降は新しい投手の記録になる
    expect(after.map((p) => p.pitcherName)).toEqual(['相手投手', '新投手', '新投手', '新投手', '新投手']);
    // 打者(自チーム3番)は交代していないので変わらない
    expect(after.map((p) => p.batterName)).toEqual(['山田', '山田', '山田', '山田', '山田']);
    expect(storedLineups().bottom[9]).toMatchObject({ name: '新投手', pos: '投' });
  });
});
