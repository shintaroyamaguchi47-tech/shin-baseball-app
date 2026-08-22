// ============================================================
// 打席速報ビルダー
// pitches(投球/イベント記録の配列)を走者の出塁状況までシミュレートし、
// バーチャル高校野球サイトの「打席速報」のような
// 実況文・投球結果テーブル・打球位置図に必要なデータへ変換する。
// advanceGameState (App.jsx) と同じ走者進塁ルールを、
// 走者の「名前」まで追跡できる形に書き換えたもの。
// ============================================================

const FIELD_POS = ['レフト', 'センター', 'ライト', 'サード', 'ショート', 'セカンド', 'ファースト', 'ピッチャー', 'キャッチャー'];

const POS_NUM = {
  'ピッチャー': 1, '投': 1,
  'キャッチャー': 2, '捕': 2,
  'ファースト': 3, '一': 3,
  'セカンド': 4, '二': 4,
  'サード': 5, '三': 5,
  'ショート': 6, '遊': 6,
  'レフト': 7, '左': 7,
  'センター': 8, '中': 8,
  'ライト': 9, '右': 9,
};
const CIRCLED = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨' };
const circledPos = (pos) => { const n = POS_NUM[pos]; return n ? CIRCLED[n] : ''; };

const SUFFIX_LABEL = {
  '安': '安打', '二塁打': '二塁打', '三塁打': '三塁打', '本塁打': '本塁打',
  'ゴロ': 'ゴロ', '飛': 'フライ', '邪飛': 'ファウルフライ', '直飛': 'ライナー', '併殺打': '併殺打',
  '捕球エラー': '捕球エラー', '送球エラー': '送球エラー', '落球エラー': '落球エラー',
  '野手選択': '野手選択', '犠打': '犠打', '犠飛': '犠飛',
  '安+エラー': '安打(相手失策)', '二塁打+エラー': '二塁打(相手失策)', '三塁打+エラー': '三塁打(相手失策)',
};

// 守備位置の略記(スコアブック様式の漢字1字)→正式名。
// 「右ゴロ」「二ゴロ」のように手入力・旧記録で略記された結果も、
// 「ライトゴロ」「セカンドゴロ」と同じ打球結果として扱う。
const FIELD_ABBR = {
  '投': 'ピッチャー', '捕': 'キャッチャー', '一': 'ファースト', '二': 'セカンド', '三': 'サード',
  '遊': 'ショート', '左': 'レフト', '中': 'センター', '右': 'ライト',
};
// 略記は「三振」「二塁打」のように守備位置と紛らわしいため、
// 打席結果として定義された接尾辞と完全に一致したときだけ打球結果とみなす。
const RESULT_SUFFIXES = new Set(Object.keys(SUFFIX_LABEL));

function parseFieldResult(result) {
  if (!result) return null;
  for (const pos of FIELD_POS) { if (result.startsWith(pos)) return { fielder: pos, suffix: result.slice(pos.length) }; }
  const fielder = FIELD_ABBR[result[0]];
  const suffix = result.slice(1);
  if (fielder && RESULT_SUFFIXES.has(suffix)) return { fielder, suffix };
  return null;
}

// 中断打席の判定: 走者アウト等で打席の途中に3アウトが成立すると、最終球が
// 素の投球結果(ボール/ストライク等)のまま打席が終わる。この打席は完了して
// いないため、打者アウト・打席数・打数には数えない(公式規則と同じ)。
const INCOMPLETE_PA_LABELS = new Set(['ボール', 'ストライク', '空振り', 'ファウル', 'バント空振り', 'バントファウル', 'ウエスト']);
function isIncompletePA(finalLabel) {
  return INCOMPLETE_PA_LABELS.has(finalLabel) || (finalLabel || '').startsWith('牽制');
}

// App.jsx の resultToEventType と同じ判定ルール(意図的に重複させて整合を保つ)
function resultToEventType(result) {
  if (result.includes('本塁打')) return 'homerun';
  if (result.includes('三塁打')) return 'triple';
  if (result.includes('二塁打')) return 'double';
  if (result.includes('安')) return 'single';
  if (['エラー', '敵失(エラー)', '野手選択'].some(w => result.includes(w))) return 'error';
  if (result.includes('犠打')) return 'sac_bunt';
  if (result.includes('犠飛')) return 'sac_fly';
  if (result.includes('併殺')) return 'double_play';
  if (result.includes('ゴロ')) return 'ground_out';
  return 'out';
}

function classifyEventType(finalLabel) {
  if (isIncompletePA(finalLabel)) return 'none'; // 中断打席(走者進塁なし・アウトなし)
  if (['三振', 'スリーバント失敗', '振り逃げアウト'].includes(finalLabel)) return 'out';
  if (finalLabel === '振り逃げ') return 'error';
  if (finalLabel === '四球' || finalLabel === '死球') return 'walk';
  if (finalLabel === 'その他出塁') return 'other';
  return resultToEventType(finalLabel);
}

// 打球結果がまだ選ばれていない記録(「打った！」直後の1球)。
// 打者アウトかどうかが決まっていないため、アウトには数えない。
const PENDING_RESULTS = new Set(['インプレー', 'バント']);

// 打席結果1件で成立する打者アウトの数。
// 守備位置の表記(「ライトゴロ」「右ゴロ」)や接尾辞の想定漏れに左右されないよう、
// 打者がアウトになる打席(out/犠打/犠飛)は必ず1アウトとして数える。
function outsAddedFor(finalLabel) {
  if (!finalLabel || isIncompletePA(finalLabel) || PENDING_RESULTS.has(finalLabel)) return 0;
  if (finalLabel.includes('併殺')) return 2;
  return ['out', 'ground_out', 'sac_bunt', 'sac_fly'].includes(classifyEventType(finalLabel)) ? 1 : 0;
}

const getBallFlight = (res) => res.includes('本塁打') ? 'hr'
  : ['ゴロ', '併殺打', 'バント'].some(w => res.includes(w)) ? 'grounder'
  : ['直', 'ライナー', '安', '二塁打', '三塁打'].some(w => res.includes(w)) ? 'liner'
  : 'fly';

// App.jsx の playByPlayData と同じ最終結果ラベル導出ロジック(意図的に重複)
function deriveFinalLabel(nonEvent) {
  const last = nonEvent[nonEvent.length - 1];
  const res = last.result || '';
  if (['安', '塁打', '本塁打', 'インプレー', 'バント'].some(w => res.includes(w))) return res;
  let b = 0, s = 0;
  nonEvent.forEach(p => {
    if (['ボール', 'ウエスト'].includes(p.result)) b++;
    else if (['ストライク', '空振り', 'バント空振り'].includes(p.result)) s++;
    else if (['ファウル', 'バントファウル'].includes(p.result) && s < 2) s++;
  });
  if (res === '振り逃げ') return '振り逃げ';
  if (res === '振り逃げアウト') return '振り逃げアウト';
  if (s >= 3 || res === '三振' || res === 'スリーバント失敗') return res === 'スリーバント失敗' ? 'スリーバント失敗' : '三振';
  if (b >= 4 || ['四球', 'ウエスト'].includes(res)) return '四球';
  if (res === '死球') return '死球';
  return res;
}

// 走者進塁シミュレーション(名前つき)。advanceGameState と同一のルールを識別子付きで実行する。
// allowMovement=false は「この打席で3アウト目が成立する」ケース。advanceGameState と
// 同じく、攻守交代が成立する打席では走者を動かさない(ゴロの押し出し得点も入らない)。
function applyMovement(bases, eventType, batterId, allowMovement = true) {
  const scored = []; // [{ runner, fromBase }]
  let { first, second, third } = bases;
  const scoreFrom = (key, runner) => scored.push({ runner, fromBase: key });
  if (!allowMovement) return { bases: { first, second, third }, scored };
  if (eventType === 'walk' || eventType === 'other') {
    if (first && second && third) { scoreFrom('third', third); third = second; second = first; }
    else if (first && second) { third = second; second = first; }
    else if (first) { second = first; }
    first = batterId;
  } else if (eventType === 'single' || eventType === 'error') {
    if (third) scoreFrom('third', third);
    third = second; second = first; first = batterId;
  } else if (eventType === 'double') {
    if (third) scoreFrom('third', third);
    if (second) scoreFrom('second', second);
    third = first; second = batterId; first = null;
  } else if (eventType === 'triple') {
    if (third) scoreFrom('third', third);
    if (second) scoreFrom('second', second);
    if (first) scoreFrom('first', first);
    third = batterId; second = null; first = null;
  } else if (eventType === 'homerun') {
    if (third) scoreFrom('third', third);
    if (second) scoreFrom('second', second);
    if (first) scoreFrom('first', first);
    first = null; second = null; third = null;
  } else if (eventType === 'sac_bunt') {
    if (third) scoreFrom('third', third);
    third = second; second = first; first = null;
  } else if (eventType === 'sac_fly') {
    if (third) scoreFrom('third', third);
    third = null;
  } else if (eventType === 'ground_out' || eventType === 'double_play') {
    // ゴロで打者が一塁でアウトになると、フォースの走者は進むしかない。
    // 併殺打はフォースの先頭走者が打者と一緒にアウトになる。
    const [o1, o2, o3] = [first, second, third];
    if (o1 && o2 && o3) scoreFrom('third', o3); // 満塁: 3塁走者は押し出されて生還
    first = null;
    if (eventType === 'ground_out') { second = o1 || o2; third = o1 && o2 ? o2 : o3; }
    else if (o1) { second = null; third = o2 || o3; }
    else if (o3) { third = null; }
    else { second = null; }
  }
  return { bases: { first, second, third }, scored };
}

const BASE_LABEL_JA = { first: '一塁', second: '二塁', third: '三塁' };

// isEvent の走者関連イベント(盗塁/暴投/捕逸/ボーク/牽制死/走塁死/代走 など)を処理し、
// bases(名前つき)を更新しつつ実況文を1行追加する。rebuildGameStateFromPitches と同じ文字列パターンで判定する。
function applyRunnerEventNarrative(bases, result, narrative) {
  const runnerKey = result.startsWith('1塁走者') ? 'first' : result.startsWith('2塁走者') ? 'second' : result.startsWith('3塁走者') ? 'third' : null;
  if (!runnerKey) return bases;
  const runner = bases[runnerKey];
  if (result.includes('が')) {
    // アウト系: "{label}が{reason}"
    const reason = result.split('が')[1] || '';
    if (runner) narrative.push(`${runner.name}${circledPos(runner.pos)}、${reason}。`);
    return { ...bases, [runnerKey]: null };
  }
  if (result.includes('に代走')) {
    if (runner) narrative.push(`${runner.name}に代走。`);
    return bases; // 交代後の選手名は記録されていないため識別子は維持する
  }
  // 記録された塁に走者がいない(古い記録の重複補正など)ときは、
  // 進塁先にいる走者を消してしまわないよう何もしない
  if (result.includes('で2塁へ')) {
    if (!runner) return bases;
    const reason = (result.split(' ')[1] || '').split('で')[0];
    narrative.push(`${runner.name}${circledPos(runner.pos)}、${reason}で二塁へ進塁。`);
    const nb = { ...bases, [runnerKey]: null }; nb.second = runner; return nb;
  }
  if (result.includes('で3塁へ')) {
    if (!runner) return bases;
    const reason = (result.split(' ')[1] || '').split('で')[0];
    narrative.push(`${runner.name}${circledPos(runner.pos)}、${reason}で三塁へ進塁。`);
    const nb = { ...bases, [runnerKey]: null }; nb.third = runner; return nb;
  }
  if (result.includes('で本塁へ')) {
    const reason = (result.split(' ')[1] || '').split('で')[0];
    if (runner) narrative.push(`${runner.name}${circledPos(runner.pos)}、${reason}で生還。`);
    return { ...bases, [runnerKey]: null };
  }
  // その場に留まる系の注記(例: "2塁走者 暴投")
  const reason = result.split(' ')[1] || '';
  if (runner && reason) narrative.push(`${runner.name}${circledPos(runner.pos)}、${reason}。`);
  return bases;
}

function buildMainNarrative(batterTag, finalLabel, eventType, pf, scored, basesBefore) {
  const lines = [];
  if (isIncompletePA(finalLabel)) {
    lines.push(`${batterTag}、打席途中で3アウト(攻守交代)。`);
    return lines;
  }
  if (pf) {
    const label = SUFFIX_LABEL[pf.suffix] || pf.suffix;
    if (eventType === 'single' || eventType === 'double' || eventType === 'triple') {
      const isRBI = scored.length > 0;
      const hitWord = eventType === 'single' ? 'ヒット' : eventType === 'double' ? '二塁打' : '三塁打';
      const baseLabel = eventType === 'single' ? '一塁' : eventType === 'double' ? '二塁' : '三塁';
      const desc = isRBI
        ? (eventType === 'single' ? `${pf.fielder}へのタイムリーヒット` : `${pf.fielder}への適時${hitWord}`)
        : `${pf.fielder}への${hitWord}`;
      lines.push(`${batterTag}、${desc}、${baseLabel}進塁。`);
    } else if (eventType === 'homerun') {
      const runCount = scored.length + 1;
      const tag = runCount === 4 ? '満塁' : runCount >= 2 ? `${runCount}ラン` : '';
      lines.push(`${batterTag}、${pf.fielder}への${tag}本塁打！`);
    } else if (eventType === 'error') {
      lines.push(`${batterTag}、${pf.fielder}の${label}で出塁、一塁進塁。`);
    } else if (eventType === 'sac_bunt') {
      lines.push(`${batterTag}、${pf.fielder}への犠打、アウト。`);
    } else if (eventType === 'sac_fly') {
      lines.push(`${batterTag}、${pf.fielder}への犠飛、アウト。`);
    } else {
      lines.push(`${batterTag}、${pf.fielder}${label}、アウト。`);
    }
  } else if (finalLabel === '三振') {
    lines.push(`${batterTag}、三振。`);
  } else if (finalLabel === 'スリーバント失敗') {
    lines.push(`${batterTag}、スリーバント失敗で三振。`);
  } else if (finalLabel === '振り逃げアウト') {
    lines.push(`${batterTag}、振り逃げアウト。`);
  } else if (finalLabel === '振り逃げ') {
    lines.push(`${batterTag}、振り逃げで一塁へ。`);
  } else if (finalLabel === '四球') {
    lines.push(`${batterTag}、四球で一塁へ。`);
  } else if (finalLabel === '死球') {
    lines.push(`${batterTag}、死球で一塁へ。`);
  } else if (finalLabel === 'その他出塁') {
    lines.push(`${batterTag}、出塁。`);
  } else {
    lines.push(`${batterTag}、${finalLabel}。`);
  }
  scored.forEach(({ runner, fromBase }) => {
    lines.push(`${BASE_LABEL_JA[fromBase]}走者・${runner.name}${circledPos(runner.pos)}、本塁生還。`);
  });
  return lines;
}

/**
 * pitches配列から、時系列順のイニング別・打席別の速報データを構築する。
 * 戻り値: [{ inning, isTop, plays: [Play] }]
 * Play: {
 *   key, batter, batterName, batterPos, batterPosMark, batterBats, pitcherName,
 *   pitchRows: [{ isEvent, label, count }],
 *   narrative: string[], finalLabel, eventType,
 *   isHit, isOut, isBB, isError,
 *   hitX, hitY, hasHitLocation, fielder, flight,
 *   count: { balls, strikes, outs }
 * }
 */
export function buildPlayByPlayReport(pitches) {
  const innings = [];
  const getInning = (inning, isTop) => {
    let inn = innings.find(i => i.inning === inning && i.isTop === isTop);
    if (!inn) { inn = { inning, isTop, plays: [] }; innings.push(inn); }
    return inn;
  };

  let bases = { first: null, second: null, third: null };
  let curHalfKey = null;
  let curAbKey = null;
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    const nonEvent = buf.filter(p => !p.isEvent);
    if (!nonEvent.length) { buf = []; return; }
    const last = nonEvent[nonEvent.length - 1];
    const batterId = { name: last.batterName, pos: last.batterPos };
    const batterTag = `${last.batterName}${circledPos(last.batterPos)}`;

    const finalLabel = deriveFinalLabel(nonEvent);
    const eventType = classifyEventType(finalLabel);
    const pf = parseFieldResult(finalLabel);

    // buf を出現順に1回で処理し、走者イベントと打席結果の実況が
    // 実際に起きた順番のまま並ぶようにする(打席結果の後に記録された
    // 進塁イベントは、実況でも打席結果の後ろに続く。逆に打席結果の前に
    // 記録されたイベントは実況でも先に出す)。
    // この打席で3アウト目が成立するなら走者は動かない(攻守交代が先に成立する)
    const outsAdded = outsAddedFor(finalLabel);
    const movementAllowed = (last.outs || 0) + outsAdded < 3;
    let b = 0, s = 0;
    const pitchRows = [];
    const narrative = [];
    let seq = 0;
    let preCount = { b: 0, s: 0 };
    let scored = [];
    buf.forEach(p => {
      if (p.isEvent) {
        pitchRows.push({ isEvent: true, label: p.result });
        bases = applyRunnerEventNarrative(bases, p.result || '', narrative);
        return;
      }
      seq++;
      preCount = { b, s };
      if (['ボール', 'ウエスト'].includes(p.result)) b++;
      else if (['ストライク', '空振り', 'バント空振り'].includes(p.result)) s++;
      else if (['ファウル', 'バントファウル'].includes(p.result) && s < 2) s++;
      const isLast = p === last;
      pitchRows.push({ isEvent: false, seq, label: p.result, count: isLast ? null : `${b}-${s}`, course: p.course ?? null, pitchType: p.type || null });
      if (isLast) {
        const basesBefore = bases;
        const moved = applyMovement(bases, eventType, batterId, movementAllowed);
        bases = moved.bases;
        scored = moved.scored;
        narrative.push(...buildMainNarrative(batterTag, finalLabel, eventType, pf, scored, basesBefore));
      }
    });

    const isHit = ['single', 'double', 'triple', 'homerun'].includes(eventType);
    const isBB = finalLabel === '四球' || finalLabel === '死球';
    const isOut = ['out', 'ground_out', 'double_play', 'sac_bunt', 'sac_fly'].includes(eventType);
    const isError = eventType === 'error';

    const outsAfter = Math.min(3, (last.outs || 0) + outsAdded);
    const finalCount = pf ? preCount : { b, s };

    getInning(last.inning, last.isTop).plays.push({
      key: `${last.inning}-${last.isTop}-${last.batter}-${last.pitchNumber}`,
      inning: last.inning, isTop: last.isTop,
      batter: last.batter, batterName: last.batterName, batterPos: last.batterPos, batterPosMark: circledPos(last.batterPos),
      batterBats: last.batterBats || null,
      pitcherName: last.pitcherName,
      pitchRows,
      narrative,
      finalLabel, eventType,
      isHit, isOut, isBB, isError,
      hasHitLocation: last.hitX !== undefined && last.hitY !== undefined,
      hitX: last.hitX, hitY: last.hitY,
      fielder: pf ? pf.fielder : null,
      flight: pf ? getBallFlight(finalLabel) : null,
      throwTo: last.throwTo || null,
      count: { balls: finalCount.b, strikes: finalCount.s, outs: outsAfter },
    });
    buf = [];
  };

  pitches.forEach(p => {
    const halfKey = `${p.inning}-${p.isTop}`;
    if (halfKey !== curHalfKey) {
      flush();
      bases = { first: null, second: null, third: null };
      curHalfKey = halfKey;
      curAbKey = null;
    }
    if (p.isEvent) { buf.push(p); return; }
    const abKey = `${p.inning}-${p.isTop}-${p.batter}`;
    if (abKey !== curAbKey) { flush(); curAbKey = abKey; }
    buf.push(p);
  });
  flush();

  return innings;
}

export { circledPos, parseFieldResult, isIncompletePA, outsAddedFor };
