// 指名打者(DH)制のルール。
//
// 指名打者を使う間、投手は打席に立たない。打席に立つのは打順1〜9の9人で、
// そのうち1人が「指」(指名打者)。投手は打順に入らないので「控/投」スロット(打順10)に置く。
//
// 指名打者制は、投手が打順に加わった時点で解除される(公認野球規則 5.11)。
//   - 出場している野手が投手になる(玉突きで元投手が別の守備位置につく場合を含む)
//   - 投手が指名打者に代わって打席に立つ
//   - 指名打者が守備位置につく
// 解除されると投手も打席に立つことになるため、打順に入っていなかった投手が
// 指名打者の打順に入り、指名打者はベンチへ退く。

import { isPitcherPos, STARTING_SLOTS, buildSubstitutionEventText } from './substitutionUtils.js';

export const DH_POS = '指';
// 指名打者制を解除する交代の種別。記録には他の交代と同じ「選手交代: ...」形式で残す。
export const DH_CANCEL_TYPE = 'DH解除';
export const BATTING_SLOTS = 9;                     // 打席に立つのは打順1〜9の9人
export const PITCHER_SLOT_INDEX = STARTING_SLOTS - 1; // 「控/投」= 打席に立たない投手のスロット
export const PITCHER_SLOT_ORDER = STARTING_SLOTS;

// 投手を除く8つの守備位置。解除時に空いた守備位置を探すのに使う。
export const FIELD_POSITIONS = ['捕', '一', '二', '三', '遊', '左', '中', '右'];

export const isDhPos = (pos) => pos === DH_POS || pos === 'DH' || pos === '指名打者';

// 守備についているか(投手を含む)。'指'・'打'(代打)・'走'(代走)・'控'・'未' は守備位置ではない。
export const isFieldingPos = (pos) => isPitcherPos(pos) || FIELD_POSITIONS.includes(pos);

const asList = (lineup) => (Array.isArray(lineup) ? lineup : []);
const nameOf = (slot) => (slot?.name || '').trim();

// 初期表示のままの名前(「先攻1番」「先発投手」など)は未入力として扱う
const PLACEHOLDER_NAME = /^(?:先攻|後攻)\d+番$|^先発投手$|^選手\d+$/;
export const isEmptySlot = (slot) => {
  const n = nameOf(slot);
  return !n || PLACEHOLDER_NAME.test(n);
};

const battingPart = (lineup) => asList(lineup).slice(0, BATTING_SLOTS);

// 打順1〜9に入っている指名打者のindex(なければ -1)
export function findDhIndex(lineup) {
  return battingPart(lineup).findIndex((p) => isDhPos(p?.pos));
}

// 打順1〜9に入っている投手のindex(なければ -1)。ここに投手がいる = 投手が打席に立つ。
export function findBattingPitcherIndex(lineup) {
  return battingPart(lineup).findIndex((p) => isPitcherPos(p?.pos));
}

// オーダー全体から投手のindexを探す(打順1〜9 → 控/投 の順)
export function findPitcherIndex(lineup) {
  return asList(lineup).findIndex((p) => isPitcherPos(p?.pos));
}

// 指名打者制が有効か・誰が指名打者か・投手は打席に立つかをまとめて返す
export function getDhState(lineup) {
  const list = asList(lineup);
  const dhIndex = findDhIndex(list);
  const battingPitcherIndex = findBattingPitcherIndex(list);
  const pitcherIndex = findPitcherIndex(list);
  // 指名打者がいて、かつ投手が打順に入っていないときだけ指名打者制が成立する
  const active = dhIndex !== -1 && battingPitcherIndex === -1;
  return {
    active,
    dhIndex,
    dhOrder: dhIndex === -1 ? null : dhIndex + 1,
    dh: dhIndex === -1 ? null : list[dhIndex],
    pitcherIndex,
    pitcherOrder: pitcherIndex === -1 ? null : (pitcherIndex === PITCHER_SLOT_INDEX ? PITCHER_SLOT_ORDER : pitcherIndex + 1),
    pitcher: pitcherIndex === -1 ? null : list[pitcherIndex],
    // 投手が打席に立つか(指名打者制を使っていない、または解除された状態)
    pitcherBats: battingPitcherIndex !== -1,
    battingPitcherIndex,
  };
}

// 出場中の選手(打順1〜9 + 控/投)が誰も守っていない守備位置を返す
export function vacantFieldPositions(lineup) {
  const used = new Set(
    asList(lineup)
      .slice(0, STARTING_SLOTS)
      .filter((p) => !isEmptySlot(p))
      .map((p) => p?.pos)
  );
  return FIELD_POSITIONS.filter((pos) => !used.has(pos));
}

// オーダーの指名打者まわりの設定ミスを警告文の配列で返す
export function validateDhLineup(lineup) {
  const list = asList(lineup);
  const warnings = [];
  const dhCount = battingPart(list).filter((p) => isDhPos(p?.pos)).length;
  if (dhCount > 1) warnings.push('指名打者(指)が複数の打順に入っています。指名打者は1人だけです');
  if (list.slice(BATTING_SLOTS).some((p) => isDhPos(p?.pos))) warnings.push('指名打者(指)は打順1〜9に入れてください');

  const state = getDhState(list);
  if (state.active) {
    const pitcherSlot = list[PITCHER_SLOT_INDEX];
    if (isEmptySlot(pitcherSlot) || !isPitcherPos(pitcherSlot?.pos)) {
      warnings.push('指名打者を使う場合は「控/投」に投手を入れてください(投手は打席に立ちません)');
    }
  } else if (dhCount > 0) {
    warnings.push('投手が打順に入っているため、指名打者制は解除された状態です');
  } else if (state.pitcherIndex === -1) {
    warnings.push('投手(投)がオーダーにいません');
  }
  return warnings;
}

const clearedPitcherSlot = (slot) => ({
  ...(slot || {}),
  order: slot?.order ?? '投',
  name: '',
  pos: '控',
});

// 指名打者制の解除で投手が打順に入ったあと、「控/投」スロットを空にする
export function clearPitcherSlot(lineup) {
  const list = asList(lineup).map((p) => ({ ...p }));
  if (list[PITCHER_SLOT_INDEX]) list[PITCHER_SLOT_INDEX] = clearedPitcherSlot(list[PITCHER_SLOT_INDEX]);
  return list;
}

const playerInfo = (slot) => ({
  name: nameOf(slot),
  pos: slot?.pos || '未',
  throws: slot?.throws || '右',
  bats: slot?.bats || '右',
});

// 「控/投」にいる投手を order 番の打順へ入れて指名打者制を解除する。
// order を省略すると指名打者の打順に入れる(投手は指名打者の打順を引き継ぐ)。
// pos を渡すと入る選手の守備位置を上書きする(既定は今の守備位置＝投)。
export function cancelDh(lineup, { order = null, pos = null } = {}) {
  const state = getDhState(lineup);
  if (!state.active) return null;
  const list = asList(lineup).map((p) => ({ ...p }));
  const pitcherSlot = list[PITCHER_SLOT_INDEX];
  if (isEmptySlot(pitcherSlot)) return null;

  const targetIndex = order ? order - 1 : state.dhIndex;
  const target = list[targetIndex];
  if (!target) return null;
  const incoming = { ...playerInfo(pitcherSlot), pos: pos || pitcherSlot.pos || '投' };
  const retired = playerInfo(target);

  list[targetIndex] = { ...target, name: incoming.name, pos: incoming.pos, throws: incoming.throws, bats: incoming.bats };
  list[PITCHER_SLOT_INDEX] = clearedPitcherSlot(pitcherSlot);

  return {
    lineup: list,
    order: targetIndex + 1,
    incoming,
    retired,
    positionOnly: false,
    reason: '投手が打順に入ったため',
    eventText: buildSubstitutionEventText({
      order: targetIndex + 1,
      oldPos: retired.pos,
      oldName: retired.name,
      newPos: incoming.pos,
      newName: incoming.name,
      type: DH_CANCEL_TYPE,
    }),
  };
}

// 交代・位置変更の前後のオーダーを比べ、指名打者制が解除されたなら後始末をする。
//
// before で指名打者制が有効で、after で打順1〜9に投手が入った(=出場している野手が
// 投手になった、投手が打順に入った)ときが対象。
//   - 元投手が玉突きで守備位置に残っている場合: その選手が指名打者の打順に入り、指名打者は退く
//   - 元投手が試合から退いた場合: 空いた守備位置に指名打者が就く(打順はそのまま)
// 解除にあたらない場合は null を返す。
export function resolveDhCancellation(before, after) {
  const beforeState = getDhState(before);
  if (!beforeState.active) return null;
  const list = asList(after).map((p) => ({ ...p }));
  const afterState = getDhState(list);
  if (afterState.battingPitcherIndex === -1) return null; // まだ投手は打順に入っていない

  const dhIndex = beforeState.dhIndex;
  const dhSlot = list[dhIndex];
  const pitcherSlot = list[PITCHER_SLOT_INDEX];
  // 「控/投」に残った元投手が守備位置についているか(投のままなら試合から退いたとみなす)
  const stayedOnField = !isEmptySlot(pitcherSlot) && isFieldingPos(pitcherSlot?.pos) && !isPitcherPos(pitcherSlot?.pos);

  if (stayedOnField) {
    const incoming = playerInfo(pitcherSlot);
    const retired = playerInfo(dhSlot);
    list[dhIndex] = { ...dhSlot, name: incoming.name, pos: incoming.pos, throws: incoming.throws, bats: incoming.bats };
    list[PITCHER_SLOT_INDEX] = clearedPitcherSlot(pitcherSlot);
    return {
      lineup: list,
      order: dhIndex + 1,
      incoming,
      retired,
      positionOnly: false,
      reason: '出場している野手が投手になったため',
      notice: `指名打者制が解除されました: ${incoming.name} が${dhIndex + 1}番(${retired.name || '指名打者'})に入ります`,
      eventText: buildSubstitutionEventText({
        order: dhIndex + 1,
        oldPos: retired.pos,
        oldName: retired.name,
        newPos: incoming.pos,
        newName: incoming.name,
        type: DH_CANCEL_TYPE,
      }),
    };
  }

  // 元投手が退いた場合は指名打者が空いた守備位置に就く(打順は動かない)
  const withoutPitcher = list.map((p, i) => (i === PITCHER_SLOT_INDEX ? clearedPitcherSlot(p) : p));
  const vacant = vacantFieldPositions(withoutPitcher);
  if (isDhPos(dhSlot?.pos) && vacant.length === 1 && !isEmptySlot(dhSlot)) {
    const moved = { ...playerInfo(dhSlot), pos: vacant[0] };
    withoutPitcher[dhIndex] = { ...dhSlot, pos: vacant[0] };
    return {
      lineup: withoutPitcher,
      order: dhIndex + 1,
      incoming: moved,
      retired: playerInfo(dhSlot),
      positionOnly: true,
      reason: '出場している野手が投手になったため',
      notice: `指名打者制が解除されました: ${moved.name} が${vacant[0]}に就きます`,
      eventText: buildSubstitutionEventText({
        order: dhIndex + 1,
        oldPos: DH_POS,
        oldName: moved.name,
        newPos: vacant[0],
        newName: moved.name,
        type: DH_CANCEL_TYPE,
        positionOnly: true,
      }),
    };
  }

  // 守備位置を決めきれない場合はオーダーを触らず、解除された事実だけ知らせる
  return {
    lineup: withoutPitcher,
    order: dhIndex + 1,
    incoming: null,
    retired: playerInfo(dhSlot),
    positionOnly: false,
    reason: '出場している野手が投手になったため',
    notice: '指名打者制が解除されました。空いた守備位置を交代で埋めてください',
    eventText: null,
  };
}
