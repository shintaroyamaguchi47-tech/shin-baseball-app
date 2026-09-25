// @vitest-environment jsdom
// ピッチクロック違反: 投手の違反はボール、打者の違反はストライクが1つ宣告される。
// 実際には投げていないので球種・コースは持たず、投球数や球種割合には数えないが、
// カウント・四球・三振の判定には通常のボール/ストライクと同じように効くことを確かめる。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import { PITCH_CLOCK_BALL, PITCH_CLOCK_STRIKE, countBallsStrikes } from '../pitchResults.js';
import { rebuildGameStateFromPitches } from '../gameState.js';
import { deriveFinalLabel } from '../playByPlay.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const buttons = (root) => [...root.querySelectorAll('button')];
const btnLike = (root, text) => buttons(root).find((b) => b.textContent.includes(text));
const inputCard = (root) => root.querySelector('main > div');
const stored = (key) => JSON.parse(localStorage.getItem(key));

const pitch = (result, over = {}) => ({
  inning: 1, isTop: true, batter: 1, isEvent: false, pitchNumber: 1,
  pitcherName: '後攻投手', pitcherThrows: '右', batterName: '先攻1番', batterBats: '右',
  course: null, type: '-', result, ...over,
});

describe('ピッチクロック違反の入力', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  it('球種を選ぶ前の画面から投手の違反(ボール)を記録できる', async () => {
    await act(async () => { btnLike(inputCard(container), '投手 → ボール').click(); });
    const pitches = stored('baseball_pitches_v2');
    expect(pitches).toHaveLength(1);
    expect(pitches[0]).toMatchObject({ result: PITCH_CLOCK_BALL, course: null, type: '-' });
    expect(stored('baseball_gameState_v2')).toMatchObject({ balls: 1, strikes: 0 });
  });

  it('2ストライクからの打者の違反は振り逃げを聞かずに三振になる', async () => {
    for (let i = 0; i < 3; i++) {
      await act(async () => { btnLike(inputCard(container), '打者 → ストライク').click(); });
    }
    const state = stored('baseball_gameState_v2');
    expect(state).toMatchObject({ outs: 1, balls: 0, strikes: 0, batterTop: 2 });
    expect(container.textContent).not.toContain('振り逃げ');
  });
});

describe('ピッチクロック違反のカウント計算', () => {
  it('違反のボール・ストライクもカウントに数える', () => {
    expect(countBallsStrikes([pitch('ファウル'), pitch(PITCH_CLOCK_BALL), pitch(PITCH_CLOCK_STRIKE)])).toEqual({ b: 1, s: 2 });
  });

  it('違反のボール4つで四球、ストライク3つで三振として再計算される', () => {
    const walk = [1, 2, 3, 4].map((n) => pitch(PITCH_CLOCK_BALL, { pitchNumber: n }));
    expect(deriveFinalLabel(walk)).toBe('四球');
    expect(rebuildGameStateFromPitches(walk).runners.first).toBe(true);

    const k = [1, 2, 3].map((n) => pitch(PITCH_CLOCK_STRIKE, { pitchNumber: n }));
    expect(deriveFinalLabel(k)).toBe('三振');
    expect(rebuildGameStateFromPitches(k).outs).toBe(1);
  });
});
