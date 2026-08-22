// @vitest-environment jsdom
// 試合後の分析で、四球が「ボール」・三振が「空振り」と最終球のまま表示されていた。
// 打席結果は deriveFinalLabel で打席の言葉に直してから表示する。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import { deriveFinalLabel } from '../playByPlay.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const p = (batter, batterName, result, pitchNumber, over = {}) => ({
  inning: 1, isTop: true, pitcher: '後攻投手', pitcherName: '後攻投手',
  batter, batterName, result, pitchNumber, type: 'ストレート', course: 24,
  runners: { first: false, second: false, third: false }, outs: 0, isEvent: false, ...over,
});

// 1番=四球(4球目がボール) / 2番=空振り三振 / 3番=ショートゴロ
const seedPitches = () => [
  p(1, '先攻1番', 'ボール', 1), p(1, '先攻1番', 'ボール', 2), p(1, '先攻1番', 'ボール', 3), p(1, '先攻1番', 'ボール', 4),
  p(2, '先攻2番', 'ストライク', 1), p(2, '先攻2番', 'ファウル', 2), p(2, '先攻2番', '空振り', 3),
  p(3, '先攻3番', 'ショートゴロ', 1, { outs: 1 }),
  p(1, '後攻1番', '死球', 1, { isTop: false, pitcher: '先攻投手', pitcherName: '先攻投手' }),
];

describe('deriveFinalLabel', () => {
  const ab = (...results) => results.map((r, i) => ({ result: r, pitchNumber: i + 1 }));

  it('4球目のボールは四球', () => {
    expect(deriveFinalLabel(ab('ボール', 'ボール', 'ボール', 'ボール'))).toBe('四球');
  });

  it('3ストライク目の空振り・見逃しは三振', () => {
    expect(deriveFinalLabel(ab('ストライク', 'ファウル', '空振り'))).toBe('三振');
    expect(deriveFinalLabel(ab('空振り', '空振り', 'ストライク'))).toBe('三振');
  });

  it('死球・振り逃げ・打球の結果はそのまま', () => {
    expect(deriveFinalLabel(ab('死球'))).toBe('死球');
    expect(deriveFinalLabel(ab('ストライク', '空振り', '振り逃げ'))).toBe('振り逃げ');
    expect(deriveFinalLabel(ab('ボール', 'ショートゴロ'))).toBe('ショートゴロ');
  });

  it('打席の途中(3アウトで中断)は最終球のまま返す', () => {
    expect(deriveFinalLabel(ab('ボール', 'ストライク'))).toBe('ストライク');
    expect(deriveFinalLabel([])).toBe('');
  });
});

describe('試合分析レポートの打席結果表記', () => {
  let container;

  beforeAll(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_pitches_v2', JSON.stringify(seedPitches()));
    localStorage.setItem('baseball_gameInfo_v2', JSON.stringify({ date: '2026-06-11', gameType: '練習試合', teamTop: 'テスト先攻', teamBottom: 'テスト後攻' }));
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('分析レポート') || b.textContent.includes('試合分析へ'));
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  });

  afterAll(() => { localStorage.clear(); });

  it('打者成績の打席結果に「ボール」「空振り」ではなく「四球」「三振」が並ぶ', () => {
    const tags = [...container.querySelectorAll('span.bg-indigo-50')].map((el) => el.textContent.trim());
    expect(tags).toContain('四球');
    expect(tags).toContain('三振');
    expect(tags).toContain('死球');
    expect(tags).toContain('ショートゴロ');
    expect(tags).not.toContain('ボール');
    expect(tags).not.toContain('空振り');
  });
});
