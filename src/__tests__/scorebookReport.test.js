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

  // 画面プレビューと印刷を一致させるため、シートはA4横1ページ固定枠として組む
  it('シートをA4横1ページ分の固定枠にし、中身を組版用のラッパーで包む', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect(html).toContain('width:287mm;height:199mm');
    expect((html.match(/<div class="sb-sheet-content">/g) || []).length).toBe(2);
    // 印刷側でシート寸法や段組みを組み替えない(=画面と同じものが出る)
    expect(html).not.toMatch(/@media print\{[^}]*\.sb-sheet\{[^}]*width:auto/);
  });

  it('組版スクリプトのscriptタグが正しく閉じている', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect(html).not.toContain('<\\/script>');
    expect(html).toContain('</script>');
    expect(html).toContain('window.__sbPrint');
  });

  it('設定で図と個人成績ページを省略できる', () => {
    const html = render({ includeCharts: false, includeStats: false });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(2);
    expect(html).not.toContain('<th class="sb-hd-pa">');
    expect(html).not.toContain('<aside class="sb-score-side">');
  });
});
