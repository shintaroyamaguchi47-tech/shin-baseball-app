// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { normalizeArchive } from '../analyticsData.js';
import { buildPitcherReport, buildGamePlan } from '../pitcherScouting.js';
import { buildPitcherScoutHtml, openPitcherScoutPdf } from '../pitcherScoutPdf.js';

const P = (batter, pitchNumber, result, type = 'ストレート', course = 24) => ({ inning: 1, isTop: true, batter, batterName: `打者${batter}`, batterBats: '右', pitcherName: '田中', pitcherThrows: '右', pitchNumber, result, type, course, isEvent: false, runners: { first: false, second: false, third: false } });
const game = { id: 'g1', date: '2026-10-01', teamTop: '自軍', teamBottom: '相手', data: { gameState: { runs: { top: [0], bottom: [0] } }, lineups: { top: [], bottom: [] }, pitches: [P(1, 1, 'ボール'), P(1, 2, 'ストライク', 'スライダー', 32), P(1, 3, '中安')] } };

const page = (memo) => {
  const db = normalizeArchive([game], [], '自軍');
  const opp = db.teams.find(t => t.name === '相手');
  const report = buildPitcherReport(db, db.games, opp.id, '田中');
  return { teamName: '相手', pitcher: { name: '田中', throws: '右' }, report, plan: buildGamePlan(report, memo), memo, gamesLabel: '2026-10-01' };
};

describe('相手投手レポートの印刷用HTML', () => {
  it('集計とメモを1ページに入れる', () => {
    const html = buildPitcherScoutHtml([page({ quickTimes: [1.3, 1.4], maxSpeed: '132', breaking: { スライダー: { size: '大', speed: '118', note: '横に大きい' } }, setHabit: '長く持つと牽制' })]);
    expect(html).toContain('<h1>田中');
    expect(html).toContain('カウント別の狙い球');
    expect(html).toContain('1.35秒'); // クイック平均
    expect(html).toContain('132km');
    expect(html).toContain('曲がり 大');
    expect(html).toContain('横に大きい');
    expect(html).toContain('長く持つと牽制');
    expect(html).toContain('@page{size:A4 portrait');
  });

  it('メモが空の欄は手書き用の罫線にする', () => {
    const html = buildPitcherScoutHtml([page({})]);
    expect(html).toContain('class="ruled"');
    expect(html).toContain('未計測');
  });

  it('入力した文字はHTMLとして解釈しない', () => {
    const html = buildPitcherScoutHtml([page({ plan: '<script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('複数の投手はページを分けて並べる', () => {
    const html = buildPitcherScoutHtml([page({}), { ...page({}), pitcher: { name: '佐藤', throws: '左' } }]);
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html).toContain('.page+.page{break-before:page');
  });

  it('ポップアップがブロックされたら false を返す', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openPitcherScoutPdf([page({})], 't')).toBe(false);
    let written = '';
    open.mockReturnValue({ document: { write: s => { written += s; }, close: () => {} }, print: () => {} });
    expect(openPitcherScoutPdf([page({})], '相手_田中')).toBe(true);
    expect(written).toContain('<title>相手_田中</title>');
    open.mockRestore();
  });
});
