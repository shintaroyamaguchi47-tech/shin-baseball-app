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

  it('先攻・後攻・個人成績を独立した3シートにする', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(3);
    expect(html).toContain('先攻スコア');
    expect(html).toContain('後攻スコア');
    expect(html).toContain('個人成績');
  });

  it('設定で図と個人成績ページを省略できる', () => {
    const html = render({ includeCharts: false, includeStats: false });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(2);
    expect(html).not.toContain('<th class="sb-hd-pa">');
    expect(html).not.toContain('個人成績</div>');
  });
});
