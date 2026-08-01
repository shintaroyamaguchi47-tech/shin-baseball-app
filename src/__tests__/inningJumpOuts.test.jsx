// @vitest-environment jsdom
// スコアボードの回をタップして記録を再開したとき(速報の打席から再開する導線も同じ)、
// その回に記録済みのアウトが引き継がれること。
// 以前は最後の投球記録に保存された「その投球を投げる前」のアウト数を読んでいたため、
// その回の最後の打席結果(例: ライトゴロ)のアウトが数えられないまま再開していた。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const btn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const state = () => JSON.parse(localStorage.getItem('baseball_gameState_v2'));

describe('回を切り替えて記録を再開したときのアウト数', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  const click = async (label) => { await act(async () => { btn(container, label).click(); }); };
  const inplay = async (fielder, result) => {
    const course = [...container.querySelector('.grid-cols-7').querySelectorAll('button')];
    await act(async () => { course[24].click(); });
    await click('打った！');
    const svg = container.querySelector('svg.cursor-crosshair');
    await act(async () => { svg.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })); });
    await click(fielder);
    await click(result);
  };
  // スコアボードの回セル(先攻の行)。1つ目が1回表。
  const inningCells = () => [...container.querySelectorAll('div')].filter((d) => d.className.includes('cursor-pointer') && d.className.includes('hover:bg-blue-50'));

  it('ライトゴロを含む2アウトの回へ戻っても2アウトのまま', async () => {
    await inplay('右', 'ゴロ');
    await inplay('遊', 'ゴロ');
    expect(state().outs).toBe(2);

    const cells = inningCells();
    expect(cells.length).toBeGreaterThan(0);
    await act(async () => { cells[0].click(); }); // 1回表へ

    expect(state().outs).toBe(2);
    expect(state().inning).toBe(1);
    expect(state().isTop).toBe(true);
    expect(state().batterTop).toBe(3); // 2人がアウトになったので3番から再開
  });

  it('🔄記録から再計算でも記録どおりのアウト数になる', async () => {
    await inplay('右', 'ゴロ');
    await inplay('右', 'ゴロ');
    await click('🔄 記録から再計算');
    await click('実行する');
    expect(state().outs).toBe(2);
  });
});
