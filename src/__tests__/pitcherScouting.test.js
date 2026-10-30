import { describe, expect, it } from 'vitest';
import { normalizeArchive } from '../analyticsData.js';
import { buildPitcherReport, buildGamePlan, listTeamPitchers, courseZone, quickTimeStats } from '../pitcherScouting.js';

// 相手(後攻)の投手「田中」が、自軍(先攻)の打者に投げた記録。isTop=true が田中の投球
const P = (batter, pitchNumber, result, extra = {}) => ({ inning: 1, isTop: true, batter, batterName: `打者${batter}`, batterBats: '右', pitcherName: '田中', pitcherThrows: '右', pitchNumber, result, type: 'ストレート', course: 24, isEvent: false, runners: { first: false, second: false, third: false }, ...extra });
const pitches = [
  // 1人目: ボール→ボール→(2-0)ストレート安打
  P(1, 1, 'ボール'), P(1, 2, 'ボール'), P(1, 3, '中安'),
  // 2人目(走者1塁): 牽制(1塁)を2回挟んで、スライダーで空振り三振
  P(2, 1, '牽制(1塁)', { type: '-', course: null, runners: { first: true } }),
  P(2, 2, 'ストライク', { type: 'スライダー', course: 32, runners: { first: true } }),
  P(2, 3, '牽制(1塁)', { type: '-', course: null, runners: { first: true } }),
  { inning: 1, isTop: true, batter: 2, pitcherName: '田中', pitchNumber: '-', result: '打者1 盗塁で2塁へ', isEvent: true, type: '-', course: null, runners: { first: true } },
  P(2, 4, 'ファウル', { type: 'スライダー', course: 32, runners: { second: true } }),
  P(2, 5, '空振り', { type: 'スライダー', course: 40, runners: { second: true } }),
  // 3人目: ピッチクロック違反(ボール)のあと、1-0から四球
  P(3, 1, 'ピッチクロック違反ボール', { type: '-', course: null }),
  P(3, 2, 'ボール', { type: 'カーブ', course: 0 }), P(3, 3, 'ボール', { type: 'ストレート', course: 6 }), P(3, 4, 'ボール', { type: 'ストレート', course: 48 }),
];
const game = { id: 'g1', date: '2026-10-01', teamTop: '自軍', teamBottom: '相手', data: { gameState: { runs: { top: [1], bottom: [0] } }, lineups: { top: [{ name: '打者1' }, { name: '打者2' }, { name: '打者3' }], bottom: [{ name: '田中', pos: '投' }] }, pitches } };

const setup = () => {
  const db = normalizeArchive([game], [{ name: '相手', players: [{ name: '田中', throws: '右' }] }], '自軍');
  const opp = db.teams.find(t => t.name === '相手');
  return { db, opp, games: db.games };
};

describe('相手投手レポート', () => {
  it('チームの投手を投球数つきで一覧にする(牽制・違反は球数に入れない)', () => {
    const { db, opp, games } = setup();
    const list = listTeamPitchers(db, games, opp.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '田中', pitches: 9, games: 1 });
    expect(list[0].id).toBe(db.players.find(p => p.name === '田中').id);
  });

  it('投げる前のカウントで球種を集計する(牽制はカウントに影響せず、違反はカウントを進める)', () => {
    const { db, opp, games } = setup();
    const r = buildPitcherReport(db, games, opp.id, '田中');
    expect(r.summary.pitches).toBe(9);
    expect(r.summary.batters).toBe(3);
    const at = c => r.byCount.find(x => x.count === c);
    expect(at('2-0').top).toMatchObject({ type: 'ストレート', n: 2 }); // 1人目の3球目と3人目の3球目
    expect(at('0-1').n).toBe(1);   // 2人目のファウル(牽制を挟んでも0-1)
    expect(at('0-2').top.type).toBe('スライダー');
    expect(at('1-0').shares.map(x => x.type)).toEqual(['ストレート', 'カーブ']); // 1人目の2球目と、3人目(違反ボールで1-0から)のカーブ
    expect(at('0-0').n).toBe(2); // 1人目と2人目の初球(3人目は違反で1-0から)
  });

  it('三振・四球・安打と決め球、牽制・盗塁を数える', () => {
    const { db, opp, games } = setup();
    const r = buildPitcherReport(db, games, opp.id, '田中');
    expect(r.summary.strikeouts).toBe(1);
    expect(r.kPitches[0]).toMatchObject({ type: 'スライダー', n: 1 });
    expect(r.summary.AVG).toBe('0.500'); // 2打数1安打(四球は打数外)
    expect(r.running.pickoffs).toBe(2);
    expect(r.running.pickoffBases).toEqual({ '1塁': 2 });
    expect(r.running.pasWithRunners).toBe(1);
    expect(r.running.stealsAllowed).toBe(1);
    expect(r.byType.find(t => t.type === 'スライダー')).toMatchObject({ n: 3, whiffPct: 50, strikeouts: 1 });
  });

  it('コースは打者の左右で内角・外角を読み替える(捕手目線で保存)', () => {
    expect(courseZone(0, '右')).toMatchObject({ height: '高め', width: '内角', inZone: false });
    expect(courseZone(0, '左')).toMatchObject({ width: '外角' });
    expect(courseZone(24, '右')).toMatchObject({ height: '真ん中', width: '真ん中', inZone: true });
    expect(courseZone(null, '右')).toBeNull();
  });

  it('クイックのタイムとあわせて攻略ポイントを作る', () => {
    expect(quickTimeStats(['1.3', 1.4, 'x'])).toMatchObject({ n: 2, min: 1.3, max: 1.4 });
    expect(quickTimeStats([])).toBeNull();
    const { db, opp, games } = setup();
    const r = buildPitcherReport(db, games, opp.id, '田中');
    const plan = buildGamePlan(r, { quickTimes: [1.35, 1.4] });
    expect(plan.some(t => t.text.includes('クイックが遅い') && t.tone === 'attack')).toBe(true);
    expect(plan.some(t => t.text.includes('牽制2回'))).toBe(true);
  });
});
