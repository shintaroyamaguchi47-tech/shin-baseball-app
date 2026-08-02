// @vitest-environment jsdom
// 試合分析レポートPDFの改行位置の回帰テスト。
// 走者の記録や選手交代が「1塁走者 / 盗塁で2塁へ」のように意味の途中で折り返されていたため、
// 1件=1行で並べ、[退]/[入]/[移] の区切りでのみ折り返すようにした。
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

describe('試合分析レポートPDFの改行', () => {
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

  it('球種名は縦に割れないよう折り返しを禁止する', () => {
    const pitcher = {
      name: '投手A', total: 10, csw: 30, whiff: 20, fStrikePct: 50,
      sideStats: { right: { PA: 1, total: 5, sPct: 60, AVG: '.000', KPct: 0, BBPct: 0 }, left: { PA: 1, total: 5, sPct: 60, AVG: '.000', KPct: 0, BBPct: 0 } },
      orderStats: { top: { PA: 1, total: 5, sPct: 60, AVG: '.000', KPct: 0, BBPct: 0 }, bottom: { PA: 1, total: 5, sPct: 60, AVG: '.000', KPct: 0, BBPct: 0 } },
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
    expect(html).toContain('<div class="nw" style="color:#334155;line-height:1.3;">ストレート</div>');
    expect(html).toContain('<div class="nw" style="color:#334155;line-height:1.3;">スライダー</div>');
  });
});
