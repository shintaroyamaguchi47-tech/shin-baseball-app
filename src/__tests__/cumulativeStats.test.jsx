// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const TEAM = 'テスト中学';

const lineupFor = (names) => [
  ...names.map((name, i) => ({ order: i + 1, name, pos: '未', throws: '右', bats: '右' })),
  { order: '投', name: '控投手', pos: '投', throws: '右', bats: '右' },
];

// 保存済みの試合を1件作る。累計成績はアーカイブを走査して集計するため、
// 打席結果と投球記録の両方が入った試合が必要になる。
const savedGame = () => {
  const lineups = {
    top: lineupFor(['山田', '佐藤', '鈴木']),
    bottom: lineupFor(['田中', '高橋', '伊藤']),
  };
  const pitch = (over) => ({
    inning: 1,
    isTop: true,
    batter: 1,
    batterName: '山田',
    pitcher: '田中',
    pitcherName: '田中',
    type: 'ストレート',
    course: 24,
    result: 'ストライク',
    runners: { first: false, second: false, third: false },
    ...over,
  });
  const pitches = [
    pitch({}),
    pitch({ result: '中前安打' }),
    pitch({ batter: 2, batterName: '佐藤', result: '三振' }),
    pitch({ batter: 3, batterName: '鈴木', result: 'ソロ本塁打' }),
    pitch({ isTop: false, batter: 1, batterName: '田中', pitcher: '山田', pitcherName: '山田', result: '四球' }),
  ];
  return {
    id: 'g1',
    date: '2026-06-11',
    teamTop: TEAM,
    teamBottom: '相手中学',
    scoreTop: 2,
    scoreBottom: 0,
    pitchesCount: pitches.length,
    data: {
      gameState: { inning: 1, isTop: true, runs: { top: Array(9).fill(0), bottom: Array(9).fill(0) }, earnedRuns: { top: Array(9).fill(0), bottom: Array(9).fill(0) } },
      gameInfo: { date: '2026-06-11', gameType: '練習試合', teamTop: TEAM, teamBottom: '相手中学' },
      lineups,
      pitches,
    },
  };
};

describe('累計成績モーダル(CumulativeStatsModal)', () => {
  let container;

  const click = async (matcher) => {
    const btn = [...container.querySelectorAll('button')].find((b) => matcher(b.textContent || ''));
    expect(btn, 'ボタンが見つからない').toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  beforeAll(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_savedGames_v2', JSON.stringify([savedGame()]));
    localStorage.setItem('baseball_registeredTeams_v2', JSON.stringify([
      { name: TEAM, players: [{ name: '山田', throws: '右', bats: '右' }, { name: '佐藤', throws: '右', bats: '左' }, { name: '鈴木', throws: '左', bats: '左' }] },
    ]));
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
    // スコアボードのチーム名ボタンにも「チーム」が含まれるため、メニュー項目を厳密に選ぶ
    await click((t) => t.trim() === '👥 チーム');
    await click((t) => t.trim() === '📊累計');
  });

  afterAll(() => {
    localStorage.clear();
  });

  it('クラッシュせず累計成績が描画される', () => {
    // 切り出しで参照が漏れていれば、この描画で ReferenceError になる
    expect(container.textContent).toContain('累計成績');
    expect(container.textContent).toContain(TEAM);
    expect(container.textContent).toContain('1試合');
  });

  it('打者成績の表とアーカイブから集計した選手が出る', () => {
    expect(container.textContent).toContain('打率');
    expect(container.textContent).toContain('OPS');
    expect(container.textContent).toContain('鈴木');
  });

  it('期間の絞り込みボタンが並ぶ', () => {
    ['全期間', '今月', '今年', '昨年'].forEach((label) => {
      expect(container.textContent).toContain(label);
    });
  });

  it('投手タブに切り替えられる', async () => {
    await click((t) => t.trim() === '⚾ 投手');
    expect(container.textContent).toContain('累計成績');
  });

  it('閉じるとモーダルが消える', async () => {
    await click((t) => t.trim() === '閉じる');
    expect(container.textContent).not.toContain('累計成績');
  });
});
