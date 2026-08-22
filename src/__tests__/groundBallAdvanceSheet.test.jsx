// @vitest-environment jsdom
// 1死1塁からサードゴロ。打者は一塁でアウト、1塁走者はフォースされて2塁へ。
// 打球ごとに走者の動きは違うため、記録前に進塁確認シートで確かめられる。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const btn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const pitchTypeBtn = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(name));
const stored = (key) => JSON.parse(localStorage.getItem(key));

describe('ゴロの進塁確認シート', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  const pitch = async (label) => {
    await act(async () => { pitchTypeBtn(container, 'ストレート').click(); });
    const course = [...container.querySelector('.grid-cols-7').querySelectorAll('button')];
    await act(async () => { course[24].click(); });
    await act(async () => { btn(container, label).click(); });
  };
  const click = async (label) => { await act(async () => { btn(container, label).click(); }); };
  const hitTo = async (fielder, result) => {
    await pitch('打った！');
    const svg = container.querySelector('svg.cursor-crosshair');
    await act(async () => { svg.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })); });
    await click(fielder);
    await click(result);
  };

  it('1死1塁のサードゴロは2死2塁になる', async () => {
    await hitTo('遊', 'ゴロ');                        // 1番: 遊ゴロ(1死)
    for (let i = 0; i < 4; i++) await pitch('ボール'); // 2番: 四球で1塁へ
    await hitTo('三', 'ゴロ');                        // 3番: サードゴロ

    expect(container.textContent).toContain('走者はどこまで進んだ？');
    await click('記録する');

    const gs = stored('baseball_gameState_v2');
    expect(gs.outs).toBe(2);
    expect(gs.runners).toEqual({ first: false, second: true, third: false });
    // 自動進塁のままなら余計な走者イベントは足さない
    expect(stored('baseball_pitches_v2').filter((p) => p.isEvent)).toEqual([]);
  });

  it('送球の間に3塁まで進んだ場合は走者イベントとして残る', async () => {
    await hitTo('遊', 'ゴロ');
    for (let i = 0; i < 4; i++) await pitch('ボール');
    await hitTo('三', 'ゴロ');

    await click('3塁');   // 1塁走者は送球の間に3塁へ
    await click('記録する');

    const gs = stored('baseball_gameState_v2');
    expect(gs.outs).toBe(2);
    expect(gs.runners).toEqual({ first: false, second: false, third: true });
    expect(stored('baseball_pitches_v2').filter((p) => p.isEvent).map((p) => p.result)).toEqual(['2塁走者 打球で3塁へ']);
  });
});
