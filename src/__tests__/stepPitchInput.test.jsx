// @vitest-environment jsdom
// 1球の入力は「球種→コース→結果」の3画面に分かれる(iPad/スマホでスクロールせずに入力するため)。
// 戻る・進むはどのステップでも画面に出ていること、投球分析の球種別割合がカウント別に出ることも確認する。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const buttons = (root) => [...root.querySelectorAll('button')];
const btn = (root, label) => buttons(root).find((b) => b.textContent.trim() === label);
const btnLike = (root, text) => buttons(root).find((b) => b.textContent.includes(text));
const inputCard = (root) => root.querySelector('main > div');
const stored = (key) => JSON.parse(localStorage.getItem(key));

describe('ステップ入力(球種→コース→結果)', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  it('球種を選ぶまでコースは出ず、順にタップすると1球が記録される', async () => {
    // 最初は球種の画面。左カラムにコースの7x7グリッドはまだない
    expect(inputCard(container).querySelector('.grid-cols-7')).toBeNull();

    await act(async () => { btnLike(container, 'スライダー').click(); });
    const grid = inputCard(container).querySelector('.grid-cols-7');
    expect(grid).not.toBeNull(); // 球種を選ぶとコースの画面に切り替わる

    await act(async () => { [...grid.querySelectorAll('button')][24].click(); });
    // コースを選ぶと結果の画面に切り替わる
    expect(btn(inputCard(container), 'ボール')).toBeTruthy();

    await act(async () => { btn(inputCard(container), 'ボール').click(); });
    const pitches = stored('baseball_pitches_v2');
    expect(pitches).toHaveLength(1);
    expect(pitches[0]).toMatchObject({ type: 'スライダー', course: 24, result: 'ボール' });

    // 記録し終えたら次の球の球種画面に戻る
    expect(inputCard(container).querySelector('.grid-cols-7')).toBeNull();
  });

  it('戻る・進むはどのステップでも入力カード内に出ている', async () => {
    const hasUndoRedo = () => {
      const card = inputCard(container);
      return Boolean(btnLike(card, '戻る') && btnLike(card, '進む'));
    };
    expect(hasUndoRedo()).toBe(true);                 // 球種
    await act(async () => { btnLike(container, 'ストレート').click(); });
    expect(hasUndoRedo()).toBe(true);                 // コース
    const grid = inputCard(container).querySelector('.grid-cols-7');
    await act(async () => { [...grid.querySelectorAll('button')][10].click(); });
    expect(hasUndoRedo()).toBe(true);                 // 結果
  });

  it('ステップを押して球種・コースをやり直せる', async () => {
    await act(async () => { btnLike(container, 'カーブ').click(); });
    const grid = inputCard(container).querySelector('.grid-cols-7');
    await act(async () => { [...grid.querySelectorAll('button')][3].click(); });

    // 結果画面から球種ステップへ戻って選び直す
    await act(async () => { btnLike(inputCard(container), '球種').click(); });
    await act(async () => { btnLike(container, 'シュート').click(); });
    const grid2 = inputCard(container).querySelector('.grid-cols-7');
    await act(async () => { [...grid2.querySelectorAll('button')][31].click(); });
    await act(async () => { btn(inputCard(container), '見逃しS').click(); });

    expect(stored('baseball_pitches_v2')[0]).toMatchObject({ type: 'シュート', course: 31, result: 'ストライク' });
  });

  it('一画面表示に切り替えると球種もコースも同時に出る', async () => {
    await act(async () => { btnLike(inputCard(container), '⛶').click(); });
    const card = inputCard(container);
    expect(card.querySelector('.grid-cols-7')).not.toBeNull();
    expect(btnLike(card, 'スライダー')).toBeTruthy();
    expect(btn(card, 'ボール')).toBeTruthy();
    expect(stored('baseball_stepInput_v1')).toBe(false); // 次に開いたときも一画面のまま
  });
});

describe('投球分析の球種別割合', () => {
  let container;
  const pitch = (over) => ({
    inning: 1, isTop: true, batter: 1, isEvent: false, pitchNumber: 1,
    pitcherName: '後攻投手', pitcherThrows: '右', batterName: '先攻1番', batterBats: '右',
    course: 24, type: 'ストレート', result: 'ストライク', ...over,
  });

  beforeEach(async () => {
    localStorage.clear();
    // 平行カウント: ストレート / 追い込んでから(有利): スライダー
    localStorage.setItem('baseball_pitches_v2', JSON.stringify([
      pitch({ type: 'ストレート', result: 'ストライク' }),   // even
      pitch({ type: 'スライダー', result: 'ボール' }),       // ahead (S1-B0)
      pitch({ type: 'スライダー', result: 'ファウル' }),     // even (S1-B1)
    ]));
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  it('カウントごとの球種割合が全カウント表示のときも並ぶ', async () => {
    const panel = [...container.querySelectorAll('div')].find((d) => d.textContent.startsWith('球種別割合'));
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('全カウント / 3球');
    // スライダーは全体では67%、有利カウントでは100%
    expect(panel.textContent).toContain('67%');
    expect(panel.textContent).toContain('100%');
  });

  it('カウントのタブを切り替えると母数と割合がそのカウントのものになる', async () => {
    await act(async () => { btn(container, '有利').click(); });
    const panel = [...container.querySelectorAll('div')].find((d) => d.textContent.startsWith('球種別割合'));
    expect(panel.textContent).toContain('有利(S>B) / 1球');
    expect(panel.textContent).not.toContain('ストレート'); // 有利カウントで投げたのはスライダーだけ
  });
});
