// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import { buildAnalystInsights } from '../analystInsights.js';
import '../pdfReport.js';

// React 18 の createRoot を flush するため act 環境を有効化
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

describe('アプリ全体のスモークテスト', () => {
  let container;

  beforeAll(async () => {
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
  });

  it('メイン画面がクラッシュせず描画される', () => {
    expect(container.textContent).toContain('配球スコア');
  });

  it('初期ラインナップ(先攻/後攻)が表示される', () => {
    expect(container.textContent).toContain('先攻');
    expect(container.textContent).toContain('後攻');
  });

  it('PDFレポート生成関数がグローバルに定義される', () => {
    expect(typeof window.generatePdfReport).toBe('function');
  });
});

describe('buildAnalystInsights', () => {
  const lineups = {
    top: [{ order: 1, name: '先攻1番', pos: '未', throws: '右', bats: '右' }],
    bottom: [{ order: 1, name: '後攻1番', pos: '未', throws: '右', bats: '右' }],
  };
  const gameInfo = { date: '2026-06-11', teamTop: 'A', teamBottom: 'B' };

  it('投球データなしでは hasData が false', () => {
    const r = buildAnalystInsights([], lineups, gameInfo);
    expect(r.hasData).toBe(false);
  });

  it('投球データがあれば hasData が true でチーム別に集計される', () => {
    const pitches = [
      { isTop: true, inning: 1, batter: 1, batterName: '先攻1番', pitcher: '後攻投手', pitcherName: '後攻投手', course: 24, type: 'ストレート', result: 'ストライク' },
      { isTop: true, inning: 1, batter: 1, batterName: '先攻1番', pitcher: '後攻投手', pitcherName: '後攻投手', course: 0, type: 'スライダー', result: 'ボール' },
    ];
    const r = buildAnalystInsights(pitches, lineups, gameInfo);
    expect(r.hasData).toBe(true);
    expect(r.top).toBeTruthy();
    expect(r.bottom).toBeTruthy();
  });
});
