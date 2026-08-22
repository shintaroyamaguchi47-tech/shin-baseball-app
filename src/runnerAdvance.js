// ============================================================
// 打席結果の「自動進塁」を実際の走塁に補正するためのユーティリティ。
//
// このアプリは打席結果(単打・二塁打など)から走者の進塁を機械的に決めている。
// しかし実際には、1死2塁の単打で
//   ・2塁走者が生還して1塁     ・2塁走者が生還し送球間に打者走者が2塁
//   ・2塁走者が本塁で憤死       ・打者走者だけが送球間に進塁
// のように結果が分かれる。
//
// 記録のデータ構造(pitches)は変えず、既存の走者イベント記録
// (「2塁走者 打球で本塁へ」「1塁走者が本塁憤死」など)を自動生成することで
// 補正を表現する。こうすることで rebuildGameStateFromPitches / playByPlay.js /
// scorebookData.js のいずれも追加対応なしに補正後の塁状況を再現できる。
// ============================================================

// 走者の識別子。'batter' は打者走者(その打席で出塁した打者)。
export const ADVANCE_ORDER = ['third', 'second', 'first', 'batter'];

export const RUNNER_LABEL = { third: '3塁走者', second: '2塁走者', first: '1塁走者', batter: '打者走者' };

// 塁の位置。1-3=各塁, 4=生還
export const BASE_LABEL = { 1: '1塁', 2: '2塁', 3: '3塁', 4: '本塁' };

const ORIGINAL_BASE = { first: 1, second: 2, third: 3 };

// 補正イベントの理由。打球そのもので進んだ走者と、送球の間に進んだ打者走者を書き分ける。
const REASON_RUNNER = '打球';
const REASON_BATTER = '送球間';

// 走者が動く可能性がある打席結果(この結果のときに進塁確認を出す)。
// 打者が出塁した打席に加えて、ゴロで打者がアウトになった打席も対象にする
// (1死1塁の三ゴロで1塁走者が2塁へ進むなど、走者の動きは打球ごとに違うため)
const ADJUSTABLE_EVENT_TYPES = new Set(['single', 'double', 'triple', 'error', 'ground_out', 'double_play']);

export function isAdjustableEventType(eventType) {
  return ADJUSTABLE_EVENT_TYPES.has(eventType);
}

/**
 * 打席結果による自動進塁の結果を、走者の識別子つきで求める。
 * App.jsx の advanceGameState と同一のルール(意図的に重複させて整合を保つ)。
 * @param {{first:boolean, second:boolean, third:boolean}} runnersBefore 打席前の塁状況
 * @param {string} eventType single/double/triple/homerun/walk/other/error/sac_bunt/sac_fly/out
 * @returns {Object} 走者識別子 -> 到達位置(1-3=塁, 4=生還)。塁上に残らない走者は含まない
 */
export function autoPositions(runnersBefore, eventType) {
  let b1 = runnersBefore?.first ? 'first' : null;
  let b2 = runnersBefore?.second ? 'second' : null;
  let b3 = runnersBefore?.third ? 'third' : null;
  const pos = {};
  const score = (id) => { if (id) pos[id] = 4; };

  if (eventType === 'walk' || eventType === 'other') {
    if (b1 && b2 && b3) { score(b3); b3 = b2; b2 = b1; }
    else if (b1 && b2) { b3 = b2; b2 = b1; }
    else if (b1) { b2 = b1; }
    b1 = 'batter';
  } else if (eventType === 'single' || eventType === 'error') {
    score(b3); b3 = b2; b2 = b1; b1 = 'batter';
  } else if (eventType === 'double') {
    score(b3); score(b2); b3 = b1; b2 = 'batter'; b1 = null;
  } else if (eventType === 'triple') {
    score(b3); score(b2); score(b1); b3 = 'batter'; b2 = null; b1 = null;
  } else if (eventType === 'homerun') {
    score(b3); score(b2); score(b1); score('batter'); b1 = null; b2 = null; b3 = null;
  } else if (eventType === 'sac_bunt') {
    score(b3); b3 = b2; b2 = b1; b1 = null;
  } else if (eventType === 'sac_fly') {
    score(b3); b3 = null;
  } else if (eventType === 'ground_out' || eventType === 'double_play') {
    // ゴロで打者が一塁でアウトになると、フォースの走者(その走者より後ろの塁が
    // すべて埋まっている走者)は進むしかない。併殺打はフォースの先頭走者が
    // 打者と一緒にアウトになる(アウト数は打席結果側で数えているので、
    // ここでは塁上から消えるだけ)。
    const [o1, o2, o3] = [b1, b2, b3];
    if (o1 && o2 && o3) score(o3); // 満塁: 3塁走者は押し出されて生還
    b1 = null;
    if (eventType === 'ground_out') { b2 = o1 || o2; b3 = o1 && o2 ? o2 : o3; }
    else if (o1) { b2 = null; b3 = o2 || o3; }
    else if (o3) { b3 = null; }
    else { b2 = null; }
  }
  // 'out'(三振・フライなど) は走者に変化なし

  if (b1) pos[b1] = 1;
  if (b2) pos[b2] = 2;
  if (b3) pos[b3] = 3;
  return pos;
}

/**
 * 進塁確認画面に出す選択肢を組み立てる。
 * 自動進塁より手前の塁へは戻せない(押し出し・帳簿上の表現ができないため)ので、
 * 選べるのは「自動進塁の位置 〜 生還」と「アウト」。
 * @param {Object} runnersBefore 打席前の塁状況
 * @param {string} eventType
 * @param {number} outsAfterPlay 打者アウトまで含めた、この打席終了時点のアウト数
 * @returns {Array} [{ id, label, autoPos, choices: [{ value, label }] }]
 */
export function buildAdvanceChoices(runnersBefore, eventType, outsAfterPlay = 0) {
  const auto = autoPositions(runnersBefore, eventType);
  return ADVANCE_ORDER.filter((id) => auto[id] !== undefined).map((id) => {
    const a = auto[id];
    const choices = [];
    for (let b = a; b <= 4; b++) {
      choices.push({ value: b, label: b === 4 ? '生還' : BASE_LABEL[b] });
    }
    // 自動進塁だと生還してしまう走者をアウトにするには、打席結果より前に
    // アウトの記録を差し込む必要がある。そこで3アウト目になる場合は
    // 打席結果より先に攻守交代が成立してしまうため、選択肢から外す。
    const needsPreOut = a === 4 && id !== 'batter';
    if (!(needsPreOut && outsAfterPlay + 1 >= 3)) {
      choices.push({ value: 'out', label: a === 4 || a === 3 ? '本塁アウト' : 'アウト' });
    }
    return { id, label: RUNNER_LABEL[id], autoPos: a, choices };
  });
}

/**
 * 自動進塁と実際の進塁の差分を、走者イベント記録の文言に変換する。
 * @param {Object} runnersBefore 打席前の塁状況
 * @param {string} eventType
 * @param {Object} plan 走者識別子 -> 到達位置(1-4) または 'out'
 * @returns {{ pre: string[], post: string[] }}
 *   pre : 打席結果の記録より「前」に差し込むイベント(自動進塁だと生還してしまう走者のアウト)
 *   post: 打席結果の記録より「後」に追加するイベント(追加進塁・走塁死)
 */
export function buildAdvanceEvents(runnersBefore, eventType, plan) {
  const auto = autoPositions(runnersBefore, eventType);
  const pre = [];
  const post = [];
  ADVANCE_ORDER.forEach((id) => {
    const a = auto[id];
    if (a === undefined) return;
    const want = plan?.[id];
    if (want === undefined || want === null || want === a) return;
    const reason = id === 'batter' ? REASON_BATTER : REASON_RUNNER;
    if (want === 'out') {
      if (a === 4) {
        // 自動進塁では生還してしまうため、打席結果より前に走者を消す
        const orig = ORIGINAL_BASE[id];
        if (orig) pre.push(`${orig}塁走者が本塁憤死`);
      } else {
        post.push({ base: a, text: `${a}塁走者が${a === 3 ? '本塁憤死' : '走塁死'}` });
      }
      return;
    }
    if (want > a) post.push({ base: a, text: `${a}塁走者 ${reason}で${BASE_LABEL[want]}へ` });
  });
  // 前を走る走者(=塁が上位)から順に処理しないと、進塁先の塁が
  // まだ埋まったままになり走者を上書きしてしまう
  post.sort((x, y) => y.base - x.base);
  return { pre, post: post.map((p) => p.text) };
}

/**
 * 進塁プランから、打席終了時点の塁状況・得点・アウト数を求める(確認画面のプレビュー用)。
 * @returns {{ runners:{first:boolean,second:boolean,third:boolean}, runs:number, outs:number }}
 */
export function previewAdvanceResult(runnersBefore, eventType, plan, outsAfterPlay = 0) {
  const auto = autoPositions(runnersBefore, eventType);
  const runners = { first: false, second: false, third: false };
  const BASE_KEY = { 1: 'first', 2: 'second', 3: 'third' };
  let runs = 0;
  let outs = outsAfterPlay;
  ADVANCE_ORDER.forEach((id) => {
    const a = auto[id];
    if (a === undefined) return;
    const want = plan?.[id] ?? a;
    if (want === 'out') { outs++; return; }
    if (want === 4) { runs++; return; }
    runners[BASE_KEY[want]] = true;
  });
  return { runners, runs, outs: Math.min(3, outs) };
}

// 進塁補正で生還した走者を自責点に数えるかどうか。
// 打球・送球間での生還は投手の自責点になる(エラー由来の '進塁'/'その他' は除く)。
const EARNED_ADVANCE_REASONS = [REASON_RUNNER, REASON_BATTER];
export function isEarnedAdvanceReason(reason) {
  return EARNED_ADVANCE_REASONS.includes(reason);
}

// 塁状況の表示用テキスト(例: '1・3塁', '走者なし', '満塁')
export function describeRunners(runners) {
  const on = [];
  if (runners?.first) on.push('1');
  if (runners?.second) on.push('2');
  if (runners?.third) on.push('3');
  if (on.length === 0) return '走者なし';
  if (on.length === 3) return '満塁';
  return `${on.join('・')}塁`;
}
