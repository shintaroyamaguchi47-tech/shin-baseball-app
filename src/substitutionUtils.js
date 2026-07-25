// 選手交代(現在時点・さかのぼり挿入の両方)のユーティリティ。
//
// 記録(pitches)は1球ごとに打者名・投手名を持つ非正規化データのため、
// 交代を後から挿入するときは「交代イベントの挿入」だけでなく
// 「それ以降の記録の打者名・投手名の書き換え」もセットで行う必要がある。

// 先発オーダーのスロット数(打順9人 + 控/投)。これ以降の要素はオーダー設定で足した控え選手。
export const STARTING_SLOTS = 10;

const PITCHER_POS = ['投', '1', '①'];

export const isPitcherPos = (pos) => PITCHER_POS.includes(pos);

const orderLabelOf = (order) => (order === 10 ? '控/投' : `${order}番`);

// 交代イベントの表示テキスト。試合中の交代とさかのぼり挿入で同じ形式を使い、
// スコアブック・レポート側の表示や解析が同じ扱いになるようにする。
export function buildSubstitutionEventText({ order, oldPos, oldName, newPos, newName, type, shift = null }) {
  const shiftText = shift ? ` / [移]${shift.name || '?'} ${newPos}→${shift.toPos}` : '';
  return `選手交代: [退]${orderLabelOf(order)}/${oldPos || '?'} ${oldName || '不明'} ➡️ [入]${newPos} ${newName} (${type})${shiftText}`;
}

const toSlotPlayer = (record, fallback) => ({
  name: record.batterName,
  pos: record.batterPos || fallback?.pos || '未',
  bats: record.batterBats || fallback?.bats || '右',
  throws: record.batterThrows || fallback?.throws || '右',
});

// index の時点で、その打順スロットに入っていた選手を記録から推定する。
// 直前の記録 → 直後の記録 → 現在のオーダー の順にさかのぼる。
export function findSlotPlayerAt(records, index, side, order, fallback = null) {
  const list = Array.isArray(records) ? records : [];
  const at = Math.max(0, Math.min(index ?? list.length, list.length));
  const isTop = side === 'top';
  const matches = (p) => p && !p.isEvent && p.isTop === isTop && p.batter === order && p.batterName;
  for (let i = at - 1; i >= 0; i--) if (matches(list[i])) return toSlotPlayer(list[i], fallback);
  for (let i = at; i < list.length; i++) if (matches(list[i])) return toSlotPlayer(list[i], fallback);
  if (!fallback) return null;
  return { name: fallback.name, pos: fallback.pos || '未', bats: fallback.bats || '右', throws: fallback.throws || '右' };
}

// index の時点で、そのチームが誰を投げさせていたかを記録から推定する。
// 投手名は「相手が打者として記録した投球」に入っているため、表裏が逆の記録を見る。
export function findPitcherAt(records, index, side, fallback = null) {
  const list = Array.isArray(records) ? records : [];
  const at = Math.max(0, Math.min(index ?? list.length, list.length));
  const isTop = side === 'top';
  const matches = (p) => p && p.isTop !== isTop && p.pitcherName;
  for (let i = at - 1; i >= 0; i--) if (matches(list[i])) return { name: list[i].pitcherName, throws: list[i].pitcherThrows || '右' };
  for (let i = at; i < list.length; i++) if (matches(list[i])) return { name: list[i].pitcherName, throws: list[i].pitcherThrows || '右' };
  if (!fallback) return null;
  return { name: fallback.name, throws: fallback.throws || '右' };
}

// index の時点のオーダー(打順1〜10のスロット)を記録から復元する。
// さかのぼり交代のモーダルで「その場面の退く選手」を正しく表示するために使う。
export function lineupSnapshotAt(records, index, currentLineup, side) {
  const lineup = Array.isArray(currentLineup) ? currentLineup : [];
  return lineup.map((slot, i) => {
    const found = findSlotPlayerAt(records, index, side, i + 1, slot);
    return { ...slot, ...found };
  });
}

// 交代イベントを index の直前に挿入し、それ以降の記録の選手名を書き換える。
// 書き換えは「退いた選手の名前がまだ残っている記録」だけを対象にするため、
// あとで別の交代が記録済みの場合、その交代以降の記録は元のまま残る。
export function insertSubstitution(records, index, params) {
  const list = Array.isArray(records) ? records : [];
  const at = Math.max(0, Math.min(index ?? list.length, list.length));
  const { side, type, order, oldPlayer, newPlayer, shift = null, oldPitcherName = null } = params;
  const isTop = side === 'top';

  let battingUpdated = 0;
  let pitchingUpdated = 0;
  const rewriteFromPitcher = isPitcherPos(newPlayer.pos) && oldPitcherName && oldPitcherName !== newPlayer.name;

  const rewritten = list.map((p, i) => {
    if (i < at) return p;
    let next = p;
    if (oldPlayer?.name && p.isTop === isTop && p.batter === order && p.batterName === oldPlayer.name) {
      next = {
        ...next,
        batterName: newPlayer.name,
        batterBats: newPlayer.bats ?? next.batterBats,
        batterThrows: newPlayer.throws ?? next.batterThrows,
        batterPos: newPlayer.pos ?? next.batterPos,
      };
      battingUpdated++;
    }
    if (rewriteFromPitcher && p.isTop !== isTop && p.pitcherName === oldPitcherName) {
      next = { ...next, pitcherName: newPlayer.name, pitcherThrows: newPlayer.throws ?? next.pitcherThrows };
      pitchingUpdated++;
    }
    if (shift?.name && p.isTop === isTop && p.batter === shift.order && p.batterName === shift.name) {
      next = { ...next, batterPos: shift.toPos };
    }
    return next;
  });

  // イベント自体の打者・投手は交代直後の状態(書き換え後の記録)に合わせる
  const anchor = rewritten[at] || rewritten[at - 1] || null;

  const event = {
    course: null,
    type: '-',
    result: buildSubstitutionEventText({
      order,
      oldPos: oldPlayer?.pos,
      oldName: oldPlayer?.name,
      newPos: newPlayer.pos,
      newName: newPlayer.name,
      type,
      shift,
    }),
    inning: anchor?.inning ?? 1,
    isTop: anchor ? anchor.isTop : isTop,
    batter: anchor?.batter ?? 1,
    pitchNumber: '-',
    pitcherName: anchor?.pitcherName ?? '',
    pitcherThrows: anchor?.pitcherThrows ?? '右',
    batterName: anchor?.batterName ?? '',
    batterBats: anchor?.batterBats ?? '右',
    isEvent: true,
    runners: { first: false, second: false, third: false, ...(anchor?.runners || {}) },
    outs: anchor?.outs ?? 0,
  };

  return {
    records: [...rewritten.slice(0, at), event, ...rewritten.slice(at)],
    event,
    battingUpdated,
    pitchingUpdated,
  };
}

// 控え欄から出場した選手を控え欄から取り除く。
// オーダー設定に同じ選手が「先発スロット」と「控え」で二重に並ぶのを防ぐ。
export function dropBenchEntry(lineup, name) {
  const list = Array.isArray(lineup) ? lineup : [];
  const target = (name || '').trim();
  if (!target) return list;
  const next = list.filter((p, i) => i < STARTING_SLOTS || (p?.name || '').trim() !== target);
  return next.length === list.length ? list : next;
}

// さかのぼり交代を現在のオーダーにも反映する。
// 対象スロットに退いた選手がまだ残っている場合のみ差し替える
// (あとで別の交代が記録済みなら、そちらが最新なので触らない)。
export function applySubstitutionToLineup(lineup, params) {
  const list = Array.isArray(lineup) ? lineup : [];
  const { order, oldPlayer, newPlayer, shift = null } = params;
  const idx = order - 1;
  if (!list[idx] || !oldPlayer?.name || list[idx].name !== oldPlayer.name) return { lineup: list, applied: false };
  const next = [...list];
  next[idx] = { ...next[idx], name: newPlayer.name, pos: newPlayer.pos, throws: newPlayer.throws, bats: newPlayer.bats };
  if (shift) {
    const sIdx = shift.order - 1;
    if (next[sIdx] && next[sIdx].name === shift.name) next[sIdx] = { ...next[sIdx], pos: shift.toPos };
  }
  return { lineup: next, applied: true };
}
