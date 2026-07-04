// 試合記録(pitches)の操作ユーティリティ。

// 打席ごとの球数(pitchNumber)を記録順に振り直す。
// 球数は(回, 表裏, 打順)ごとの連番で管理されているため、
// 打順違いの修正や記録の削除の後に呼んで整合を保つ。
// 球数に数えないイベント記録(countAsPitchなし)は対象外。
export function renumberPitchNumbers(records) {
  const counters = {};
  return (records || []).map((p) => {
    if (p.isEvent && !p.countAsPitch) return p;
    const key = `${p.inning}-${p.isTop}-${p.batter}`;
    counters[key] = (counters[key] || 0) + 1;
    return p.pitchNumber === counters[key] ? p : { ...p, pitchNumber: counters[key] };
  });
}

// 記録された1球を別の打順の打者に付け替える。
// applyToAtBat が true の場合、同じ打席グループ(同じ回・表裏・打順)の
// 全記録(イベント含む)をまとめて付け替える。打者名・投打は newBatterInfo から設定。
export function reassignPitchBatter(records, index, newBatter, newBatterInfo, applyToAtBat) {
  const orig = records[index];
  if (!orig) return records;
  const info = {
    batter: newBatter,
    batterName: newBatterInfo?.name ?? orig.batterName,
    batterBats: newBatterInfo?.bats ?? orig.batterBats,
    batterThrows: newBatterInfo?.throws ?? orig.batterThrows,
    batterPos: newBatterInfo?.pos ?? orig.batterPos,
  };
  const inGroup = (p) => p.inning === orig.inning && p.isTop === orig.isTop && p.batter === orig.batter;
  const moved = records.map((p, i) => {
    if (i === index) return { ...p, ...info };
    if (applyToAtBat && inGroup(p)) return { ...p, ...info };
    return p;
  });
  return renumberPitchNumbers(moved);
}
