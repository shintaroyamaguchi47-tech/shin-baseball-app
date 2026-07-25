// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import '../scorebookReport.js';

const player = (name) => ({
  name, PA: 1, AB: 1, R: 0, H: 0, H2: 0, H3: 0, HR: 0, RBI: 0, BB: 0, HBP: 0, K: 0, SB: 0, SH: 0, SF: 0,
});

const emptyTeam = (playerCount = 0) => ({
  slots: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, occupants: [], cellsByInning: {} })),
  inningSummary: [{ H: 0, BB: 0, K: 0, R: 0, LOB: 0, pitchCount: 0, E: 0 }],
  playerTotals: Array.from({ length: playerCount }, (_, i) => player('選手' + (i + 1))),
  pitcherStats: [],
  extraBaseHits: { doubles: [], triples: [], homeruns: [] },
});

describe('スコアブックPDFのページ構成', () => {
  let originalOpen;

  beforeAll(() => { originalOpen = window.open; });

  const render = (options, playerCount = 0) => {
    let html = '';
    window.open = () => ({ document: { write: s => { html += s; }, close() {} }, print() {} });
    window.generateScorebookReport({
      scorebook: { maxInning: 1, top: emptyTeam(playerCount), bottom: emptyTeam(playerCount) },
      gameInfo: { date: '2026-07-19', teamTop: '先攻A', teamBottom: '後攻B' },
      gameState: { runs: { top: [0], bottom: [0] } },
      options,
    });
    window.open = originalOpen;
    return html;
  };

  // 個人成績は独立したページをやめ、各チームのスコアページに同居させる
  it('先攻・後攻の2シートにまとめ、個人成績はスコア表の下に横並びで載せる', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect((html.match(/<article class="sb-sheet /g) || []).length).toBe(2);
    expect(html).toContain('先攻スコア');
    expect(html).toContain('後攻スコア');
    // 打撃成績と投手成績は同じ帯(flex)の中に横並びで入る
    expect(html).toContain('<div class="sb-stats-band">');
    expect(html).toContain('.sb-stats-band{display:flex;');
    expect(html).toContain('打撃成績');
    // 右側の細い縦列レイアウトは廃止
    expect(html).not.toContain('sb-score-side');
  });

  // 画面プレビューと印刷を一致させるため、シートはA4横1ページ固定枠として組む
  it('シートをA4横1ページ分の固定枠にし、中身を組版用のラッパーで包む', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect(html).toContain('width:287mm;height:182mm');
    expect((html.match(/<div class="sb-sheet-content">/g) || []).length).toBe(2);
    // 印刷側でシート寸法や段組みを組み替えない(=画面と同じものが出る)
    expect(html).not.toMatch(/@media print\{[^}]*\.sb-sheet\{[^}]*width:auto/);
  });

  // ブラウザの印刷はヘッダー/フッターやプリンタ既定余白で印刷可能領域が縮み、
  // そのぶんは「幅に合わせた縮小」で吸収される。つまり1ページに収まるかは縦横比で決まる。
  // 上下左右1インチ余白(最も狭い部類)でも収まる比率にしておく。
  it('紙面の縦横比を、余白が広い印刷設定でも1ページに収まる値にする', () => {
    const html = render({ includeCharts: true, includeStats: true });
    const [, w, h] = html.match(/\.sb-sheet\{[^}]*width:(\d+)mm;height:(\d+)mm/).map(Number);
    const shrink = Math.min(1, (297 - 25.4 * 2) / w); // 幅合わせでブラウザが縮小する率
    expect(h * shrink).toBeLessThanOrEqual(210 - 25.4 * 2);
  });

  // 試合名・スコア表・凡例を縦に積むと紙面の高さを1cm近く使うので横1行にまとめる
  it('試合ヘッダー(試合名・スコア表・凡例)を横1行に並べる', () => {
    const html = render({ includeCharts: true, includeStats: true });
    expect(html).toContain('.sb-header{display:flex;');
    expect(html).toMatch(/<div class="sb-header">.*<div class="sb-header-ls">.*<div class="sb-header-legend">/s);
  });

  // 打撃成績が縦に伸びると紙面を圧迫するので、控えを含めて10人以上なら2段に割る
  it('打撃成績は10人以上で2つの表に分けて横に並べる', () => {
    const few = render({ includeCharts: true, includeStats: true }, 9);
    expect((few.match(/<table class="sb-totals">/g) || []).length).toBe(2); // 先攻・後攻で1つずつ
    expect(few).not.toContain('打撃成績(続き)');

    const many = render({ includeCharts: true, includeStats: true }, 13);
    expect((many.match(/<table class="sb-totals">/g) || []).length).toBe(4); // 1チームあたり2つ
    expect(many).toContain('打撃成績(続き)');
    // 7人 + 6人に割り、全員がどちらかの表に載る
    expect((many.match(/class="sb-tot-name">選手\d+</g) || []).length).toBe(26);
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
    expect(html).not.toContain('<div class="sb-stats-band">');
  });
});
