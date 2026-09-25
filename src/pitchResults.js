// 投球結果のうち、カウント(ボール/ストライク)を動かすものの定義。
// 画面・再計算・集計・帳票のすべてで同じ判定を使うため、ここに集約する。

// ピッチクロック違反。実際には投球されず、投手の違反ならボール、打者の違反ならストライクが1つ宣告される。
// 球種・コースを持たず、投球数・球種割合・ストライク率などの「投げた球」の集計には含めない。
export const PITCH_CLOCK_BALL = 'ピッチクロック違反ボール';
export const PITCH_CLOCK_STRIKE = 'ピッチクロック違反ストライク';

const BALL_RESULTS = new Set(['ボール', 'ウエスト', PITCH_CLOCK_BALL]);
// ファウルと違い、2ストライクからでもストライクが増える(=三振になる)結果
const STRIKE_RESULTS = new Set(['ストライク', '空振り', 'バント空振り', PITCH_CLOCK_STRIKE]);
const FOUL_RESULTS = new Set(['ファウル', 'バントファウル']);

export const isBallResult = (result) => BALL_RESULTS.has(result);
export const isStrikeResult = (result) => STRIKE_RESULTS.has(result);
export const isFoulResult = (result) => FOUL_RESULTS.has(result);
export const isPitchClockViolation = (result) => result === PITCH_CLOCK_BALL || result === PITCH_CLOCK_STRIKE;

/**
 * 投球記録の並びからボール・ストライク数を数える(ファウルは2ストライクまで)。
 * @param {Array} pitches その打席の投球記録(isEvent=false)
 * @returns {{ b: number, s: number }}
 */
export function countBallsStrikes(pitches) {
  let b = 0, s = 0;
  (pitches || []).forEach(p => {
    if (isBallResult(p.result)) b++;
    else if (isStrikeResult(p.result)) s++;
    else if (isFoulResult(p.result) && s < 2) s++;
  });
  return { b, s };
}
