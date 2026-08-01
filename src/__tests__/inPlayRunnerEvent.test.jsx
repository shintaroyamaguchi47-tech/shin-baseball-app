// @vitest-environment jsdom
// 「打った！」のあと、打撃結果を選ぶ前に走者アウト/進塁を記録できる(打球中の走塁は実際に起きる)。
// このとき打撃結果が記録の末尾(=走者イベント)を上書きしてしまうと、
// 走者アウトの記録ごと消えてアウト数が合わなくなる。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const btn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const stored = (key) => JSON.parse(localStorage.getItem(key));

describe('打球中に走者アウトを記録した打席', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  const pitch = async (label) => {
    const course = [...container.querySelector('.grid-cols-7').querySelectorAll('button')];
    await act(async () => { course[24].click(); });
    await act(async () => { btn(container, label).click(); });
  };
  const click = async (label) => { await act(async () => { btn(container, label).click(); }); };

  it('走者アウトの記録を打撃結果が消さず、アウトが2つ数えられる', async () => {
    for (let i = 0; i < 4; i++) await pitch('ボール'); // 1番: 四球で1塁へ
    await pitch('打った！');

    // 打撃結果を選ぶ前に、1塁走者が盗塁死
    await click('走者ｱｳﾄ');
    await click('1塁走者');
    await click('アウトを記録');
    expect(stored('baseball_gameState_v2').outs).toBe(1);

    // 続けて打球結果(ライトゴロ)を記録する
    const svg = container.querySelector('svg.cursor-crosshair');
    await act(async () => { svg.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })); });
    await click('右');
    await click('ゴロ');

    const results = stored('baseball_pitches_v2').map((p) => p.result);
    expect(results).toEqual(['ボール', 'ボール', 'ボール', 'ボール', 'ライトゴロ', '1塁走者が盗塁死']);
    expect(results).not.toContain('インプレー'); // 打球結果が未確定のまま残らない
    expect(stored('baseball_gameState_v2').outs).toBe(2); // 走者アウト + 打者アウト
  });
});
