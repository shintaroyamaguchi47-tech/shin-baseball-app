// チーム名簿と選手名の操作ユーティリティ。
// 選手の「統合」は名簿の重複削除だけでなく、試合記録(打席・投球)の
// 選手名も書き換えることで、累計分析が正しく合算されるようにする。

// 旧形式(文字列のみ)の選手データをオブジェクト形式に揃える
export function asPlayerObj(p) {
  return typeof p === 'string' ? { name: p, throws: '右', bats: '右' } : p;
}

// 表記ゆれ検出用の正規化: 前後・途中の空白(全角含む)を除去
export function normalizeName(name) {
  return (name || '').replace(/[\s　]/g, '');
}

// 名簿内で正規化後の名前が重複している選手のインデックス集合を返す
export function findDuplicateNameIndices(players) {
  const byNorm = new Map();
  (players || []).forEach((p, i) => {
    const n = normalizeName(asPlayerObj(p).name);
    if (!n) return;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(i);
  });
  const dup = new Set();
  for (const idxs of byNorm.values()) {
    if (idxs.length > 1) idxs.forEach((i) => dup.add(i));
  }
  return dup;
}

// 名簿から選択された選手を統合する: keepIndex の選手を残し、他の選択選手を削除
export function mergeRosterPlayers(players, selectedIndices, keepIndex) {
  const sel = new Set(selectedIndices);
  return (players || [])
    .map(asPlayerObj)
    .filter((_, i) => !sel.has(i) || i === keepIndex);
}

// オーダー設定を開いた時点の選手名スナップショット({top:[名前], bottom:[名前]})と
// 現在のオーダーを比較し、既存の記録(pitches)に反映すべき改名候補を返す。
// 同じ名前が別の打順枠に残っている場合は「並び替え」とみなし改名扱いしない。
export function detectLineupRenames(snapshot, lineups, pitches) {
  if (!snapshot) return [];
  const renames = [];
  ['top', 'bottom'].forEach((side) => {
    const before = snapshot[side] || [];
    const after = lineups?.[side] || [];
    const batterIsTop = side === 'top';
    after.forEach((p, i) => {
      const oldName = (before[i] || '').trim();
      const newName = (p?.name || '').trim();
      if (!oldName || !newName || oldName === newName) return;
      if (after.some((q, j) => j !== i && (q?.name || '').trim() === oldName)) return;
      if (renames.some((r) => r.side === side && r.from === oldName)) return;
      const count = (pitches || []).filter(
        (x) =>
          (x.isTop === batterIsTop && x.batterName === oldName) ||
          (x.isTop !== batterIsTop && x.pitcherName === oldName)
      ).length;
      if (count > 0) renames.push({ side, from: oldName, to: newName, count });
    });
  });
  return renames;
}

// 1試合分のデータ({lineups, pitches})内で、side('top'|'bottom')側チームに
// 所属する選手 fromNames を toName に改名する。
// 打者は p.isTop === (side === 'top') の投球、投手はその逆側の投球に現れる。
export function renamePlayersInGame(game, side, fromNames, toName) {
  const from = new Set(fromNames);
  const batterIsTop = side === 'top';
  let changed = 0;

  const lineups = game.lineups
    ? {
        ...game.lineups,
        [side]: (game.lineups[side] || []).map((p) => {
          if (!from.has(p.name)) return p;
          changed++;
          return { ...p, name: toName };
        }),
      }
    : game.lineups;

  const pitches = (game.pitches || []).map((p) => {
    const renameBatter = p.isTop === batterIsTop && from.has(p.batterName);
    const renamePitcher = p.isTop !== batterIsTop && from.has(p.pitcherName);
    if (!renameBatter && !renamePitcher) return p;
    changed++;
    return {
      ...p,
      ...(renameBatter ? { batterName: toName } : {}),
      ...(renamePitcher ? { pitcherName: toName } : {}),
    };
  });

  return { lineups, pitches, changed };
}
