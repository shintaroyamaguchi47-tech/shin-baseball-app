// ============================================================
// スコアブック(伝統的な野球記録用紙)PDF出力のためのデータ変換。
// pitches配列を playByPlay.js と同じ走者シミュレーションで解析し、
// 「打順×イニング」のマス目(ダイヤモンド1つ=1打席)へ変換する。
//
// 各マス目(Cell)は「その打席の結果」だけでなく、その打席で出塁した
// 走者がイニング終了までにどう進塁/生還/アウトになったかも保持する
// (盗塁・暴投・捕逸・ボーク・牽制死などは元の打席のマス目に追記する、
// 実際のスコアブックの書き方に合わせるため)。
// ============================================================

import { buildPlayByPlayReport, parseFieldResult, isIncompletePA } from './playByPlay.js';

const POS_NUM = {
  'ピッチャー': 1, 'キャッチャー': 2, 'ファースト': 3, 'セカンド': 4, 'サード': 5,
  'ショート': 6, 'レフト': 7, 'センター': 8, 'ライト': 9,
};

// RBIを記録しない結果(エラーで出塁した打席は打点なし)
const RBI_ELIGIBLE = new Set(['single', 'double', 'triple', 'homerun', 'walk', 'other', 'sac_bunt', 'sac_fly']);

function fielderNum(fielderName) { return POS_NUM[fielderName] || null; }

// 最終結果の表記(守備位置番号ベース)＋描画用の種別(kind)を返す。
// スコアラー様式に合わせ、三振は最終ストライクの空振り/見逃しでKs/Kcを分ける。
// 飛球はkind='fly'として番号にアーチ、ライナーは直線、犠打/犠飛は四角枠(レンダラー側)。
// throwTo(GDF由来の送球先チェーン)があれば実際の守備経路(6-4, 3-1等)を表記し、
// 無い場合のみ一般的な想定(内野ゴロ→一塁送球)で近似する。
function resultNotation(pf, finalLabel, lastStrikeType, throwTo) {
  if (!pf) {
    // 中断打席(打席途中で3アウト): 結果は無い。投球マークだけを残す
    if (isIncompletePA(finalLabel)) return { text: '', kind: 'incomplete' };
    if (['三振', 'スリーバント失敗'].includes(finalLabel)) {
      // 公式(bbscorer): K=見逃し三振, Ks=空振り三振
      return lastStrikeType === 'looking'
        ? { text: 'K', kind: 'k_look' }
        : { text: 'Ks', kind: 'k_swing' };
    }
    if (finalLabel === '振り逃げアウト') return { text: 'Ks', kind: 'k_swing' };
    if (finalLabel === '振り逃げ') return { text: '振逃', kind: 'dropped3' };
    if (finalLabel === '四球') return { text: 'B', kind: 'walk' };
    if (finalLabel === '死球') return { text: 'HBP', kind: 'hbp' };
    if (finalLabel === 'その他出塁') return { text: 'DIB', kind: 'other' };
    return { text: finalLabel || '', kind: 'other' };
  }
  const n = fielderNum(pf.fielder);
  const num = n ?? '?';
  // 実際の送球経路(捕球者→送球先...)。連続する同一番号は畳む(自力アウト等)
  const route = () => [num, ...(throwTo || [])]
    .filter((v, i, a) => i === 0 || v !== a[i - 1])
    .join('-');
  const hasRoute = throwTo && throwTo.length > 0;
  switch (pf.suffix) {
    case '安': return { text: `${num}`, kind: 'hit' };
    case '二塁打': return { text: `${num}`, kind: 'hit2' };
    case '三塁打': return { text: `${num}`, kind: 'hit3' };
    case '本塁打': return { text: `${num}`, kind: 'hr' };
    case 'ゴロ': return { text: hasRoute ? route() : (n === 3 ? '3' : `${num}-3`), kind: 'ground' };
    case '飛': return { text: `${num}`, kind: 'fly' };
    case '邪飛': return { text: `F${num}`, kind: 'foulfly' };
    case '直飛': return { text: `${num}`, kind: 'liner' };
    case '併殺打': return { text: hasRoute ? route() : (n === 3 ? '3-6' : `${num}-4-3`), kind: 'dp' };
    // 公式: 捕球エラー=Ef, 送球エラー=Et(守備位置番号+記号)
    case '捕球エラー': case '落球エラー': return { text: `${num}Ef`, kind: 'error' };
    case '送球エラー': return { text: `${num}Et`, kind: 'error' };
    case '野手選択': return { text: hasRoute ? `Fc ${route()}` : 'Fc', kind: 'fc' };
    case '犠打': return { text: hasRoute ? route() : (n === 3 ? '3' : `${num}-3`), kind: 'sac' };
    case '犠飛': return { text: `${num}`, kind: 'sacfly' };
    case '安+エラー': case '二塁打+エラー': case '三塁打+エラー': return { text: `${num}+E`, kind: 'hit' };
    default: return { text: `${num}`, kind: 'other' };
  }
}

// 投球1球ぶんのマーク種別
function pitchMarkType(result) {
  if (result.startsWith('牽制')) return 'pickoff';
  if (['ボール', 'ウエスト'].includes(result)) return 'ball';
  if (result === 'ストライク') return 'looking';
  if (['空振り', 'バント空振り'].includes(result)) return 'swing';
  if (['ファウル', 'バントファウル'].includes(result)) return 'foul';
  if (result === '死球') return 'hbp';
  return 'other';
}

// 本塁打/二塁打/三塁打/併殺打などのフライ・ライナー・ゴロ区別(playByPlay.js内の
// getBallFlightと同一ロジック。モジュール間の独立性を保つため意図的に重複させる)
function ballFlight(res) {
  if (!res) return null;
  if (res.includes('本塁打')) return 'hr';
  if (['ゴロ', '併殺打', 'バント'].some((w) => res.includes(w))) return 'grounder';
  if (['直', 'ライナー', '安', '二塁打', '三塁打'].some((w) => res.includes(w))) return 'liner';
  return 'fly';
}

function newCell(play) {
  const pf = parseFieldResult(play.finalLabel);
  const pitchMarks = play.pitchRows
    .filter((r) => !r.isEvent)
    .map((r) => ({ type: pitchMarkType(r.label), label: r.label }));
  // 三振のKs/Kc判定用に、最後のストライク種別(見逃し/空振り)を取る
  const lastStrike = [...pitchMarks].reverse().find((m) => m.type === 'looking' || m.type === 'swing');
  const res = resultNotation(pf, play.finalLabel, lastStrike ? lastStrike.type : null, play.throwTo);
  return {
    key: play.key,
    inning: play.inning,
    isTop: play.isTop,
    incompletePA: isIncompletePA(play.finalLabel),
    battingSlot: play.batter,
    batterName: play.batterName,
    batterPos: play.batterPos,
    pitcherName: play.pitcherName,
    finalLabel: play.finalLabel,
    eventType: play.eventType,
    resultNotation: res.text,
    resultKind: res.kind,
    flight: play.flight || ballFlight(play.finalLabel),
    fielder: pf ? pf.fielder : null,
    isBatterOut: play.isOut,
    isHit: play.isHit,
    isBB: play.isBB,
    isError: play.isError,
    pitchMarks,
    outOrderInInning: null,
    outOnBasesOrderInInning: null,
    outOnBasesReason: null,
    basesReachedInitial: 0,
    basesReachedFinal: 0,
    advancementNotes: [],
    // 各塁(2/3/home=4)へ「何番打者の打席で」進んだか。スコアラー様式の隅数字用。
    // 打者自身の到達(初期塁)は記録しない(結果記号で示すため)。
    reachedBy: {},
    // 盗塁(S)/暴投(WP)/捕逸(PB)/ボーク(BK)で進んだ塁→{code, link}。隅に数字の代わりに表示。
    // link は投球列との対応を示す a,b,c...。同じ文字がこの打者の投球列にも付く。
    advanceMarks: {},
    // この打者の打席中に起きた走者イベントのリンク文字。{投球index: 'a'} で投球列に重ねる。
    pitchLinks: {},
    rbi: 0,
    scored: false,
    scoredUnearned: false, // 非自責の生還(エラー絡み)。得点の中央マークを ●自責 / ○非自責 で分ける
    strandedRunner: false, // 出塁したが残塁(中央に ℓ を描く)
    hitX: play.hitX,
    hitY: play.hitY,
    hasHitLocation: play.hasHitLocation,
  };
}

// 打席結果による自動進塁(App.jsxのadvanceGameStateと同一ルール)。
// 走者を表すのは実際の走者名ではなく「元の打席セル」への参照そのもの。
// 進塁・生還のたびに参照先セルのbasesReachedFinal/scoredを直接更新する。
function applyAutoMovement(bases, eventType, batterCell, order) {
  const b = { ...bases };
  const scoredCells = [];
  // 打者自身以外の走者が新しい塁へ進んだら「何番打者の打席で」を記録する
  const stamp = (cell, n) => { if (cell && cell !== batterCell && order) cell.reachedBy[n] = order; };
  const setBase = (n, cell) => { b[n] = cell; if (cell) { cell.basesReachedFinal = n; stamp(cell, n); } };
  // エラー絡み(打者がエラーで出塁したプレー)で入った得点は非自責とみなす(近似)
  const score = (cell) => { if (cell) { cell.basesReachedFinal = 4; cell.scored = true; if (eventType === 'error') cell.scoredUnearned = true; stamp(cell, 4); scoredCells.push(cell); } };

  if (eventType === 'walk' || eventType === 'other') {
    if (b[1] && b[2] && b[3]) { score(b[3]); setBase(3, b[2]); setBase(2, b[1]); }
    else if (b[1] && b[2]) { setBase(3, b[2]); setBase(2, b[1]); }
    else if (b[1]) { setBase(2, b[1]); }
    setBase(1, batterCell);
  } else if (eventType === 'single' || eventType === 'error') {
    if (b[3]) score(b[3]);
    setBase(3, b[2]); setBase(2, b[1]); setBase(1, batterCell);
  } else if (eventType === 'double') {
    if (b[3]) score(b[3]);
    if (b[2]) score(b[2]);
    setBase(3, b[1]); setBase(2, batterCell); setBase(1, null);
  } else if (eventType === 'triple') {
    if (b[3]) score(b[3]);
    if (b[2]) score(b[2]);
    if (b[1]) score(b[1]);
    setBase(3, batterCell); setBase(2, null); setBase(1, null);
  } else if (eventType === 'homerun') {
    if (b[3]) score(b[3]);
    if (b[2]) score(b[2]);
    if (b[1]) score(b[1]);
    score(batterCell);
    setBase(1, null); setBase(2, null); setBase(3, null);
  } else if (eventType === 'sac_bunt') {
    if (b[3]) score(b[3]);
    setBase(3, b[2]); setBase(2, b[1]); setBase(1, null);
  } else if (eventType === 'sac_fly') {
    if (b[3]) score(b[3]);
    setBase(3, null);
  }
  return { bases: b, scoredCells };
}

// イベント行(盗塁/暴投/捕逸/ボーク/牽制死/代走など)を処理し、
// その走者の「元の打席セル」を更新する。App.jsxのrebuildGameStateFromPitches /
// playByPlay.jsのapplyRunnerEventNarrativeと同じ文字列パターンで判定する。
function handleRunnerEvent(bases, text, outCounter, order, link) {
  const runnerKey = text.startsWith('1塁走者') ? 1 : text.startsWith('2塁走者') ? 2 : text.startsWith('3塁走者') ? 3 : null;
  if (!runnerKey) return false; // 進塁リンク文字を消費したか(盗塁/暴投/捕逸/ボークならtrue)
  const origin = bases[runnerKey];
  if (text.includes('が')) {
    const reason = (text.split('が')[1] || '').replace(/。$/, '');
    if (origin) {
      outCounter.n++;
      origin.outOnBasesOrderInInning = outCounter.n;
      origin.outOnBasesReason = reason;
      origin.advancementNotes.push({ text: reason, isOut: true });
    }
    bases[runnerKey] = null;
    return false;
  }
  if (text.includes('に代走')) {
    if (origin) origin.advancementNotes.push({ text: '代走', isOut: false });
    return false;
  }
  const dest = text.match(/で(2塁|3塁|本塁)へ/);
  if (dest) {
    // GDF取込時の「元の打球で自動進塁より先の塁まで進んだ」補正には具体的な理由がないため
    // scorerImport.js側でデフォルト理由「その他」を使っている。スコアブック表示では
    // その場合を「進塁」という読みやすい表記に置き換える。
    const rawReason = (text.split(' ')[1] || '').split('で')[0];
    const reason = rawReason === 'その他' ? '進塁' : rawReason;
    // 盗塁/暴投/捕逸/ボークは公式コード(S/WP/PB/BK)を隅に表示する。
    // それ以外(打球絡みの進塁)は「何番打者で」の数字を表示する。
    const code = reason.includes('盗塁') ? 'S' : reason.includes('暴投') ? 'WP' : reason.includes('捕逸') ? 'PB' : reason.includes('ボーク') ? 'BK' : null;
    const markBase = (base) => { if (!origin) return; if (code) origin.advanceMarks[base] = { code, link: link || null }; else if (order) origin.reachedBy[base] = order; };
    if (dest[1] === '2塁') { if (origin) { origin.basesReachedFinal = 2; markBase(2); origin.advancementNotes.push({ text: `${reason}→2塁`, isOut: false }); } bases[2] = origin; bases[runnerKey] = null; }
    else if (dest[1] === '3塁') { if (origin) { origin.basesReachedFinal = 3; markBase(3); origin.advancementNotes.push({ text: `${reason}→3塁`, isOut: false }); } bases[3] = origin; bases[runnerKey] = null; }
    else { if (origin) { origin.basesReachedFinal = 4; origin.scored = true; if (reason === '進塁') origin.scoredUnearned = true; markBase(4); origin.advancementNotes.push({ text: `${reason}→生還`, isOut: false }); } bases[runnerKey] = null; }
    return !!code; // 盗塁/暴投/捕逸/ボークならリンク文字を消費
  }
  const reason = text.split(' ')[1] || '';
  if (origin && reason) origin.advancementNotes.push({ text: reason, isOut: false });
  return false;
}

function emptyPlayerTotal(name, pos, bats) {
  return { name, pos, bats, PA: 0, AB: 0, R: 0, H: 0, H2: 0, H3: 0, HR: 0, RBI: 0, BB: 0, HBP: 0, K: 0, SB: 0, SH: 0, SF: 0 };
}

function accumulatePlayerTotal(totals, cell) {
  const key = cell.batterName;
  if (!totals.has(key)) totals.set(key, emptyPlayerTotal(cell.batterName, cell.batterPos, null));
  if (cell.incompletePA) return; // 中断打席は打席数に数えない(選手行は作る)
  const t = totals.get(key);
  t.PA++;
  const { eventType, finalLabel } = cell;
  const isHit = ['single', 'double', 'triple', 'homerun'].includes(eventType);
  const isWalkLike = finalLabel === '四球';
  const isHbp = finalLabel === '死球';
  const isSac = eventType === 'sac_bunt' || eventType === 'sac_fly';
  if (isHit) { t.H++; if (eventType === 'double') t.H2++; else if (eventType === 'triple') t.H3++; else if (eventType === 'homerun') t.HR++; }
  if (isWalkLike) t.BB++;
  else if (isHbp) t.HBP++;
  else if (finalLabel === 'その他出塁') t.BB++; // 打撃妨害等は四死球列にまとめる
  else if (eventType === 'sac_bunt') t.SH++;
  else if (eventType === 'sac_fly') t.SF++;
  if (['三振', 'スリーバント失敗', '振り逃げアウト', '振り逃げ'].includes(finalLabel)) t.K++;
  if (!isWalkLike && !isHbp && !isSac && finalLabel !== 'その他出塁') t.AB++;
  t.RBI += cell.rbi;
  if (cell.scored) t.R++;
}

function emptyPitcherStat(name, throws) {
  return { name, throws, outs: 0, pitches: 0, battersFaced: 0, hits: 0, hr: 0, bb: 0, hbp: 0, k: 0, runs: 0, wildPitches: 0, balks: 0 };
}

export function buildScorebookData(pitches, lineups, gameInfo, gameState) {
  const report = buildPlayByPlayReport(pitches);
  const maxInning = Math.max(gameState?.inning || 1, ...report.map((i) => i.inning), 1);

  const allCells = []; // フラットな全セル一覧(集計・脚注用)
  const cellsBySlot = { top: Array.from({ length: 9 }, () => ({})), bottom: Array.from({ length: 9 }, () => ({})) };
  const inningLOB = {}; // `${team}-${inning}` -> 残塁数(半イニング終了時点)

  report.forEach(({ inning, isTop, plays }) => {
    const team = isTop ? 'top' : 'bottom';
    let bases = { 1: null, 2: null, 3: null };
    const outCounter = { n: 0 };
    const linkCounter = { n: 0 }; // 半イニングごとに a,b,c... と振る走者イベントのリンク文字
    plays.forEach((play) => {
      const cell = newCell(play);
      allCells.push(cell);
      const slotArr = cellsBySlot[team][play.batter - 1];
      if (!slotArr[inning]) slotArr[inning] = [];
      slotArr[inning].push(cell);

      // pitchRowsはイベント(盗塁/暴投/捕逸/ボーク等)と投球が実際に起きた順に並んでいる。
      // 最終球(count===null)の時点で打者自身の自動進塁を適用し、それより後に
      // 続くイベント(例: 自身の安打で3塁へ進んだ走者が続けて生還する等)は
      // 更新後のbasesを参照して正しく処理できるようにする。
      const order = play.batter; // この打席の打順(1-9)。走者の進塁を「何番で」と記録するのに使う
      let scoredCells = [];
      let pitchIdx = 0; // この打席で消化した投球数(リンク文字を投球列のどこに付けるか)
      play.pitchRows.forEach((row) => {
        if (row.isEvent) {
          // 盗塁/暴投/捕逸/ボークにはリンク文字(a,b,c...)を割り当て、
          // この打者の投球列(直近の球)と走者の進塁コードの両方に付けて連動させる。
          const link = String.fromCharCode(97 + linkCounter.n);
          const consumed = handleRunnerEvent(bases, row.label || '', outCounter, order, link);
          if (consumed) { cell.pitchLinks[Math.max(0, pitchIdx - 1)] = link; linkCounter.n++; }
          return;
        }
        pitchIdx++;
        if (row.count === null) {
          const moved = applyAutoMovement(bases, play.eventType, cell, order);
          bases = moved.bases;
          scoredCells = moved.scoredCells;
        }
      });
      cell.basesReachedInitial = cell.scored ? 4 : ([1, 2, 3].find((n) => bases[n] === cell) || 0);
      // 打者自身の打席で到達した初期塁はreachedByから除く(結果記号で示すため)
      for (let n = 1; n <= cell.basesReachedInitial; n++) delete cell.reachedBy[n];
      if (play.isOut) { outCounter.n++; cell.outOrderInInning = outCounter.n; }
      if (RBI_ELIGIBLE.has(play.eventType)) cell.rbi = scoredCells.length;
    });
    // 半イニング終了時に塁上に残った走者(残塁)には ℓ を描く
    [1, 2, 3].forEach((n) => { if (bases[n]) bases[n].strandedRunner = true; });
    inningLOB[`${team}-${inning}`] = [1, 2, 3].filter((n) => bases[n]).length;
  });

  const buildTeam = (team, teamName) => {
    const runsArr = (gameState?.runs?.[team]) || [];
    const slots = cellsBySlot[team].map((cellsByInning, idx) => {
      const order = idx + 1;
      // このスロットに登場した打者を時系列順に重複なく抽出(代打/代走を含む選手交代の履歴)
      const occupants = [];
      Object.keys(cellsByInning).map(Number).sort((a, b) => a - b).forEach((inn) => {
        cellsByInning[inn].forEach((c) => {
          const last = occupants[occupants.length - 1];
          if (!last || last.name !== c.batterName) occupants.push({ name: c.batterName, pos: c.batterPos, fromInning: inn });
        });
      });
      return { order, occupants, cellsByInning };
    });

    const inningSummary = [];
    for (let inn = 1; inn <= maxInning; inn++) {
      const cellsThisInning = allCells.filter((c) => c.isTop === (team === 'top') && c.inning === inn);
      const H = cellsThisInning.filter((c) => ['single', 'double', 'triple', 'homerun'].includes(c.eventType)).length;
      const BB = cellsThisInning.filter((c) => c.finalLabel === '四球' || c.finalLabel === 'その他出塁').length;
      const K = cellsThisInning.filter((c) => ['三振', 'スリーバント失敗', '振り逃げアウト', '振り逃げ'].includes(c.finalLabel)).length;
      const E = cellsThisInning.filter((c) => ['捕球エラー', '送球エラー', '落球エラー'].includes(c.finalLabel)).length;
      const pitchCount = pitches.filter((p) => !p.isEvent && p.isTop === (team === 'top') && p.inning === inn && !p.result?.startsWith('牽制')).length;
      inningSummary.push({ inning: inn, H, BB, K, R: Number(runsArr[inn - 1]) || 0, LOB: inningLOB[`${team}-${inn}`] ?? 0, pitchCount, E });
    }

    const playerTotalsMap = new Map();
    allCells.filter((c) => c.isTop === (team === 'top')).forEach((c) => accumulatePlayerTotal(playerTotalsMap, c));
    // 盗塁成功数(元の打席セルのadvancementNotesから「盗塁」を含むものを集計)
    allCells.filter((c) => c.isTop === (team === 'top')).forEach((c) => {
      const sbCount = c.advancementNotes.filter((n) => !n.isOut && n.text.startsWith('盗塁')).length;
      if (sbCount > 0) { const t = playerTotalsMap.get(c.batterName); if (t) t.SB += sbCount; }
    });
    const firstAppearanceOrder = [];
    allCells.filter((c) => c.isTop === (team === 'top')).forEach((c) => { if (!firstAppearanceOrder.includes(c.batterName)) firstAppearanceOrder.push(c.batterName); });
    const playerTotals = firstAppearanceOrder.map((n) => playerTotalsMap.get(n)).filter(Boolean);

    // 投手成績: 相手チームが打者として記録したpitches(=このチームが投げた球)から集計
    const oppIsTop = team !== 'top';
    const pitcherMap = new Map();
    const pitcherOrder = [];
    pitches.filter((p) => p.isTop === oppIsTop && !p.isEvent && !p.result?.startsWith('牽制')).forEach((p) => {
      const name = p.pitcherName || '不明';
      if (!pitcherMap.has(name)) { pitcherMap.set(name, emptyPitcherStat(name, p.pitcherThrows || '右')); pitcherOrder.push(name); }
      pitcherMap.get(name).pitches++;
    });
    allCells.filter((c) => c.isTop === oppIsTop).forEach((c) => {
      const name = c.pitcherName || '不明';
      if (!pitcherMap.has(name)) { pitcherMap.set(name, emptyPitcherStat(name, '右')); pitcherOrder.push(name); }
      const st = pitcherMap.get(name);
      if (!c.incompletePA) st.battersFaced++;
      if (['single', 'double', 'triple', 'homerun'].includes(c.eventType)) st.hits++;
      if (c.eventType === 'homerun') st.hr++;
      if (c.finalLabel === '四球') st.bb++;
      if (c.finalLabel === '死球') st.hbp++;
      if (['三振', 'スリーバント失敗'].includes(c.finalLabel)) st.k++;
      if (c.isBatterOut || c.outOrderInInning) st.outs++;
      if (c.scored) st.runs++;
      c.advancementNotes.forEach((n) => { if (n.text?.includes('暴投')) st.wildPitches++; if (n.text?.includes('ボーク')) st.balks++; });
      if (c.outOnBasesReason && c.outOnBasesReason.includes('走塁死')) { /* 走者自身のアウトはbattersFacedに含めない(既にst.outsへ加算済み) */ }
    });
    // 走者アウト(盗塁死/牽制死等)は打者としての投手成績には計上しないため、
    // st.outsは「打者由来のアウト」のみを既に反映している(上のc.isBatterOut判定)
    const pitcherStats = pitcherOrder.map((n) => pitcherMap.get(n));

    const extraBaseHits = { doubles: [], triples: [], homeruns: [] };
    allCells.filter((c) => c.isTop === (team === 'top')).forEach((c) => {
      const label = `${c.batterName}(${c.inning}回)`;
      if (c.eventType === 'double') extraBaseHits.doubles.push(label);
      else if (c.eventType === 'triple') extraBaseHits.triples.push(label);
      else if (c.eventType === 'homerun') extraBaseHits.homeruns.push(label);
    });

    return { teamName, slots, inningSummary, playerTotals, pitcherStats, extraBaseHits };
  };

  return {
    gameInfo,
    maxInning,
    top: buildTeam('top', gameInfo?.teamTop || '先攻チーム'),
    bottom: buildTeam('bottom', gameInfo?.teamBottom || '後攻チーム'),
  };
}
