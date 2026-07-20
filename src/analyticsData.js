const terminalWords = ['安', '塁打', '本塁打', '三振', '振り逃げ', '四球', '死球', '犠打', '犠飛', 'インプレー', 'ゴロ', '飛', '直', 'エラー', '野選', 'バント'];

const id = (prefix, ...parts) => `${prefix}_${parts.map(v => String(v ?? '').replace(/[^\w\u3000-\u9fff-]/g, '_')).join('_')}`;
const rate = (a, b, digits = 3) => b ? (a / b).toFixed(digits) : (0).toFixed(digits);
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const isHit = result => ['安打', '二塁打', '三塁打', '本塁打'].some(v => result?.includes(v));
const bases = result => result?.includes('本塁打') ? 4 : result?.includes('三塁打') ? 3 : result?.includes('二塁打') ? 2 : isHit(result) ? 1 : 0;
const isStrike = result => !['ボール', 'ウエスト', '死球'].includes(result);

export function normalizeArchive(savedGames = [], registeredTeams = [], homeTeamName = '') {
  const teams = new Map();
  const players = new Map();
  const games = [];
  const gameRosters = [];
  const plateAppearances = [];
  const pitches = [];
  const battingEvents = [];
  const pitchingEvents = [];
  const fieldingEvents = [];
  const baserunningEvents = [];

  registeredTeams.forEach((team, ti) => {
    const teamId = id('team', team.name || ti);
    teams.set(team.name, { id: teamId, name: team.name, role: team.name === homeTeamName ? 'own' : 'opponent' });
    (team.players || []).forEach((raw, pi) => {
      const player = typeof raw === 'string' ? { name: raw } : raw;
      const playerId = id('player', team.name, player.name || pi);
      players.set(`${team.name}|${player.name}`, { id: playerId, teamId, name: player.name, throws: player.throws || '右', bats: player.bats || '右' });
    });
  });

  savedGames.forEach((game, gi) => {
    const gameId = String(game.id || id('game', game.date, gi));
    ['top', 'bottom'].forEach(side => {
      const name = side === 'top' ? game.teamTop : game.teamBottom;
      if (!teams.has(name)) teams.set(name, { id: id('team', name), name, role: name === homeTeamName ? 'own' : 'opponent' });
      ((game.data?.lineups || {})[side] || []).filter(p => p?.name).forEach((p, pi) => {
        const key = `${name}|${p.name}`;
        if (!players.has(key)) players.set(key, { id: id('player', name, p.name), teamId: teams.get(name).id, name: p.name, throws: p.throws || '右', bats: p.bats || '右' });
        gameRosters.push({ id: id('roster', gameId, side, pi), gameId, teamId: teams.get(name).id, playerId: players.get(key).id, side, battingOrder: p.order || pi + 1, position: p.pos || '' });
      });
    });
    const top = game.data?.gameState?.runs?.top || [];
    const bottom = game.data?.gameState?.runs?.bottom || [];
    games.push({ id: gameId, date: game.date, gameType: game.gameType || game.data?.gameInfo?.gameType || '未設定', topTeamId: teams.get(game.teamTop)?.id, bottomTeamId: teams.get(game.teamBottom)?.id, teamTop: game.teamTop, teamBottom: game.teamBottom, scoreTop: top.reduce((a,b)=>a+(b||0),0), scoreBottom: bottom.reduce((a,b)=>a+(b||0),0), runsTop: top, runsBottom: bottom });

    const rawPitches = game.data?.pitches || [];
    let current = [], paIndex = 0;
    const flush = () => {
      if (!current.length) return;
      const nonEvents = current.filter(p => !p.isEvent), last = nonEvents.at(-1) || current.at(-1), first = current[0];
      const battingTeam = first.isTop ? game.teamTop : game.teamBottom;
      const fieldingTeam = first.isTop ? game.teamBottom : game.teamTop;
      const paId = id('pa', gameId, paIndex++);
      const result = last?.result || current.at(-1)?.result || '';
      const balls = nonEvents.filter(p => ['ボール','ウエスト'].includes(p.result)).length;
      const strikes = nonEvents.filter(p => ['ストライク','空振り','バント空振り'].includes(p.result)).length;
      const hit = isHit(result), walk = balls >= 4 || ['四球','死球'].includes(result), strikeout = strikes >= 3 || ['三振','振り逃げ','振り逃げアウト','スリーバント失敗'].includes(result);
      const batterId = players.get(`${battingTeam}|${last?.batterName}`)?.id || id('player', battingTeam, last?.batterName || '不明');
      const pitcherId = players.get(`${fieldingTeam}|${last?.pitcherName}`)?.id || id('player', fieldingTeam, last?.pitcherName || '不明');
      plateAppearances.push({ id: paId, gameId, inning: first.inning, half: first.isTop ? 'top' : 'bottom', battingTeamId: teams.get(battingTeam)?.id, fieldingTeamId: teams.get(fieldingTeam)?.id, batterId, pitcherId, batterName: last?.batterName || '不明', pitcherName: last?.pitcherName || '不明', batterBats: last?.batterBats || '', pitcherThrows: last?.pitcherThrows || '', battingOrder: last?.batter, result, isHit: hit, isWalk: walk, isStrikeout: strikeout, totalBases: bases(result), isAtBat: !walk && !result.includes('犠'), pitches: nonEvents.length });
      battingEvents.push({ id: id('bat', paId), plateAppearanceId: paId, gameId, teamId: teams.get(battingTeam)?.id, playerId: batterId, result, totalBases: bases(result), direction: last?.hitCoord || last?.direction || null, isBunt: result.includes('バント') || result.includes('犠打') });
      pitchingEvents.push({ id: id('pit', paId), plateAppearanceId: paId, gameId, teamId: teams.get(fieldingTeam)?.id, playerId: pitcherId, result, hitAllowed: hit, walkAllowed: walk, strikeout });
      current.filter(p => p.isEvent).forEach((event, ei) => {
        if (/盗塁|進塁|牽制/.test(event.result || '')) baserunningEvents.push({ id: id('run', paId, ei), gameId, plateAppearanceId: paId, teamId: teams.get(battingTeam)?.id, result: event.result, success: !/死|アウト/.test(event.result) });
        if (/失策|エラー/.test(event.result || '')) fieldingEvents.push({ id: id('field', paId, ei), gameId, plateAppearanceId: paId, teamId: teams.get(fieldingTeam)?.id, result: event.result });
      });
      current = [];
    };
    rawPitches.forEach((pitch, pi) => {
      if (!pitch.isEvent && pitch.pitchNumber === 1 && current.some(p => !p.isEvent)) flush();
      const pitchId = id('pitch', gameId, pi);
      pitches.push({ ...pitch, id: pitchId, gameId, plateAppearanceId: null, count: pitch.count || null, isFirstPitch: pitch.pitchNumber === 1, isStrike: isStrike(pitch.result), isSwing: /空振り|ファウル|インプレー|安打|塁打|ゴロ|飛|直|バント/.test(pitch.result || '') });
      current.push(pitch);
      if (!pitch.isEvent && terminalWords.some(w => pitch.result?.includes(w))) flush();
    });
    flush();
  });
  return { schemaVersion: 1, teams: [...teams.values()], players: [...players.values()], games, gameRosters, plateAppearances, pitches, battingEvents, pitchingEvents, fieldingEvents, baserunningEvents };
}

export function buildAnalytics(db, filters = {}) {
  const team = db.teams.find(t => t.id === filters.teamId) || db.teams[0];
  if (!team) return { team: null, games: [], wins: 0, losses: 0, runsFor: 0, runsAgainst: 0, batting: { OBP:'0.000', SLG:'0.000', OPS:'0.000', KPct:0, BBPct:0 }, pitching: { AVG:'0.000', WHIP:'0.000', firstStrikePct:0 }, innings: [], players: [], patterns: [] };
  const games = db.games.filter(g => (g.topTeamId === team.id || g.bottomTeamId === team.id) && (!filters.from || g.date >= filters.from) && (!filters.to || g.date <= filters.to) && (!filters.opponentId || [g.topTeamId,g.bottomTeamId].includes(filters.opponentId)) && (!filters.gameType || filters.gameType === 'ALL' || g.gameType === filters.gameType));
  const gids = new Set(games.map(g => g.id));
  const pas = db.plateAppearances.filter(pa => gids.has(pa.gameId));
  const battingPa = pas.filter(pa => pa.battingTeamId === team.id && (!filters.playerId || pa.batterId === filters.playerId));
  const pitchingPa = pas.filter(pa => pa.fieldingTeamId === team.id && (!filters.playerId || pa.pitcherId === filters.playerId));
  const AB = battingPa.filter(pa => pa.isAtBat).length, H = battingPa.filter(pa => pa.isHit).length, BB = battingPa.filter(pa => pa.isWalk).length, TB = battingPa.reduce((n,pa)=>n+pa.totalBases,0), K = battingPa.filter(pa=>pa.isStrikeout).length;
  const teamPitches = db.pitches.filter(p => gids.has(p.gameId) && pitchingPa.some(pa => pa.gameId === p.gameId && pa.pitcherName === p.pitcherName));
  const first = teamPitches.filter(p=>p.isFirstPitch), firstStrikes = first.filter(p=>p.isStrike).length;
  let runsFor=0, runsAgainst=0, wins=0, losses=0; const inningMap = new Map();
  games.forEach(g => { const ownTop=g.topTeamId===team.id, rf=ownTop?g.scoreTop:g.scoreBottom, ra=ownTop?g.scoreBottom:g.scoreTop; runsFor+=rf; runsAgainst+=ra; if(rf>ra)wins++; else if(rf<ra)losses++; const own=ownTop?g.runsTop:g.runsBottom, opp=ownTop?g.runsBottom:g.runsTop; for(let i=0;i<Math.max(own.length,opp.length);i++){const x=inningMap.get(i+1)||{inning:i+1,for:0,against:0};x.for+=own[i]||0;x.against+=opp[i]||0;inningMap.set(i+1,x);} });
  const playerRows = db.players.filter(p=>p.teamId===team.id).map(player => { const bp=battingPa.filter(pa=>pa.batterId===player.id), pp=pitchingPa.filter(pa=>pa.pitcherId===player.id), ab=bp.filter(pa=>pa.isAtBat).length,h=bp.filter(pa=>pa.isHit).length,bb=bp.filter(pa=>pa.isWalk).length,tb=bp.reduce((n,pa)=>n+pa.totalBases,0); return {...player, PA:bp.length, AVG:rate(h,ab), OBP:rate(h+bb,bp.length), SLG:rate(tb,ab), OPS:(Number(rate(h+bb,bp.length))+Number(rate(tb,ab))).toFixed(3), K:bp.filter(pa=>pa.isStrikeout).length, pitchingPA:pp.length, HAllowed:pp.filter(pa=>pa.isHit).length, BBAllowed:pp.filter(pa=>pa.isWalk).length, SO:pp.filter(pa=>pa.isStrikeout).length}; }).filter(p=>p.PA||p.pitchingPA);
  const patterns = [{label:'先制した試合',value:games.filter(g=>{const ownTop=g.topTeamId===team.id;for(let i=0;i<9;i++){const a=(ownTop?g.runsTop:g.runsBottom)[i]||0,b=(ownTop?g.runsBottom:g.runsTop)[i]||0;if(a||b)return a>b;}return false;}).length},{label:'終盤（7回以降）の得点',value:[...inningMap.values()].filter(x=>x.inning>=7).reduce((n,x)=>n+x.for,0)},{label:'終盤（7回以降）の失点',value:[...inningMap.values()].filter(x=>x.inning>=7).reduce((n,x)=>n+x.against,0)}];
  return { team, games, wins, losses, runsFor, runsAgainst, innings:[...inningMap.values()], batting:{PA:battingPa.length,AB,H,BB,K,OBP:rate(H+BB,battingPa.length),SLG:rate(TB,AB),OPS:(Number(rate(H+BB,battingPa.length))+Number(rate(TB,AB))).toFixed(3),KPct:pct(K,battingPa.length),BBPct:pct(BB,battingPa.length)}, pitching:{PA:pitchingPa.length,H:pitchingPa.filter(pa=>pa.isHit).length,BB:pitchingPa.filter(pa=>pa.isWalk).length,K:pitchingPa.filter(pa=>pa.isStrikeout).length,AVG:rate(pitchingPa.filter(pa=>pa.isHit).length,pitchingPa.filter(pa=>pa.isAtBat).length),WHIP:rate(pitchingPa.filter(pa=>pa.isHit||pa.isWalk).length,Math.max(1,games.length*7)),firstStrikePct:pct(firstStrikes,first.length)}, players:playerRows, patterns };
}
