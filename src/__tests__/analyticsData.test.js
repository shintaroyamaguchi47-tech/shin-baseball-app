import { describe, expect, it } from 'vitest';
import { buildAnalytics, buildPlayerCard, buildScoutingReport, normalizeArchive } from '../analyticsData.js';

const game = { id:'g1', date:'2026-07-01', teamTop:'自軍', teamBottom:'相手', data:{ gameInfo:{gameType:'練習試合'}, gameState:{runs:{top:[1,0,2],bottom:[0,1,0]},earnedRuns:{top:[1,0,1],bottom:[0,0,0]}}, lineups:{top:[{name:'山田',order:1,pos:'遊'}],bottom:[{name:'佐藤',order:1,pos:'投'}]}, pitches:[
  {inning:1,isTop:true,batter:1,batterName:'山田',pitcherName:'佐藤',pitchNumber:1,result:'ボール'},
  {inning:1,isTop:true,batter:1,batterName:'山田',pitcherName:'佐藤',pitchNumber:2,result:'安打'},
  {inning:1,isTop:false,batter:1,batterName:'佐藤',pitcherName:'山田',pitchNumber:1,result:'ストライク'},
  {inning:1,isTop:false,batter:1,batterName:'佐藤',pitcherName:'山田',pitchNumber:2,result:'三振'},
]}};

describe('analytics normalized view',()=>{
  it('keeps teams separate and recalculates cumulative stats',()=>{
    const db=normalizeArchive([game],[{name:'自軍',players:[{name:'山田'}]}],'自軍');
    expect(db.games).toHaveLength(1); expect(db.plateAppearances).toHaveLength(2);
    const own=db.teams.find(t=>t.name==='自軍'); const stats=buildAnalytics(db,{teamId:own.id});
    expect(stats.runsFor).toBe(3); expect(stats.runsAgainst).toBe(1); expect(stats.batting.H).toBe(1); expect(stats.pitching.K).toBe(1);
    expect(stats.pitching.IP).toBe('0.3');
    expect(stats.earnedRunsAgainst).toBe(0);
    expect(stats.pitching.ERA).toBe('0.00');
    expect(stats.pitching.RA7).toBe('21.00');
    expect(stats.patterns.some(p=>p.label==='先制時勝率')).toBe(true);
    const player=db.players.find(p=>p.name==='山田');
    expect(buildPlayerCard(db,stats,player.id).logs).toHaveLength(1);
    expect(buildScoutingReport(db,stats).byOrder).toHaveLength(9);
  });
});
