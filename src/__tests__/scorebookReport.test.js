// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import '../scorebookReport.js';

const emptyTeam = () => ({
  slots: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, occupants: [], cellsByInning: {} })),
  inningSummary: [{ H: 0, BB: 0, K: 0, R: 0, LOB: 0, pitchCount: 0, E: 0 }],
  playerTotals: [], pitcherStats: [],
  extraBaseHits: { doubles: [], triples: [], homeruns: [] },
});

describe('スコアブックPDFのページ構成', () => {
  let originalOpen;

  beforeAll(() => { originalOpen = window.open; });

  const render = (options) => {
    let html = '';
    window.open = () => ({ document: { write: s => { html += s; }, close() {} }, print() {} });
    window.generateScorebookReport({
      scorebook: { maxInning: 1, top: emptyTeam(), bottom: emptyTeam() },
      gameInfo: { date: '2026-07-19', teamTop: '先攻A', teamBottom: '後攻B' },
      gameState: { runs: { top: [0], bottom: [0] } },
      options,
    });
    window.open = originalOpen;
    return html;
  };

  // 個人成績は独立したページをやめ、各チームのスコアページ右側へ統合した
  it('先攻・後攻の2シートにまとめ、個人成績はスコアページに同居させる', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(2);
    expect(html).toContain('先攻スコア');
    expect(html).toContain('後攻スコア');
    // 個人成績はスコア表の右側(aside)に入る
    expect(html).toContain('<aside class="sb-score-side">');
    expect(html).toContain('打撃成績');
  });

  it('設定で図と個人成績ページを省略できる', () => {
    const html = render({ includeCharts: false, includeStats: false });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(2);
    expect(html).not.toContain('<th class="sb-hd-pa">');
    expect(html).not.toContain('<aside class="sb-score-side">');
  });
});
