// @vitest-environment jsdom
// 試合分析レポートPDFの紙面(改行位置・改ページ位置)の回帰テスト。
//  - 改行: 走者の記録や選手交代が「1塁走者 / 盗塁で2塁へ」のように意味の途中で折り返されていたため、
//          1件=1行で並べ、[退]/[入]/[移] の区切りでのみ折り返すようにした。
//  - 改ページ: カードをflexコンテナに並べると印刷時の break-inside:avoid が効かないブラウザがあり、
//              見出しだけページ末尾に取り残されていたため、分割禁止が確実に効く表の行に並べ替えた。
import { describe, it, expect, beforeAll } from 'vitest';
import '../pdfReport.js';

const emptyBatting = { team: { AVG: '.000', OPS: '.000', KPct: 0, BBPct: 0, sprayHits: [] }, players: [] };

function reportHtml(atBats) {
  let html = '';
  const fakeWin = { document: { write: (s) => { html += s; }, close: () => {} }, print: () => {} };
  const origOpen = window.open;
  window.open = () => fakeWin;
  try {
    window.generatePdfReport({
      gameInfo: { date: '2026-08-02', teamTop: 'A', teamBottom: 'B' },
      gameState: { inning: 1, isTop: true, runs: { top: Array(9).fill(0), bottom: Array(9).fill(0) } },
      advancedStats: { topBatting: emptyBatting, bottomBatting: emptyBatting, pitchingTop: { pitchers: [] }, pitchingBottom: { pitchers: [] } },
      analystInsights: { hasData: false },
      pitches: [],
      hitsAndErrors: { top: { hits: 0, errors: 0 }, bottom: { hits: 0, errors: 0 } },
      playByPlay: [{ inning: 2, isTop: false, atBats }],
    });
  } finally {
    window.open = origOpen;
  }
  return html;
}

// 記録1件ぶんの行(・つきの1行)を取り出す
function eventLines(html) {
  return [...html.matchAll(/<div class="pbp-ev">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}
const textOf = (s) => s.replace(/<[^>]*>/g, '');

// 投手詳細だけを含むレポートを生成する
function pitcherReportHtml() {
  const sp = { PA: 1, total: 5, sPct: 60, AVG: '.000', KPct: 0, BBPct: 0 };
  const pitcher = {
    name: '投手A', total: 10, csw: 30, whiff: 20, fStrikePct: 50,
    sideStats: { right: sp, left: sp },
    orderStats: { top: sp, bottom: sp },
    counts: {
      vsRight: { ahead: { total: 2, strikes: 1, types: { 'ストレート': 1, 'スライダー': 1 } }, even: { total: 0, strikes: 0, types: {} }, behind: { total: 0, strikes: 0, types: {} } },
      vsLeft: { ahead: { total: 0, strikes: 0, types: {} }, even: { total: 0, strikes: 0, types: {} }, behind: { total: 0, strikes: 0, types: {} } },
    },
    pitchTypeHeatmaps: {},
  };
  let html = '';
  const fakeWin = { document: { write: (s) => { html += s; }, close: () => {} }, print: () => {} };
  const origOpen = window.open;
  window.open = () => fakeWin;
  try {
    window.generatePdfReport({
      gameInfo: { date: '2026-08-02', teamTop: 'A', teamBottom: 'B' },
      gameState: { inning: 1, isTop: true, runs: { top: Array(9).fill(0), bottom: Array(9).fill(0) } },
      advancedStats: { topBatting: emptyBatting, bottomBatting: emptyBatting, pitchingTop: { pitchers: [pitcher] }, pitchingBottom: { pitchers: [] } },
      analystInsights: { hasData: false },
      pitches: [],
      hitsAndErrors: { top: { hits: 0, errors: 0 }, bottom: { hits: 0, errors: 0 } },
      playByPlay: [],
    });
  } finally {
    window.open = origOpen;
  }
  return html;
}

describe('試合分析レポートPDFの紙面', () => {
  let lines;
  beforeAll(() => {
    lines = eventLines(reportHtml([{
      batter: 7, batterName: '宮崎幹太', pitcherName: '投手A', pitchCount: 7, result: 'ショートゴロ',
      events: [
        '1塁走者 盗塁で2塁へ',
        '2塁走者が盗塁死',
        '選手交代: [退]7番/右 宮崎幹太 ➡️ [入]右 望月唯愛 (守備)',
        '選手交代: [移]9番 塩津 一→右 (位置変更) / [移]牧田 右→一',
      ],
      pitches: [],
    }]));
  });

  it('記録は1件につき1行になる(スラッシュ併記の交代も分ける)', () => {
    expect(lines).toHaveLength(5);
    expect(lines.map(textOf)).toEqual([
      '・1塁走者 盗塁で2塁へ',
      '・2塁走者が盗塁死',
      '・選手交代: [退]7番/右 宮崎幹太 ➡️ [入]右 望月唯愛 (守備)',
      '・選手交代: [移]9番 塩津 一→右 (位置変更)',
      '・[移]牧田 右→一',
    ]);
  });

  it('走者の記録は途中で折り返さない', () => {
    expect(lines[0]).toContain('<span class="nw">1塁走者 盗塁で2塁へ</span>');
  });

  it('選手交代は[退]と[入]のまとまりごとに折り返す', () => {
    expect(lines[2]).toContain('<span class="nw">[退]7番/右 宮崎幹太 ➡️</span>');
    expect(lines[2]).toContain('<span class="nw">[入]右 望月唯愛 (守備)</span>');
  });

  it('打席結果と記録は別の行に置く', () => {
    const html = reportHtml([{ batter: 1, batterName: 'テスト太郎', pitcherName: '投手A', pitchCount: 4, result: '四球', events: ['1塁走者 盗塁で2塁へ'], pitches: [] }]);
    // 打席結果のすぐ後ろに記録が続かず、記録は独立した行(div)になっている
    expect(html).toMatch(/四球<\/span><\/div><div class="pbp-ev">/);
  });

  it('テキスト速報のイニングは分割禁止の表の行に並べる', () => {
    const html = reportHtml([{ batter: 1, batterName: 'テスト太郎', pitcherName: '投手A', pitchCount: 4, result: '四球', events: [], pitches: [] }]);
    expect(html).toContain('<tr class="pbr">');
    expect(html).toContain('.bdr,.pbr,');
  });

  it('打者詳細のカードは1行=1カード(2打席以下は2枚)の分割禁止の行に並べる', () => {
    const atBat = (inning) => ({ inning, isTop: true, result: 'ライト飛', pitches: [{ course: 24, type: 'ストレート', result: 'ストライク' }], sprayHit: null });
    const player = (order, name, nAb) => ({
      order, name, pos: '右', bats: '右', throws: '右', AB: nAb, H: 0, BB_HBP: 0, PA: nAb, K: 0,
      AVG: '.000', OPS: '.000', KPct: 0, results: [], atBats: Array.from({ length: nAb }, (_, i) => atBat(i + 1)),
    });
    const batting = {
      team: { AVG: '.000', OPS: '.000', KPct: 0, BBPct: 0, sprayHits: [] },
      players: [player(1, '山下', 2), player(2, '安野', 2), player(3, '郡司', 3)],
    };
    let html = '';
    const fakeWin = { document: { write: (s) => { html += s; }, close: () => {} }, print: () => {} };
    const origOpen = window.open;
    window.open = () => fakeWin;
    try {
      window.generatePdfReport({
        gameInfo: { date: '2026-08-02', teamTop: 'A', teamBottom: 'B' },
        gameState: { inning: 1, isTop: true, runs: { top: Array(9).fill(0), bottom: Array(9).fill(0) } },
        advancedStats: { topBatting: batting, bottomBatting: emptyBatting, pitchingTop: { pitchers: [] }, pitchingBottom: { pitchers: [] } },
        analystInsights: { hasData: false },
        pitches: [],
        hitsAndErrors: { top: { hits: 0, errors: 0 }, bottom: { hits: 0, errors: 0 } },
        playByPlay: [],
      });
    } finally {
      window.open = origOpen;
    }
    const rows = [...html.matchAll(/<tr class="bdr">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    expect(rows).toHaveLength(2);
    // 2打席の山下と安野は横並び、3打席の郡司は1人で1行
    expect(rows[0].match(/<td /g)).toHaveLength(2);
    expect(rows[0]).toContain('1番 山下');
    expect(rows[0]).toContain('2番 安野');
    expect(rows[1]).toContain('colspan="2"');
    expect(rows[1]).toContain('3番 郡司');
  });

  it('球種名は縦に割れないよう折り返しを禁止する', () => {
    const html = pitcherReportHtml();
    expect(html).toContain('<div class="nw" style="color:#334155;line-height:1.3;">ストレート</div>');
    expect(html).toContain('<div class="nw" style="color:#334155;line-height:1.3;">スライダー</div>');
  });

  it('スプリット表とカウント別配球は横並びにせず、幅いっぱいの段として縦に積む', () => {
    // 横並びだと互いに最小幅を割り込み、スプリット表の右端(K%・BB%)が
    // カウント別配球の下に隠れ、「対左」が紙面の右端からはみ出していた。
    const html = pitcherReportHtml();
    const section = html.slice(html.indexOf('<section class="report-section pitcher-section'));
    const splitIdx = section.indexOf('>スプリット<');
    const countIdx = section.indexOf('>カウント別配球<');
    // 見出しが並ぶ順序は スプリット → カウント別配球
    expect(splitIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(splitIdx);
    // スプリット表は紙面の幅いっぱいを使う(縮められて列が隠れない)
    expect(section).toContain('<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;table-layout:auto;">');
    // 2つの見出しの間に、両者を横並びにするflexコンテナが挟まっていない
    expect(section.slice(splitIdx, countIdx)).not.toContain('display:flex');
    // 対右・対左は等幅で紙面を半分ずつ使う(内容量の差で片方がはみ出さない)
    expect(section).toContain('flex:1 1 0;min-width:0;');
  });
});
