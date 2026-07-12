// ============================================================
// スコアラーアプリ(GDF形式)インポーター
// スコアラーが書き出すJSON(kind:"GDF")のプレー・バイ・プレーコード(cd)を解読し、
// 本アプリの pitches / lineups / gameInfo / gameState 形式へ変換する。
//
// cdコードの構造(4試合の実データから解読・検証済み):
//   It01/Ib01     : N回表/裏の開始
//   At01Lb3/Ab01  : 表/裏の終了(Lbn=残塁数)
//   Na / Nb       : 打席の開始 / 次打者への切替
//   Pb Pl Ps Pf   : ボール / 見逃し / 空振り / ファウル (1球=1トークン)
//   Pt Px Py{n}   : バント空振り / バントファウル / ファウル(方向付き)
//   Ko / Bb       : 三振 / 四球の確定マーカー(最終球は直前のPトークンに含まれる)
//   Db / Bd       : 死球(1球を含む) / 打撃妨害(球数に数えない)
//   Kr...Kw       : 振り逃げ(Kr=第3ストライク落球、Kw=出塁成功)
//   H1..H4        : 単打〜本塁打(1球を含む)。修飾: i=内野安打 r=ランニング e=エンタイトル
//   Go/Gob        : ゴロ / バントゴロ(1球を含む)
//   Fo/Fof/Fol    : フライ / ファウルフライ / ライナー(1球を含む)
//   -{zc}         : 打球位置(1桁目=野手0-8(投〜右)、2桁目=深さ)
//   Cb / Cf       : 犠打 / 犠飛
//   E{s|k|j|c}{n} : エラー(送球/捕球/落球/捕手)
//   Th{n}/Tb{n}   : 送球先の野手(表示用)
//   J{f}{t}       : 走者の移動 f=元(0=打者,1-3=塁) t=到達(1-3=塁,4=生還,a-d=エラーで同)
//                   ※成分は出現順に適用され、fは適用時点の位置を指す
//   O{f}{t}/T{f}{t}: 走者アウト(フォース/タッチ)
//   Rq{xy}        : 牽制球(y=塁)  Ru{n}: 走者スタート(ビットマスク・無視)
//   Rs / Rf / Rr  : 盗塁成功 / 盗塁死 / 牽制死
//   Ep / Ew / Dk  : 捕逸 / 暴投 / ボーク(J付きで走者移動)
//   Sj{ord}{pos}=Sk{from}{to}#id: : 守備位置変更(投手交代を含む)
//   Sd{ord}{pos}#id: / Sh{ord}#id: / Sr{ord}#id: : 守備交代 / 代打 / 代走
//   Sih{pos}#id: / Sir{pos}#id:   : 代打/代走がそのまま守備位置へ
//   W... / Sc / Odp / Am{n} / Ah  : 注記類(ゲーム状態に影響しないため読み飛ばす)
// ============================================================

const POS_CHAR = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
const FIELD_NAME = ['ピッチャー', 'キャッチャー', 'ファースト', 'セカンド', 'サード', 'ショート', 'レフト', 'センター', 'ライト'];
// スプレー図(240x200, 本塁=120,185)上の各守備位置の基準座標
const FIELD_XY = [
  [120, 150], [120, 176], [158, 140], [146, 114], [82, 140], [94, 114], [58, 72], [120, 52], [182, 72],
];
const ARM_CHAR = ['右', '右', '左', '両']; // 0=不明は右扱い

export function isScorerGdf(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t.startsWith('{')) return false;
  try {
    const obj = JSON.parse(t);
    return obj?.kind === 'GDF' || typeof (obj?.game?.cd ?? obj?.cd) === 'string';
  } catch (e) {
    return false;
  }
}

function parseJsonField(v, fallback) {
  if (typeof v !== 'string') return v ?? fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

// arm値: 上位2bit=投(0不明/1右/2左/3両)、下位2bit=打
function armToThrows(arm) { return ARM_CHAR[(arm >> 2) & 3] || '右'; }
function armToBats(arm) { return ARM_CHAR[arm & 3] || '右'; }

// J/O/Tの到達コード: 0-4=通常、a-d=エラーによる到達
function destOf(ch) {
  if (ch >= '0' && ch <= '4') return Number(ch);
  return { a: 1, b: 2, c: 3, d: 4 }[ch] ?? null;
}

// 結果トークンから J/O/T 成分を出現順に取り出す(Th2/Tb1は野手指定なのでマッチしない)
function parseComps(token) {
  const comps = [];
  const re = /(J|O|T)([0-3])([0-4a-d])/g;
  let m;
  while ((m = re.exec(token)) !== null) {
    comps.push({ kind: m[1], from: Number(m[2]), to: destOf(m[3]) });
  }
  return comps;
}

// 打球位置(2桁ゾーン)→守備位置番号とスプレー図座標
function zoneInfo(token) {
  const m = token.match(/-(\d)(\d)/);
  if (!m) return null;
  const f = Number(m[1]);
  if (f < 0 || f > 8) return null;
  const depth = Number(m[2]);
  const [ax, ay] = FIELD_XY[f];
  const scale = 0.75 + depth * 0.05; // 深さで本塁からの距離を伸縮
  const x = 120 + (ax - 120) * scale;
  const y = 185 + (ay - 185) * scale;
  return { fielder: f, x: Math.round(Math.max(5, Math.min(235, x))), y: Math.round(Math.max(5, Math.min(195, y))) };
}

// 本アプリの自動進塁(App.jsxのadvanceGameState / playByPlayのapplyMovementと同一ルール)を
// 走者ID付きで再現する
function applyAutoMovement(bases, eventType, batterId) {
  const b = { ...bases };
  const scored = [];
  if (eventType === 'walk' || eventType === 'other') {
    if (b[1] && b[2] && b[3]) { scored.push(b[3]); b[3] = b[2]; b[2] = b[1]; }
    else if (b[1] && b[2]) { b[3] = b[2]; b[2] = b[1]; }
    else if (b[1]) { b[2] = b[1]; }
    b[1] = batterId;
  } else if (eventType === 'single' || eventType === 'error') {
    if (b[3]) scored.push(b[3]);
    b[3] = b[2]; b[2] = b[1]; b[1] = batterId;
  } else if (eventType === 'double') {
    if (b[3]) scored.push(b[3]);
    if (b[2]) scored.push(b[2]);
    b[3] = b[1]; b[2] = batterId; b[1] = null;
  } else if (eventType === 'triple') {
    if (b[3]) scored.push(b[3]);
    if (b[2]) scored.push(b[2]);
    if (b[1]) scored.push(b[1]);
    b[3] = batterId; b[2] = null; b[1] = null;
  } else if (eventType === 'homerun') {
    if (b[3]) scored.push(b[3]);
    if (b[2]) scored.push(b[2]);
    if (b[1]) scored.push(b[1]);
    scored.push(batterId);
    b[1] = null; b[2] = null; b[3] = null;
  } else if (eventType === 'sac_bunt') {
    if (b[3]) scored.push(b[3]);
    b[3] = b[2]; b[2] = b[1]; b[1] = null;
  } else if (eventType === 'sac_fly') {
    if (b[3]) scored.push(b[3]);
    b[3] = null;
  }
  return { bases: b, scored };
}

// GDFのJ/O/T成分を塁状況へ順番に適用し、最終的な塁・得点・アウトを求める
function applyComps(bases, batterId, comps) {
  const b = { ...bases };
  let batterPlaced = false;
  const scored = [];
  const outs = []; // {id}
  for (const c of comps) {
    let id;
    if (c.from === 0) { id = batterPlaced ? null : batterId; }
    else { id = b[c.from]; b[c.from] = null; }
    if (c.kind === 'O' || c.kind === 'T') {
      if (id) outs.push({ id });
      if (c.from === 0) batterPlaced = true;
      continue;
    }
    if (c.to === 4) {
      if (id) scored.push(id);
      if (c.from === 0) batterPlaced = true;
    } else if (c.to >= 1 && c.to <= 3) {
      if (id) b[c.to] = id;
      if (c.from === 0) batterPlaced = true;
    }
  }
  return { bases: b, scored, outs };
}

export function convertScorerGame(text) {
  const warnings = [];
  const warn = (msg) => warnings.push(msg);
  const gdf = JSON.parse(String(text).trim());
  const game = gdf.game || gdf;
  if (typeof game.cd !== 'string') throw new Error('GDFデータにプレー記録(cd)がありません');

  const cf = parseJsonField(game.cf, {});
  const players = parseJsonField(game.pl, []);
  const roster = new Map();
  players.forEach((p) => {
    roster.set(p.id, {
      name: p.disp || `${p.last || ''}${p.first ? ' ' + p.first : ''}`.trim() || `選手${p.id}`,
      throws: armToThrows(p.arm || 0),
      bats: armToBats(p.arm || 0),
    });
  });
  const playerOf = (id) => (id == null ? { name: '投手未設定', throws: '右', bats: '右' } : roster.get(id) || { name: `選手${id}`, throws: '右', bats: '右' });

  const gteams = cf.gteams || [];
  const makeTeam = (teamId) => {
    const gt = gteams.find((t) => t.id === teamId) || { players: [] };
    const slots = Array(9).fill(null);   // 打順(0-8)→選手id
    const defense = Array(9).fill(null); // 守備位置(0-8)→選手id
    (gt.players || []).forEach((p) => {
      if (p.ord >= 0 && p.ord < 9) slots[p.ord] = p.id;
      if (p.pos >= 0 && p.pos < 9 && p.ord >= 0) defense[p.pos] = p.id;
    });
    return { slots, defense, nextSlot: 0, ids: new Set((gt.players || []).map((p) => p.id)) };
  };
  const teams = { top: makeTeam(game.td), bottom: makeTeam(game.bd) };
  const teamOfPlayer = (id) => {
    if (teams.top.ids.has(id) || teams.top.slots.includes(id)) return teams.top;
    if (teams.bottom.ids.has(id) || teams.bottom.slots.includes(id)) return teams.bottom;
    return null;
  };
  const posCharOf = (team, id) => {
    const p = team.defense.indexOf(id);
    return p >= 0 ? POS_CHAR[p] : '打';
  };

  // ---- シミュレーション状態 ----
  let inning = 1;
  let isTop = true;
  let outs = 0;
  let balls = 0;
  let strikes = 0;
  let bases = { 1: null, 2: null, 3: null }; // 塁→走者id
  let batterSlot = 0;
  let lastLOB = 0; // 直前の3アウト時の残塁(Lb検証用)
  const runs = { top: [0, 0, 0, 0, 0, 0, 0, 0, 0], bottom: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const scoredIds = []; // 検証用
  const pitches = [];
  const pitchCounters = {};
  const pitcherStints = { top: [], bottom: [] }; // 登板順(ti/biによる名前補完用)

  const battingTeam = () => (isTop ? teams.top : teams.bottom);
  const fieldingTeam = () => (isTop ? teams.bottom : teams.top);
  const runnersBool = () => ({ first: !!bases[1], second: !!bases[2], third: !!bases[3] });

  const addRun = (id) => {
    const arr = runs[isTop ? 'top' : 'bottom'];
    while (arr.length < inning) arr.push(0);
    arr[inning - 1] += 1;
    if (id) scoredIds.push({ id, inning, isTop });
  };

  // 守備位置の割り当て。投手(0)への割り当ては登板順として記録する(ti/biの名前補完に使う)
  const assignDefense = (team, pos, id) => {
    team.defense[pos] = id;
    if (pos === 0 && id != null) {
      const side = team === teams.top ? 'top' : 'bottom';
      if (pitcherStints[side][pitcherStints[side].length - 1] !== id) pitcherStints[side].push(id);
    }
  };
  if (teams.top.defense[0] != null) pitcherStints.top.push(teams.top.defense[0]);
  if (teams.bottom.defense[0] != null) pitcherStints.bottom.push(teams.bottom.defense[0]);

  // 守備シャッフルの途中で投手枠が一時的に空くことがあるため、直近の投手を覚えておく
  const lastPitcherId = { top: teams.top.defense[0], bottom: teams.bottom.defense[0] };
  const currentPitcher = () => {
    const side = isTop ? 'bottom' : 'top';
    const id = teams[side].defense[0];
    if (id != null) lastPitcherId[side] = id;
    return playerOf(id ?? lastPitcherId[side]);
  };

  const emitPitch = (result, extra = {}) => {
    const key = `${inning}-${isTop}-${batterSlot + 1}`;
    pitchCounters[key] = (pitchCounters[key] || 0) + 1;
    const batterId = battingTeam().slots[batterSlot];
    const batter = playerOf(batterId);
    const pitcher = currentPitcher();
    pitches.push({
      course: null, type: '-', result,
      inning, isTop, batter: batterSlot + 1,
      pitchNumber: pitchCounters[key],
      pitcherName: pitcher.name, pitcherThrows: pitcher.throws,
      batterName: batter.name, batterBats: batter.bats, batterThrows: batter.throws,
      batterPos: batterId != null ? posCharOf(battingTeam(), batterId) : '未',
      isEvent: false, runners: runnersBool(), outs,
      ...extra,
    });
  };

  const emitEvent = (result) => {
    const batter = playerOf(battingTeam().slots[batterSlot]);
    const pitcher = currentPitcher();
    pitches.push({
      course: null, type: '-', result,
      inning, isTop, batter: batterSlot + 1,
      pitchNumber: '-',
      pitcherName: pitcher.name, pitcherThrows: pitcher.throws,
      batterName: batter.name, batterBats: batter.bats,
      isEvent: true, runners: runnersBool(), outs,
    });
  };

  // 3アウトなら攻守交替する。交替したらtrueを返す
  const flipIfThreeOuts = () => {
    if (outs < 3) return false;
    // Lb検証用: 残塁は塁のビットマスク(1塁=1, 2塁=2, 3塁=4)で記録されている
    lastLOB = (bases[1] ? 1 : 0) | (bases[2] ? 2 : 0) | (bases[3] ? 4 : 0);
    outs = 0; balls = 0; strikes = 0;
    bases = { 1: null, 2: null, 3: null };
    if (isTop) { isTop = false; } else { isTop = true; inning++; }
    batterSlot = battingTeam().nextSlot;
    return true;
  };

  // 打席完了: 打順を送る(3アウト処理より先に呼ぶこと)
  const completePA = () => {
    const team = battingTeam();
    team.nextSlot = (batterSlot + 1) % 9;
    balls = 0; strikes = 0;
    if (!flipIfThreeOuts()) batterSlot = team.nextSlot;
  };

  // 走者の進塁イベント(理由付き)。塁状況と得点も更新する
  const emitAdvance = (fromBase, toBase, reason = 'その他') => {
    const id = bases[fromBase];
    if (toBase === 4) {
      emitEvent(`${fromBase}塁走者 ${reason}で本塁へ`);
      addRun(id);
      bases[fromBase] = null;
    } else {
      emitEvent(`${fromBase}塁走者 ${reason}で${toBase}塁へ`);
      bases[toBase] = id;
      bases[fromBase] = null;
    }
  };

  // 走者アウトイベント。deferFlip=trueなら3アウト処理を呼び元へ委ねる
  const emitRunnerOut = (base, reason, deferFlip = false) => {
    emitEvent(`${base}塁走者が${reason}`);
    bases[base] = null;
    outs++;
    if (!deferFlip) flipIfThreeOuts();
  };

  // 三振確定(第3ストライクの投球で処理する。Koマーカー自体は読み飛ばす)
  const finishStrikeout = () => {
    outs++;
    completePA();
  };

  // 打席結果の確定処理。
  // アプリ準拠の自動進塁と、GDFのJ/O/T成分の示す実際の結果との差分を
  // 進塁/走者アウトイベントで埋める。withPitch=falseなら最終球は出力済み(四球など)。
  const finalizePlay = (comps, eventType, opts = {}) => {
    const { resultStr = null, zone = null, pitchOuts = 0, outReason = '走塁死' } = opts;
    const batterId = battingTeam().slots[batterSlot] ?? `slot-${inning}-${isTop}-${batterSlot}`;
    const before = { ...bases };
    const target = applyComps(before, batterId, comps);
    const prelimAuto = applyAutoMovement(before, eventType, batterId);

    // 各走者の「自動進塁後の位置」(1-3=塁, 4=生還)と「GDF上の最終位置」
    const autoPos = new Map();
    [1, 2, 3].forEach((b) => { if (prelimAuto.bases[b]) autoPos.set(prelimAuto.bases[b], b); });
    prelimAuto.scored.forEach((id) => autoPos.set(id, 4));
    const gdfPos = new Map();
    [1, 2, 3].forEach((b) => { if (target.bases[b]) gdfPos.set(target.bases[b], b); });
    target.scored.forEach((id) => gdfPos.set(id, 4));
    const outIds = new Set(target.outs.map((o) => o.id));

    const preOuts = [];   // 投球より先に出す走者アウト(自動進塁だと生還してしまう走者)
    const preScores = []; // 投球より先に出す生還(3アウト成立後はイベントを出せないため)
    const post = [];      // 投球の後に出す補正
    const involved = [batterId, before[3], before[2], before[1]].filter(Boolean);
    involved.forEach((id) => {
      const a = autoPos.get(id);
      if (outIds.has(id)) {
        if (a === 4 || a === undefined) {
          const cur = [1, 2, 3].find((b) => before[b] === id);
          if (cur) preOuts.push({ base: cur });
          else if (id !== batterId) warn(`${inning}回${isTop ? '表' : '裏'}: アウト走者の位置を特定できません`);
        } else {
          post.push({ type: 'out', base: a });
        }
        return;
      }
      const g = gdfPos.get(id);
      if (a === undefined || g === undefined || a === g) return;
      if (g > a) post.push({ type: 'adv', base: a, to: g, id });
      else warn(`${inning}回${isTop ? '表' : '裏'}: 走者がアプリの自動進塁(${a})よりGDF(${g})の方が手前(表現できないため自動進塁に従います)`);
    });
    post.sort((x, y) => y.base - x.base);

    const totalOuts = pitchOuts + preOuts.length + post.filter((c) => c.type === 'out').length;
    const inningEnds = outs + totalOuts >= 3;

    // 先出しイベント: 本塁憤死などで自動進塁だと生還してしまう走者のアウト
    preOuts.forEach((c) => emitRunnerOut(c.base, outReason, true));
    // 先出しイベント: 3アウトと同時に記録される得点(回が替わる前に出す)
    if (inningEnds) {
      post.filter((c) => c.type === 'adv' && c.to === 4).forEach((c) => {
        const cur = [1, 2, 3].find((b) => bases[b] === c.id);
        if (cur) { emitAdvance(cur, 4); c.done = true; }
      });
    }

    // 最終球を出力し、アプリ準拠の自動進塁を状態へ反映
    if (resultStr) emitPitch(resultStr, zone ? { hitX: zone.x, hitY: zone.y } : {});
    const auto = applyAutoMovement(bases, eventType, batterId);
    auto.scored.forEach((id) => addRun(id));
    bases = auto.bases;
    outs += pitchOuts;

    // 後出しの補正イベント
    post.forEach((c) => {
      if (c.done || outs >= 3) return;
      if (c.type === 'out') emitRunnerOut(c.base, outReason, true);
      else {
        const cur = [1, 2, 3].find((b) => bases[b] === c.id);
        if (cur) emitAdvance(cur, c.to);
      }
    });

    completePA();
  };

  const posName = (z) => (z ? FIELD_NAME[z.fielder] : '');

  // インプレー(安打・凡打・エラー・野手選択など)の1球
  const handleInPlay = (t) => {
    const comps = parseComps(t);
    const zone = zoneInfo(t);
    const pos = posName(zone);
    const batterOut = comps.some((c) => (c.kind === 'O' || c.kind === 'T') && c.from === 0);
    const runnerOuts = comps.filter((c) => (c.kind === 'O' || c.kind === 'T') && c.from !== 0);
    const errM = t.match(/E([a-z])\d/);

    let resultStr, eventType, pitchOuts;
    if (/^H[1-4]/.test(t)) {
      const n = Number(t[1]);
      resultStr = `${pos}${['安', '二塁打', '三塁打', '本塁打'][n - 1]}`;
      eventType = ['single', 'double', 'triple', 'homerun'][n - 1];
      pitchOuts = 0;
    } else if (batterOut && /Cb/.test(t)) {
      resultStr = `${pos}犠打`; eventType = 'sac_bunt'; pitchOuts = 1;
    } else if (batterOut && /Cf/.test(t)) {
      resultStr = `${pos}犠飛`; eventType = 'sac_fly'; pitchOuts = 1;
    } else if (batterOut) {
      // 打者アウト。走者アウトが同時にある場合(併殺)は走塁死イベントで表現する
      resultStr = /^Go/.test(t) ? `${pos}ゴロ` : `${pos}飛`;
      eventType = 'out'; pitchOuts = 1;
    } else if (errM) {
      const word = errM[1] === 'j' ? '落球エラー' : (errM[1] === 's' || t.includes('Th')) ? '送球エラー' : '捕球エラー';
      resultStr = `${pos}${word}`; eventType = 'error'; pitchOuts = 0;
      if (/Cb/.test(t)) warn(`${inning}回${isTop ? '表' : '裏'}: 犠打が相手エラーで出塁したプレーはエラー出塁として記録しました(公式記録では犠打+失策のため打数が1多くなります)`);
    } else if (runnerOuts.length > 0) {
      resultStr = `${pos}野手選択`; eventType = 'error'; pitchOuts = 0;
    } else {
      warn(`結果の判別が曖昧なため安打として扱いました: ${t}`);
      resultStr = `${pos}安`; eventType = 'single'; pitchOuts = 0;
    }
    finalizePlay(comps, eventType, { resultStr, zone, pitchOuts });
  };

  // ---- トークン処理 ----
  const tokens = game.cd.split('=').filter(Boolean);
  const nextRealToken = (i) => {
    for (let k = i + 1; k < tokens.length; k++) {
      if (!/^W/.test(tokens[k]) && tokens[k] !== 'Sc') return tokens[k];
    }
    return null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let m;

    // イニング境界
    if ((m = t.match(/^I([tb])(\d+)/))) {
      const wantTop = m[1] === 't';
      const n = Number(m[2]);
      if (pitches.length > 0 && (n !== inning || wantTop !== isTop)) {
        warn(`イニング不整合: 計算${inning}回${isTop ? '表' : '裏'} / 記録${n}回${wantTop ? '表' : '裏'}`);
      }
      inning = n; isTop = wantTop;
      outs = 0; balls = 0; strikes = 0;
      bases = { 1: null, 2: null, 3: null };
      batterSlot = battingTeam().nextSlot;
      continue;
    }
    if (/^A[tb]\d+/.test(t)) {
      const lb = t.match(/Lb(\d+)/);
      if (lb && lastLOB !== Number(lb[1])) warn(`残塁不一致 ${t}: 計算${lastLOB} vs 記録${lb[1]}`);
      continue;
    }
    if (t === 'Na') { batterSlot = battingTeam().nextSlot; balls = 0; strikes = 0; continue; }
    if (t === 'Nb' || t === 'Ah' || t === 'Sc') continue;
    if (/^Am\d*$/.test(t) || /^W/.test(t) || /^Odp/.test(t) || /^Ru\d*$/.test(t)) continue;

    // 投球(カウントが動くだけの球)
    if (t === 'Pb') { emitPitch('ボール'); balls++; continue; }
    if (t === 'Pl' || t === 'Ps' || t === 'Pt') {
      emitPitch(t === 'Pl' ? 'ストライク' : t === 'Ps' ? '空振り' : 'バント空振り');
      strikes++;
      if (strikes >= 3 && nextRealToken(i) !== 'Kr') finishStrikeout();
      continue;
    }
    if (t === 'Pf' || /^Px/.test(t) || /^Py\d*$/.test(t)) {
      const isBuntFoul = /^Px/.test(t);
      if (isBuntFoul && strikes >= 2) {
        emitPitch('スリーバント失敗'); // アプリと同じく結果を書き換えて三振扱い
        finishStrikeout();
      } else {
        emitPitch(isBuntFoul ? 'バントファウル' : 'ファウル');
        if (strikes < 2) strikes++;
      }
      continue;
    }

    // 打席確定マーカー
    if (/^Ko/.test(t) || t === 'Kr') continue; // 三振/振り逃げ保留は投球側で処理済み
    if (/^Kw/.test(t)) {
      // 振り逃げ成功: 直前の投球結果を「振り逃げ」に書き換え(アプリの操作と同じ)
      for (let k = pitches.length - 1; k >= 0; k--) {
        if (!pitches[k].isEvent) { pitches[k] = { ...pitches[k], result: '振り逃げ' }; break; }
      }
      finalizePlay(parseComps(t), 'error');
      continue;
    }
    if (/^Bb/.test(t)) { finalizePlay(parseComps(t), 'walk'); continue; }
    if (/^Bd/.test(t)) { finalizePlay(parseComps(t), 'other', { resultStr: 'その他出塁' }); continue; }
    if (/^Db/.test(t)) { finalizePlay(parseComps(t), 'walk', { resultStr: '死球' }); continue; }

    // 牽制球(アプリでは投球記録として保存される)
    if ((m = t.match(/^Rq(\d)(\d)$/))) { emitPitch(`牽制(${m[2]}塁)`); continue; }

    // 盗塁・盗塁死・牽制死・捕逸・暴投・ボーク
    if (/^Rs/.test(t)) {
      const comps = parseComps(t).filter((c) => c.kind === 'J' && c.from >= 1 && c.to !== c.from);
      comps.sort((a, b) => b.from - a.from);
      comps.forEach((c) => { if (bases[c.from]) emitAdvance(c.from, c.to, '盗塁'); });
      continue;
    }
    if (/^R[fr]/.test(t)) {
      const reason = t[1] === 'f' ? '盗塁死' : '牽制死';
      const comps = parseComps(t);
      comps.sort((a, b) => b.from - a.from);
      comps.forEach((c) => {
        if (c.from < 1 || !bases[c.from]) return;
        if (c.kind === 'O' || c.kind === 'T') emitRunnerOut(c.from, reason);
        else if (c.kind === 'J' && c.to !== c.from) emitAdvance(c.from, c.to, '盗塁');
      });
      continue;
    }
    if (/^(Ep|Ew|Dk)/.test(t)) {
      const reason = t.startsWith('Ep') ? '捕逸' : t.startsWith('Ew') ? '暴投' : 'ボーク';
      const comps = parseComps(t);
      comps.sort((a, b) => b.from - a.from);
      comps.forEach((c) => {
        if (c.from < 1 || !bases[c.from]) return;
        if (c.kind === 'J' && c.to !== c.from) emitAdvance(c.from, c.to, reason);
        else if (c.kind === 'O' || c.kind === 'T') emitRunnerOut(c.from, '走塁死');
      });
      continue;
    }

    // インプレー
    if (/^H[1-4]/.test(t) || /^Go/.test(t) || /^Fo/.test(t)) { handleInPlay(t); continue; }

    // 選手交代系
    if ((m = t.match(/^Sj(\d)(\d)$/))) {
      const sk = tokens[i + 1]?.match(/^Sk(\d)(\d)#(\d+):?$/);
      if (sk) {
        const id = Number(sk[3]);
        const fromPos = Number(sk[1]);
        const toPos = Number(sk[2]);
        const team = teamOfPlayer(id) || fieldingTeam();
        if (team.defense[fromPos] === id) team.defense[fromPos] = null;
        assignDefense(team, toPos, id);
        emitEvent(`選手交代: [移]${playerOf(id).name} ${POS_CHAR[fromPos]}➡️${POS_CHAR[toPos]}`);
        i++; // 対のSkを消費
      }
      continue;
    }
    if ((m = t.match(/^Sd(\d)(\d)#(\d+):?$/))) {
      const [ord, pos, id] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const team = teamOfPlayer(id) || fieldingTeam();
      const oldId = team.slots[ord];
      const oldIdx = oldId != null ? team.defense.indexOf(oldId) : -1;
      if (oldIdx >= 0) team.defense[oldIdx] = null;
      team.slots[ord] = id;
      assignDefense(team, pos, id);
      team.ids.add(id);
      emitEvent(`選手交代: [退]${ord + 1}番/${oldIdx >= 0 ? POS_CHAR[oldIdx] : '?'} ${oldId != null ? playerOf(oldId).name : '?'} ➡️ [入]${POS_CHAR[pos]} ${playerOf(id).name} (守備交代)`);
      continue;
    }
    if ((m = t.match(/^Sh(\d)#(\d+):?$/))) {
      const [ord, id] = [Number(m[1]), Number(m[2])];
      const team = teamOfPlayer(id) || battingTeam();
      const oldId = team.slots[ord];
      const oldIdx = oldId != null ? team.defense.indexOf(oldId) : -1;
      if (oldIdx >= 0) team.defense[oldIdx] = null;
      team.slots[ord] = id;
      team.ids.add(id);
      emitEvent(`選手交代: [退]${ord + 1}番/${oldIdx >= 0 ? POS_CHAR[oldIdx] : '打'} ${oldId != null ? playerOf(oldId).name : '?'} ➡️ [入]打 ${playerOf(id).name} (代打)`);
      continue;
    }
    if ((m = t.match(/^Sr(\d)#(\d+):?$/))) {
      const [ord, id] = [Number(m[1]), Number(m[2])];
      const team = teamOfPlayer(id) || battingTeam();
      const oldId = team.slots[ord];
      const base = [1, 2, 3].find((b) => bases[b] === oldId);
      const oldIdx = oldId != null ? team.defense.indexOf(oldId) : -1;
      if (oldIdx >= 0) team.defense[oldIdx] = null;
      team.slots[ord] = id;
      team.ids.add(id);
      emitEvent(`選手交代: [退]${ord + 1}番 ${oldId != null ? playerOf(oldId).name : '?'} ➡️ [入]走 ${playerOf(id).name} (代走)`);
      if (base) {
        emitEvent(`${base}塁走者 に代走`);
        bases[base] = id;
      }
      continue;
    }
    if ((m = t.match(/^Si[hr](\d)#(\d+):?$/))) {
      // 代打/代走の選手がそのまま守備につく
      const [pos, id] = [Number(m[1]), Number(m[2])];
      const team = teamOfPlayer(id) || fieldingTeam();
      const prev = team.defense.indexOf(id);
      if (prev >= 0) team.defense[prev] = null;
      assignDefense(team, pos, id);
      emitEvent(`選手交代: [移]${playerOf(id).name} 打➡️${POS_CHAR[pos]}`);
      continue;
    }
    if (/^Sk/.test(t)) continue; // 対のSjで処理済み

    warn(`未対応トークン: ${t} (${inning}回${isTop ? '表' : '裏'})`);
  }

  // ---- 名簿にない投手の名前をti/bi(登板順の投手リスト)から補完 ----
  // 例: "[東]帯金(L)-宮下-永野-宮下-山下" → 登板順に照合し「選手2672」→「宮下」
  const renameMap = new Map();
  const fillPitcherNames = (side, biStr) => {
    const m = String(biStr || '').match(/^\[[^\]]*\](.+)$/);
    if (!m) return;
    const names = m[1].split('-').map((s) => s.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
    const stints = pitcherStints[side];
    if (names.length !== stints.length) return;
    stints.forEach((id, k) => {
      if (!names[k]) return;
      const p = roster.get(id);
      if (!p) {
        roster.set(id, { name: names[k], throws: '右', bats: '右' });
        renameMap.set(`選手${id}`, names[k]);
      } else if (/^選手\d+$/.test(p.name)) {
        renameMap.set(p.name, names[k]);
        p.name = names[k];
      }
    });
  };
  fillPitcherNames('top', game.ti);
  fillPitcherNames('bottom', game.bi);
  if (renameMap.size > 0) {
    pitches.forEach((p, i) => {
      const nn = { ...p };
      if (renameMap.has(nn.pitcherName)) nn.pitcherName = renameMap.get(nn.pitcherName);
      if (renameMap.has(nn.batterName)) nn.batterName = renameMap.get(nn.batterName);
      pitches[i] = nn;
    });
  }

  // ---- 出力の組み立て ----
  const giDate = cf.date || (game.tm ? new Date(game.tm).toISOString().slice(0, 10) : '');
  const gameInfo = {
    date: giDate,
    teamTop: game.tn || 'チーム(先攻)',
    teamBottom: game.bn || 'チーム(後攻)',
    tournament: cf.title || game.tt || '',
    venue: cf.stadi || game.pa || '',
    importedFrom: 'scorer',
  };

  const buildLineup = (team) => {
    const arr = team.slots.map((id, i) => {
      const p = id != null ? playerOf(id) : { name: `選手${i + 1}`, throws: '右', bats: '右' };
      return { order: i + 1, name: p.name, pos: id != null ? posCharOf(team, id) : '未', throws: p.throws, bats: p.bats };
    });
    // 10枠目: 投手が打順に入っていない場合のみ現投手を置く
    const pitcherId = team.defense[0];
    if (pitcherId != null && !team.slots.includes(pitcherId)) {
      const p = playerOf(pitcherId);
      arr.push({ order: '投', name: p.name, pos: '投', throws: p.throws, bats: p.bats });
    } else {
      arr.push({ order: '投', name: '先発投手', pos: '未', throws: '右', bats: '右' });
    }
    return arr;
  };

  const pad9 = (a) => { const r = [...a]; while (r.length < 9) r.push(0); return r; };
  const gameState = {
    inning, isTop, outs: 0, balls: 0, strikes: 0,
    batterTop: teams.top.nextSlot + 1, batterBottom: teams.bottom.nextSlot + 1,
    runners: { first: false, second: false, third: false },
    runs: { top: pad9(runs.top), bottom: pad9(runs.bottom) },
  };

  const savedGame = {
    id: `scorer-${game.gid || 0}-${game.tm || Date.now()}`,
    date: gameInfo.date,
    teamTop: gameInfo.teamTop,
    teamBottom: gameInfo.teamBottom,
    scoreTop: runs.top.reduce((a, b) => a + b, 0),
    scoreBottom: runs.bottom.reduce((a, b) => a + b, 0),
    pitchesCount: pitches.filter((p) => !p.isEvent || p.countAsPitch).length,
    data: {
      gameState,
      gameInfo,
      lineups: { top: buildLineup(teams.top), bottom: buildLineup(teams.bottom) },
      pitches,
    },
  };

  const playerNames = {};
  roster.forEach((p, id) => { playerNames[id] = p.name; });
  return { savedGame, warnings, runs: { top: [...runs.top], bottom: [...runs.bottom] }, scoredIds, playerNames };
}
