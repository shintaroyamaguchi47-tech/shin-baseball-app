// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

// React 18 の createRoot を flush するため act 環境を有効化
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

// 打席・投球・走者イベントをひと通り含む記録。
// レポートは打率や配球ヒートマップまで描くため、
// 空データではなく実際に集計が走る記録で開く必要がある。
const seedPitches = () => {
  const base = { inning: 1, isTop: true, pitcher: '後攻投手', pitcherName: '後攻投手' };
  const bat = (batter, batterName, result, over = {}) => ({
    ...base,
    batter,
    batterName,
    result,
    type: 'ストレート',
    course: 24,
    runners: { first: false, second: false, third: false },
    ...over,
  });
  return [
    bat(1, '先攻1番', 'ストライク'),
    bat(1, '先攻1番', 'ボール', { course: 0, type: 'スライダー' }),
    bat(1, '先攻1番', '中前安打', { hitCoord: { x: 50, y: 40 } }),
    { ...base, batter: 2, batterName: '先攻2番', result: '1塁走者 盗塁で2塁へ', isEvent: true },
    bat(2, '先攻2番', '空振り', { type: 'カーブ' }),
    bat(2, '先攻2番', '三振'),
    bat(3, '先攻3番', 'ソロ本塁打', { hitCoord: { x: 70, y: 20 } }),
    bat(4, '先攻4番', 'ショートゴロ'),
    bat(5, '先攻5番', '四球'),
    { ...base, isTop: false, batter: 1, batterName: '後攻1番', pitcher: '先攻投手', pitcherName: '先攻投手', result: '右二塁打', type: 'ストレート', course: 30, hitCoord: { x: 30, y: 35 } },
    { ...base, isTop: false, batter: 2, batterName: '後攻2番', pitcher: '先攻投手', pitcherName: '先攻投手', result: 'ファーストゴロ', type: 'ストレート', course: 12 },
  ];
};

describe('試合分析レポート(PostGameReport)', () => {
  let container;

  beforeAll(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_pitches_v2', JSON.stringify(seedPitches()));
    localStorage.setItem('baseball_gameInfo_v2', JSON.stringify({ date: '2026-06-11', gameType: '練習試合', teamTop: 'テスト先攻', teamBottom: 'テスト後攻' }));
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
  });

  afterAll(() => {
    localStorage.clear();
  });

  const openReport = async () => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('分析レポート') || b.textContent.includes('試合分析へ'));
    expect(btn, 'レポートを開くボタンが見つからない').toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('レポートを開いてもクラッシュせず、集計が描画される', async () => {
    await openReport();
    // 切り出しで参照が漏れていれば、この描画で ReferenceError になる
    expect(container.textContent).toContain('試合分析レポート');
    expect(container.textContent).toContain('テスト先攻');
    expect(container.textContent).toContain('テスト後攻');
  });

  it('スコアと投球数のサマリーが出る', () => {
    expect(container.textContent).toContain('投球数');
    expect(container.textContent).toContain('打率');
  });

  it('打者成績・投手成績・打席速報の各セクションが揃う', () => {
    expect(container.textContent).toContain('打者成績');
    expect(container.textContent).toContain('打席速報');
    expect(container.textContent).toContain('打席内容');
    // 投手陣のセクションは記録された投手名で描かれる
    expect(container.textContent).toContain('先攻投手');
    expect(container.textContent).toContain('後攻投手');
  });

  it('球種構成やコース分布など配球の集計まで描画される', () => {
    expect(container.textContent).toContain('球種割合');
    expect(container.textContent).toContain('カウント別');
    expect(container.textContent).toContain('スライダー');
  });

  it('閉じるとレポートが消える', async () => {
    const close = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('✕ 閉じる'));
    expect(close).toBeTruthy();
    await act(async () => {
      close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('試合分析レポート');
  });
});
