import { describe, it, expect } from 'vitest';
import { isScorerGdf, convertScorerGame } from '../scorerImport.js';
import { buildPlayByPlayReport } from '../playByPlay.js';

// 合成した最小のGDFデータ(1イニング完結)
// 表: 三振 → 四球 → (盗塁) レフト前ヒット(2走が3塁へ) → レフト犠飛(得点) → 遊ゴロ
// 裏: 投ゴロ → 見逃し三振 → セカンドフライ
const makeGdf = () => {
  const mk = (id, name) => ({ id, disp: name, last: name, first: '', num: String(id % 100), arm: 5, pos: 0, grd: 0, birth: '', note: '', tm1: '' });
  const pl = [
    ...Array.from({ length: 9 }, (_, i) => mk(101 + i, `攻${i + 1}`)),
    ...Array.from({ length: 9 }, (_, i) => mk(201 + i, `守${i + 1}`)),
  ];
  const gteam = (base) => ({
    id: base === 101 ? 1 : 2,
    players: Array.from({ length: 9 }, (_, i) => ({ id: base + i, ord: i, pos: i, replc: false })),
    ordnum: 9, dheh: -1, icomp: -1, alias: '',
  });
  const cf = { date: '2026-07-12', title: 'テスト大会', stadi: 'テスト球場', gteams: [gteam(101), gteam(201)] };
  const cd = [
    'It01', 'Na', 'Pb', 'Pl', 'Ps', 'Ps', 'Ko',
    'Nb', 'Na', 'Pb', 'Pb', 'Pb', 'Pb', 'BbJ01',
    'Nb', 'Na', 'Ru1', 'Pb', 'RsJ12', 'Pl', 'H1--74J23J01', 'Wtf',
    'Nb', 'Na', 'Fo--68CfO00J34J11',
    'Nb', 'Na', 'Go--54Th2O01J11', 'At01Lb1',
    'Ib01', 'Na', 'Go--04Th2O01',
    'Nb', 'Na', 'Pl', 'Pl', 'Pl', 'Ko',
    'Nb', 'Na', 'Pb', 'Fo--34O00', 'Ab01', 'Ah',
  ].join('=');
  return JSON.stringify({
    kind: 'GDF',
    game: {
      cd, td: 1, bd: 2, tn: 'テストA', bn: 'テストB', gid: 999, tm: 1780000000000,
      cf: JSON.stringify(cf), pl: JSON.stringify(pl),
      ti: '[テストA]攻1', bi: '[テストB]守1',
    },
  });
};

describe('isScorerGdf', () => {
  it('GDF形式のJSONを判別する', () => {
    expect(isScorerGdf(makeGdf())).toBe(true);
  });
  it('通常のバックアップJSONや共有テキストはGDF扱いしない', () => {
    expect(isScorerGdf(JSON.stringify({ gameState: {}, lineups: {}, pitches: [] }))).toBe(false);
    expect(isScorerGdf('BASEBALL_SHARE:teams:xxxx')).toBe(false);
    expect(isScorerGdf('')).toBe(false);
  });
});

describe('convertScorerGame', () => {
  const { savedGame, warnings, runs } = convertScorerGame(makeGdf());
  const pitches = savedGame.data.pitches;

  it('警告なしで変換できる', () => {
    expect(warnings).toEqual([]);
  });

  it('スコアと試合情報を復元する', () => {
    expect(savedGame.teamTop).toBe('テストA');
    expect(savedGame.teamBottom).toBe('テストB');
    expect(savedGame.scoreTop).toBe(1);
    expect(savedGame.scoreBottom).toBe(0);
    expect(runs.top[0]).toBe(1);
    expect(savedGame.date).toBe('2026-07-12');
    expect(savedGame.data.gameInfo.tournament).toBe('テスト大会');
  });

  it('1球ごとの記録をアプリの語彙で生成する', () => {
    const results = pitches.filter((p) => !p.isEvent).map((p) => p.result);
    // 表: 三振(ボール+見逃し+空振り+空振り) → 四球(4ボール) → 単打 → 犠飛 → ゴロ
    expect(results.slice(0, 4)).toEqual(['ボール', 'ストライク', '空振り', '空振り']);
    expect(results.slice(4, 8)).toEqual(['ボール', 'ボール', 'ボール', 'ボール']);
    expect(results).toContain('センター安');
    expect(results).toContain('レフト犠飛');
    expect(results).toContain('ショートゴロ');
    expect(results).toContain('ピッチャーゴロ');
    expect(results).toContain('セカンドフライ'.replace('フライ', '飛'));
  });

  it('盗塁を走者イベントとして記録する', () => {
    const ev = pitches.find((p) => p.isEvent && p.result.includes('盗塁'));
    expect(ev.result).toBe('1塁走者 盗塁で2塁へ');
    expect(ev.inning).toBe(1);
    expect(ev.isTop).toBe(true);
  });

  it('打者・投手名と打順を正しく割り当てる', () => {
    const first = pitches[0];
    expect(first.batterName).toBe('攻1');
    expect(first.pitcherName).toBe('守1');
    expect(first.batter).toBe(1);
    const walk = pitches.filter((p) => !p.isEvent)[4];
    expect(walk.batterName).toBe('攻2');
  });

  it('アプリの打席速報ビルダーで正しく解釈できる', () => {
    const report = buildPlayByPlayReport(pitches);
    const top1 = report.find((i) => i.inning === 1 && i.isTop);
    const labels = top1.plays.map((p) => p.finalLabel);
    expect(labels).toEqual(['三振', '四球', 'センター安', 'レフト犠飛', 'ショートゴロ']);
    // 犠飛で3塁走者(四球で出て盗塁・単打で3塁まで進んだ攻2)が生還する
    const sacFly = top1.plays[3];
    expect(sacFly.narrative.join('')).toContain('攻2');
    expect(sacFly.narrative.join('')).toContain('本塁生還');
  });

  it('ラインナップを守備位置つきで復元する', () => {
    const top = savedGame.data.lineups.top;
    expect(top).toHaveLength(10);
    expect(top[0]).toMatchObject({ order: 1, name: '攻1', pos: '投' });
    expect(top[5].pos).toBe('遊');
  });

  it('走者・アウトのスナップショットを保持する', () => {
    // 犠飛の投球時点: 1塁(単打の打者)と3塁(四球→盗塁→単打で進塁)に走者、1アウト
    const sacFly = pitches.find((p) => p.result === 'レフト犠飛');
    expect(sacFly.runners).toEqual({ first: true, second: false, third: true });
    expect(sacFly.outs).toBe(1);
  });
});
