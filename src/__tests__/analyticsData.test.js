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
  it('counts positional single/double results and out-less plays correctly',()=>{
    // アプリは守備位置を頭に付けて記録する(単打=「遊安」など)。累計分析でも安打として拾えること。
    const mk=(batter,name,result)=>({inning:1,isTop:true,batter,batterName:name,pitcherName:'相P',pitchNumber:1,result});
    const g={ id:'g2', date:'2026-07-05', teamTop:'自軍', teamBottom:'相手', data:{ gameInfo:{gameType:'公式戦'},
      gameState:{runs:{top:[0],bottom:[0]},earnedRuns:{top:[0],bottom:[0]}},
      lineups:{top:[{name:'A',order:1},{name:'B',order:2},{name:'C',order:3},{name:'D',order:4},{name:'E',order:5},{name:'F',order:6}],bottom:[{name:'相P',order:1}]},
      pitches:[ mk(1,'A','遊安'), mk(2,'B','中二塁打'), mk(3,'C','投併殺打'), mk(4,'D','三エラー'), mk(5,'E','捕犠打'), mk(6,'F','四球') ] }};
    const db=normalizeArchive([g],[{name:'自軍',players:[{name:'A'},{name:'B'},{name:'C'},{name:'D'},{name:'E'},{name:'F'}]}],'自軍');
    const own=db.teams.find(t=>t.name==='自軍');
    const stats=buildAnalytics(db,{teamId:own.id});
    // 安打2(単打+二塁打)、塁打1+2=3
    expect(stats.batting.H).toBe(2);
    expect(stats.batting.AB).toBe(4); // 単打+二塁打+併殺打+失策到達(犠打と四球は打数外)
    expect(stats.batting.SLG).toBe('0.750'); // 塁打3 / 打数4
    // OBP分母は犠打1を除外: PA6 - 犠打1 = 5、出塁(安2+四球1)=3 -> .600
    expect(stats.batting.OBP).toBe('0.600');
    // 併殺打=2アウト、失策到達=0アウト、単打/二塁打/四球=0アウト、犠打=1アウト -> 計3アウト = 1.0回
    const opp=db.teams.find(t=>t.name==='相手');
    expect(buildAnalytics(db,{teamId:opp.id}).pitching.IP).toBe('1.0');
  });
  it('filters non-zero-padded saved dates with date input values',()=>{
    const july={...game,id:'july',date:'2026-7-2'};
    const october={...game,id:'october',date:'2026-10-2'};
    const db=normalizeArchive([july,october],[{name:'自軍',players:[{name:'山田'}]}],'自軍');
    const own=db.teams.find(t=>t.name==='自軍');
    const stats=buildAnalytics(db,{teamId:own.id,from:'2026-07-01',to:'2026-07-31'});
    expect(stats.games.map(g=>g.id)).toEqual(['july']);
  });
});
