// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import '../scorebookReport.js';

const player = (name, bats) => ({
  name, bats, PA: 1, AB: 1, R: 0, H: 0, H2: 0, H3: 0, HR: 0, RBI: 0, BB: 0, HBP: 0, K: 0, SB: 0, SH: 0, SF: 0,
});

const emptyTeam = (playerCount = 0, withBats = true) => ({
  slots: Array.from({ length: 9 }, (_, i) => ({
    order: i + 1,
    occupants: [{ name: '選手' + (i + 1), pos: 'ショート', bats: withBats ? (i === 0 ? '左' : i === 1 ? '両' : '右') : null }],
    cellsByInning: {},
  })),
  inningSummary: [{ H: 0, BB: 0, K: 0, R: 0, LOB: 0, pitchCount: 0, E: 0 }],
  playerTotals: Array.from({ length: playerCount }, (_, i) => player('選手' + (i + 1), withBats ? (i === 0 ? '左' : '右') : null)),
  pitcherStats: [],
  extraBaseHits: { doubles: [], triples: [], homeruns: [] },
});

describe('スコアブックPDFのページ構成', () => {
  let originalOpen;

  beforeAll(() => { originalOpen = window.open; });

  const render = (options, playerCount = 0, withBats = true) => {
    let html = '';
    window.open = () => ({ document: { write: s => { html += s; }, close() {} }, print() {} });
    window.generateScorebookReport({
      scorebook: { maxInning: 1, top: emptyTeam(playerCount, withBats), bottom: emptyTeam(playerCount, withBats) },
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

  // 打撃成績が縦に伸びるほど打席表(=1マスの大きさ)の取り分が減るので、7人以上なら2段に割る
  it('打撃成績は7人以上で2つの表に分けて横に並べる', () => {
    const few = render({ includeCharts: true, includeStats: true }, 6);
    expect((few.match(/<table class="sb-totals">/g) || []).length).toBe(2); // 先攻・後攻で1つずつ
    expect(few).not.toContain('打撃成績(続き)');

    const many = render({ includeCharts: true, includeStats: true }, 13);
    expect((many.match(/<table class="sb-totals">/g) || []).length).toBe(4); // 1チームあたり2つ
    expect(many).toContain('打撃成績(続き)');
    // 7人 + 6人に割り、全員がどちらかの表に載る
    expect((many.match(/class="sb-tot-name">選手\d+</g) || []).length).toBe(26);
  });

  // 打順表と打撃成績の両方に「どっち打ち」を載せる(左打ちは色を変える)
  it('打順表と打撃成績にどっち打ちの列を出す', () => {
    const html = render({ includeCharts: true, includeStats: true }, 3);
    expect(html).toContain('<th class="sb-hd-narrow">打</th>');
    expect(html).toContain('<th class="sb-tot-bats">打</th>');
    expect(html).toContain('<span class="sb-bats sb-bats-l">左</span>');
    expect(html).toContain('<span class="sb-bats sb-bats-s">両</span>');
    expect(html).toContain('<span class="sb-bats">右</span>');
    // 集計行のラベルは打順・名前・打・守備の4列ぶん
    expect(html).toContain('<td colspan="4" class="sb-sum-label">');
  });

  // 未記録(古い試合データ)を「右打ち」と決めつけない
  it('どっち打ちが未記録の選手は空欄にする', () => {
    const html = render({ includeCharts: true, includeStats: true }, 3, false);
    expect(html).not.toContain('<span class="sb-bats');
    expect(html).toContain('<th class="sb-hd-narrow">打</th>'); // 列自体は残す
  });

  // 列幅を先に配り切り、ダイヤはマス幅いっぱいまで伸ばす(マスの中に余白を残さない)
  it('列幅を紙面の幅から割り付け、余りの配り先を列ごとに指定する', () => {
    const html = render({ includeCharts: true, includeStats: true });
    const colgroup = html.match(/<colgroup>.*?<\/colgroup>/)[0];
    const specs = [...colgroup.matchAll(/<col data-w="(\d+(?:\.\d+)?)" data-grow="([\d.]+)"/g)];
    expect(specs.length).toBeGreaterThan(4);
    const total = specs.reduce((a, m) => a + Number(m[1]), 0);
    expect(total).toBeGreaterThan(1040); // 287mm ≒ 1085px をほぼ使い切る
    expect(total).toBeLessThanOrEqual(1085);
    // 全体縮小のぶん版面を広げたときの余りは、合計1.0の割合で配る
    const grow = specs.reduce((a, m) => a + Number(m[2]), 0);
    expect(grow).toBeCloseTo(1, 5);
    // ダイヤ・コース図は枠いっぱいに伸びる(SVG側は固定pxで描かない)
    expect(html).toContain('.sb-play{position:relative;flex:0 1 auto;min-width:0;width:var(--sb-d,52px);height:var(--sb-d,52px);}');
    expect(html).toContain('--sb-d:');
    expect(html).toContain('--sb-pi:');
  });

  // 図が消えた不具合の再発防止。
  // aspect-ratio だけで高さを作った枠の中で svg{height:100%} を使うと、その組み合わせを
  // 解決できないブラウザ(iOS Safari 16.3以前など)で高さが0になり、コース図・打球方向図・
  // ダイヤが印刷結果から消えてしまう。枠の高さは必ず実寸(px)で与える。
  it('図の枠の高さをpxで指定し、aspect-ratioに依存しない', () => {
    const html = render({ includeCharts: true, includeStats: true });
    const style = html.match(/<style>(.*?)<\/style>/s)[1];
    expect(style).not.toContain('aspect-ratio');
    // コース図・打球方向図・配球記号列・ダイヤの4つとも高さがpx(CSS変数)で決まる
    expect(style).toContain('.sb-pn-zone{box-sizing:border-box;width:100%;height:var(--sb-pi,44px);');
    expect(style).toContain('.sb-pn-spray{box-sizing:border-box;width:100%;height:calc(var(--sb-pi,44px)*1.208);');
    expect(style).toContain('.sb-pn-seq{box-sizing:border-box;width:100%;height:var(--sb-pi,44px);');
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
