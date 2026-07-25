// @vitest-environment jsdom
// 「オーダーで控えに入れた選手が、交代のときに選べない(出場中扱いになる)」問題の回帰テスト。
// ・交代モーダルから控え選手をワンタップで選べること
// ・出場した控え選手はオーダーの控え欄から外れ、二重に並ばないこと
// ・オーダー設定の選手選択ポップアップで、控え登録しただけの選手が「出場中」にならないこと
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

const starters = (prefix) => Array.from({ length: 10 }, (_, i) => ({
  order: i < 9 ? i + 1 : '投', name: `${prefix}${i + 1}`, pos: i === 9 ? '投' : '未', throws: '右', bats: '右',
}));

// 先攻チームは先発10人 + 控え2人。控え次郎は名簿にも登録済み(=これまで「出場中」で選べなかった選手)
const seedLineups = {
  top: [
    ...starters('自'),
    { order: '控', name: '控太郎', pos: '控', throws: '右', bats: '右' },
    { order: '控', name: '控次郎', pos: '控', throws: '左', bats: '左' },
  ],
  bottom: starters('敵'),
};

const seedTeams = [
  { name: '自チーム', players: [...Array.from({ length: 10 }, (_, i) => ({ name: `自${i + 1}`, throws: '右', bats: '右' })), { name: '控次郎', throws: '左', bats: '左' }] },
];

const storedLineups = () => JSON.parse(localStorage.getItem('baseball_lineups_v2'));
const storedPitches = () => JSON.parse(localStorage.getItem('baseball_pitches_v2'));
// 交代モーダル内に絞る(チーム名などはヘッダーのボタンにも含まれるため)
const subModal = (container) => [...container.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent.includes('選手交代'));

describe('控え選手への交代', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_lineups_v2', JSON.stringify(seedLineups));
    localStorage.setItem('baseball_registeredTeams_v2', JSON.stringify(seedTeams));
    localStorage.setItem('baseball_pitches_v2', JSON.stringify([]));
    localStorage.setItem('baseball_gameInfo_v2', JSON.stringify({ date: '2026-07-25', gameType: '練習試合', teamTop: '自チーム', teamBottom: '相手チーム' }));
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
    await act(async () => { findButton(container, '🔄 交代').click(); });
  });

  it('交代モーダルに控え選手が候補として並ぶ', () => {
    const modal = subModal(container);
    expect(modal.textContent).toContain('控え・登録選手から選ぶ');
    const chips = [...modal.querySelectorAll('button')].filter((b) => b.textContent.includes('控太郎') || b.textContent.includes('控次郎'));
    expect(chips).toHaveLength(2);
    // 控え登録しただけの選手は「出場中」にならない
    expect(chips.every((c) => !c.textContent.includes('出場中'))).toBe(true);
    expect(chips.every((c) => !c.disabled)).toBe(true);
  });

  it('控え選手をタップすると入る選手として選ばれ、投打も引き継ぐ', async () => {
    const modal = subModal(container);
    await act(async () => { findButton(modal, '控次郎').click(); });
    const nameInput = container.querySelector('input[placeholder="新しい選手名"]');
    expect(nameInput.value).toBe('控次郎');
    // 名簿の左投左打が反映される
    expect([...subModal(container).querySelectorAll('select')].some((s) => s.value === '左投左打')).toBe(true);
  });

  it('控え選手で交代すると、オーダーに二重表示されず控え欄から外れる', async () => {
    let modal = subModal(container);
    await act(async () => { findButton(modal, '控太郎').click(); });
    await act(async () => { findButton(subModal(container), '交代を実行').click(); });

    const top = storedLineups().top;
    // 対象打順(初期値は1番)が控太郎に置き換わる
    expect(top[0].name).toBe('控太郎');
    // 控え欄には控次郎だけが残る
    expect(top.slice(10).map((p) => p.name)).toEqual(['控次郎']);
    expect(top.filter((p) => p.name === '控太郎')).toHaveLength(1);
    // 交代イベントが記録される
    expect(storedPitches().at(-1).result).toContain('➡️ [入]打 控太郎 (代打)');
  });

  it('オーダー設定の選手選択ポップアップで控え登録の選手を選べる', async () => {
    await act(async () => { findButton(subModal(container), 'キャンセル').click(); });
    await act(async () => { findButton(container, '⚙️ オーダー').click(); });
    // 1番打者の行の「📋 登録選手から選択」を開く
    const pickers = [...container.querySelectorAll('button')].filter((b) => b.title === '登録選手から選択');
    await act(async () => { pickers[0].click(); });

    const option = findButton(container, '控次郎');
    expect(option.disabled).toBe(false);
    expect(option.textContent).not.toContain('出場中');
    // 先発として出場中の選手は従来どおり選べない
    const used = findButton(container, '自2');
    expect(used.disabled).toBe(true);
    expect(used.textContent).toContain('出場中');

    await act(async () => { option.click(); });
    const top = storedLineups().top;
    expect(top[0].name).toBe('控次郎');
    // 控え欄からは外れる
    expect(top.slice(10).map((p) => p.name)).toEqual(['控太郎']);
  });
});
