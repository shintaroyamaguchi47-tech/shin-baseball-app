import { describe, it, expect } from 'vitest';
import { convertScorerGame } from '../scorerImport.js';
import { buildScorebookData } from '../scorebookData.js';

// scorerImport.test.jsと同じ合成GDF(1イニング完結)を使い回す。
// 表: 三振 → 四球 → (盗塁) レフト前ヒット(2走が3塁へ) → レフト犠飛(得点) → 遊ゴロ
// 裏: 投ゴロ → 見逃し三振 → セカンドフライ
const makeGdf = (cdOverride) => {
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
  const cd = cdOverride ? cdOverride.join('=') : [
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

describe('buildScorebookData (合成GDFデータ)', () => {
  const { savedGame } = convertScorerGame(makeGdf());
  const { gameState, gameInfo, lineups, pitches } = savedGame.data;
  const sb = buildScorebookData(pitches, lineups, gameInfo, gameState);

  it('イニング別得点がgameStateの公式スコアと一致する', () => {
    expect(sb.top.inningSummary[0].R).toBe(1);
    expect(sb.bottom.inningSummary[0].R).toBe(0);
    expect(sb.top.inningSummary.reduce((a, i) => a + i.R, 0)).toBe(savedGame.scoreTop);
    expect(sb.bottom.inningSummary.reduce((a, i) => a + i.R, 0)).toBe(savedGame.scoreBottom);
  });

  it('チーム得点の合計と選手別得点の合計が一致する(整合性)', () => {
    const teamR = sb.top.inningSummary.reduce((a, i) => a + i.R, 0);
    const playerR = sb.top.playerTotals.reduce((a, p) => a + p.R, 0);
    expect(playerR).toBe(teamR);
  });

  it('四球で出た走者(攻2)が盗塁・単打・犠飛で生還した経路をセルに記録する', () => {
    const slot2 = sb.top.slots[1]; // 攻2 = 打順2
    const cell = slot2.cellsByInning[1][0];
    expect(cell.batterName).toBe('攻2');
    expect(cell.finalLabel).toBe('四球');
    expect(cell.scored).toBe(true);
    expect(cell.basesReachedFinal).toBe(4);
    // 盗塁での進塁が注記として残る
    expect(cell.advancementNotes.some((n) => n.text.includes('盗塁'))).toBe(true);
  });

  it('犠飛を打った攻4に打点が付き、打者自身はアウト扱いになる', () => {
    const slot4 = sb.top.slots[3];
    const cell = slot4.cellsByInning[1][0];
    expect(cell.finalLabel).toBe('レフト犠飛');
    expect(cell.rbi).toBe(1);
    expect(cell.isBatterOut).toBe(true);
    expect(cell.basesReachedInitial).toBe(0);
  });

  it('イニング内アウト順(何アウト目か)を正しく採番する', () => {
    // 表: 攻1三振(1死) → 攻2四球(出塁,アウトなし) → 攻3単打(出塁) → 攻4犠飛(2死) → 攻5ゴロ(3死)
    expect(sb.top.slots[0].cellsByInning[1][0].outOrderInInning).toBe(1);
    expect(sb.top.slots[1].cellsByInning[1][0].outOrderInInning).toBeNull();
    expect(sb.top.slots[3].cellsByInning[1][0].outOrderInInning).toBe(2);
    expect(sb.top.slots[4].cellsByInning[1][0].outOrderInInning).toBe(3);
  });

  it('守備位置番号ベースの結果表記を生成する', () => {
    expect(sb.top.slots[0].cellsByInning[1][0].resultNotation).toBe('Ks'); // 空振り三振(最終球が空振り)
    expect(sb.top.slots[4].cellsByInning[1][0].resultNotation).toBe('6-3'); // 遊ゴロ
    expect(sb.bottom.slots[0].cellsByInning[1][0].resultNotation).toBe('1-3'); // 投ゴロ→一塁送球
  });

  it('残塁が0〜3の範囲に収まる', () => {
    [...sb.top.inningSummary, ...sb.bottom.inningSummary].forEach((s) => {
      expect(s.LOB).toBeGreaterThanOrEqual(0);
      expect(s.LOB).toBeLessThanOrEqual(3);
    });
  });

  it('犠飛はkind=sacfly(四角枠+アーチ描画用)になる', () => {
    const cell = sb.top.slots[3].cellsByInning[1][0]; // レフト犠飛
    expect(cell.resultKind).toBe('sacfly');
    expect(cell.resultNotation).toBe('7');
  });
});

describe('buildScorebookData (Th送球経路・邪飛・ライナーの表記)', () => {
  // 実データに現れたトークン形を使う:
  //   Go--23Th0O01 = 一塁手ゴロ→投手ベースカバー(3-1)
  //   Fol-44O00    = サードライナー(直飛)
  //   Fof-21O00    = 一塁手ファウルフライ(邪飛)
  const cd = [
    'It01', 'Na', 'Go--23Th0O01',
    'Nb', 'Na', 'Fol-44O00',
    'Nb', 'Na', 'Fof-21O00', 'At01Lb0',
    'Ib01', 'Na', 'Go--54Th3O01', 'Ab01', 'Ah',
  ];
  const { savedGame } = convertScorerGame(makeGdf(cd));
  const { gameState, gameInfo, lineups, pitches } = savedGame.data;
  const sb = buildScorebookData(pitches, lineups, gameInfo, gameState);

  it('送球先(Th)から実際の守備経路を表記する(一ゴロ→投手カバー=3-1)', () => {
    const cell = sb.top.slots[0].cellsByInning[1][0];
    expect(cell.finalLabel).toBe('ファーストゴロ');
    expect(cell.resultNotation).toBe('3-1');
    expect(cell.resultKind).toBe('ground');
  });

  it('通常と異なる送球先も実経路で表記する(遊ゴロ→二塁手=6-4)', () => {
    const cell = sb.bottom.slots[0].cellsByInning[1][0];
    expect(cell.resultNotation).toBe('6-4');
  });

  it('ライナー(Fol)はkind=liner・番号のみの表記になる', () => {
    const cell = sb.top.slots[1].cellsByInning[1][0];
    expect(cell.finalLabel).toBe('サード直飛');
    expect(cell.resultNotation).toBe('5');
    expect(cell.resultKind).toBe('liner');
    expect(cell.isBatterOut).toBe(true);
  });

  it('ファウルフライ(Fof)はF+数字の表記になる', () => {
    const cell = sb.top.slots[2].cellsByInning[1][0];
    expect(cell.finalLabel).toBe('ファースト邪飛');
    expect(cell.resultNotation).toBe('F3');
    expect(cell.resultKind).toBe('foulfly');
    expect(cell.isBatterOut).toBe(true);
  });

  it('邪飛・直飛でもイニング内アウト順が正しく進む', () => {
    expect(sb.top.slots[0].cellsByInning[1][0].outOrderInInning).toBe(1);
    expect(sb.top.slots[1].cellsByInning[1][0].outOrderInInning).toBe(2);
    expect(sb.top.slots[2].cellsByInning[1][0].outOrderInInning).toBe(3);
  });
});

describe('buildScorebookData (打席途中の3アウトチェンジ=中断打席)', () => {
  // 実データ(scorer_game.txt 2回裏)のパターン: 打席の途中で走者が盗塁死になり
  // 3アウト成立、打席が完了しないままイニングが終わる。
  // 表: 2アウト後、攻3が単打で出塁 → 攻4の打席中(2球目の後)に盗塁死で3アウト。
  const cd = [
    'It01', 'Na', 'Fo--74O00',
    'Nb', 'Na', 'Go--54Th2O01',
    'Nb', 'Na', 'H1--64J01',
    'Nb', 'Na', 'Pb', 'Pl', 'RfTb1Th5T12', 'At01Lb0',
    'Ib01', 'Na', 'Fo--84O00', 'Ab01', 'Ah',
  ];
  const { savedGame } = convertScorerGame(makeGdf(cd));
  const { gameState, gameInfo, lineups, pitches } = savedGame.data;
  const sb = buildScorebookData(pitches, lineups, gameInfo, gameState);

  it('中断打席には結果表記もアウト採番も付けない(投球マークのみ)', () => {
    const cell = sb.top.slots[3].cellsByInning[1][0];
    expect(cell.incompletePA).toBe(true);
    expect(cell.resultNotation).toBe('');
    expect(cell.resultKind).toBe('incomplete');
    expect(cell.isBatterOut).toBe(false);
    expect(cell.outOrderInInning).toBeNull();
    expect(cell.pitchMarks.length).toBe(2); // ボール+見逃しの2球は残す
  });

  it('中断打席は打席数・打数に数えない', () => {
    const t = sb.top.playerTotals.find((p) => p.name === '攻4');
    expect(t.PA).toBe(0);
    expect(t.AB).toBe(0);
  });

  it('盗塁死した走者(攻3)が3アウト目として採番される', () => {
    const cell = sb.top.slots[2].cellsByInning[1][0];
    expect(cell.outOnBasesOrderInInning).toBe(3);
  });

  it('相手投手の対戦打者数に中断打席を含めない', () => {
    // 表の打者(攻1〜攻4)と対戦したのは後攻チームの投手
    const p = sb.bottom.pitcherStats[0];
    expect(p.battersFaced).toBe(3); // 攻4の中断打席は含めない
  });
});

describe('buildScorebookData (最終球より後のイベントが先行走者を進める場合の回帰テスト)', () => {
  // 攻1が四球で出塁 → 攻2の二塁打で1塁走者(攻1)が自動的に3塁まで進む →
  // その二塁打の"直後"(次打者の初球より前)に記録された暴投イベントで
  // 攻1が本塁へ生還する、というpitches配列を直接組み立てる。
  // (実際のアプリでは「＋進塁」ボタンで打席の直後にこの種のイベントが挿入される)
  const pitches = [
    { course: null, type: '-', result: 'ボール', inning: 1, isTop: true, batter: 1, pitchNumber: 1, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: 'ボール', inning: 1, isTop: true, batter: 1, pitchNumber: 2, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: 'ボール', inning: 1, isTop: true, batter: 1, pitchNumber: 3, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: 'ボール', inning: 1, isTop: true, batter: 1, pitchNumber: 4, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: 'レフト二塁打', inning: 1, isTop: true, batter: 2, pitchNumber: 1, pitcherName: 'P', batterName: 'A2', batterBats: '右', isEvent: false, runners: { first: true, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: '3塁走者 暴投で本塁へ', inning: 1, isTop: true, batter: 2, pitchNumber: '-', pitcherName: 'P', batterName: 'A2', batterBats: '右', isEvent: true, runners: { first: false, second: true, third: false }, outs: 0 },
  ];
  const gameInfo = { date: '2026-07-13', teamTop: 'T', teamBottom: 'B' };
  const gameState = { inning: 1, isTop: true, runs: { top: [1, 0, 0, 0, 0, 0, 0, 0, 0], bottom: [0, 0, 0, 0, 0, 0, 0, 0, 0] } };

  it('二塁打で3塁まで進んだ走者が、直後の暴投イベントで正しく生還と判定される', () => {
    const sb = buildScorebookData(pitches, null, gameInfo, gameState);
    const originCell = sb.top.slots[0].cellsByInning[1][0]; // A1の四球セル
    expect(originCell.scored).toBe(true);
    expect(originCell.basesReachedFinal).toBe(4);
    expect(sb.top.inningSummary[0].R).toBe(1);
  });
});

describe('buildScorebookData (振り逃げの回帰テスト)', () => {
  // 第3ストライクを落球し、打者が生きて一塁に出塁するケース。
  // 「三振」の文字を含むがアウトではないため、K表記や打者アウト扱いにしてはいけない。
  const pitches = [
    { course: null, type: '-', result: 'ストライク', inning: 1, isTop: true, batter: 1, pitchNumber: 1, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: '空振り', inning: 1, isTop: true, batter: 1, pitchNumber: 2, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
    { course: null, type: '-', result: '振り逃げ', inning: 1, isTop: true, batter: 1, pitchNumber: 3, pitcherName: 'P', batterName: 'A1', batterBats: '右', isEvent: false, runners: { first: false, second: false, third: false }, outs: 0 },
  ];
  const gameInfo = { date: '2026-07-13', teamTop: 'T', teamBottom: 'B' };
  const gameState = { inning: 1, isTop: true, runs: { top: [0, 0, 0, 0, 0, 0, 0, 0, 0], bottom: [0, 0, 0, 0, 0, 0, 0, 0, 0] } };

  it('振り逃げで出塁した打者をアウト扱いにせず、Kとは異なる表記にする', () => {
    const sb = buildScorebookData(pitches, null, gameInfo, gameState);
    const cell = sb.top.slots[0].cellsByInning[1][0];
    expect(cell.isBatterOut).toBe(false);
    expect(cell.basesReachedInitial).toBe(1);
    expect(cell.outOrderInInning).toBeNull();
    expect(cell.resultNotation).not.toBe('K');
  });
});
