import React from 'react';
import SprayChart from './SprayChart.jsx';
import AnalystReport from './AnalystReport.jsx';
import PlayByPlayReport from './PlayByPlayReport.jsx';

// 試合終了後の分析レポート(全画面モーダル)。
// 表示専用: 受け取った集計をそのまま描くだけで、試合データは書き換えない。
// App.jsx から切り出して、記録入力のロジックと画面の組み立てを分けている。
export default function PostGameReport({
  gameInfo,
  gameState,
  pitches,
  advancedStats,
  analystInsights,
  hitsAndErrors,
  playByPlayReport,
  pbpScrollTarget,
  onPbpScrolled,
  onPrint,
  onClose,
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[200] flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-200 p-4 flex justify-between items-center shrink-0">
        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">🏁 試合分析レポート</h2>
        <div className="flex gap-2">
          <button onClick={onPrint} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm">🖨️ 印刷 / PDF</button>
          <button onClick={() => onClose()} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold border border-slate-300">✕ 閉じる</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 modal-scroll">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Score summary */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-black text-slate-800 mb-4">{gameInfo.date} — {gameInfo.teamTop} vs {gameInfo.teamBottom}</h3>
            <div className="text-center text-4xl font-black text-blue-700 mb-4">
              {gameState.runs.top.reduce((a,b)=>a+b,0)} - {gameState.runs.bottom.reduce((a,b)=>a+b,0)}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">投球数</div><div className="text-2xl font-black text-slate-800">{pitches.filter(p=>!p.isEvent||p.countAsPitch).length}</div></div>
              <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">{gameInfo.teamTop} 打率</div><div className="text-2xl font-black text-blue-700">{advancedStats.topBatting.team.AVG}</div></div>
              <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">{gameInfo.teamBottom} 打率</div><div className="text-2xl font-black text-blue-700">{advancedStats.bottomBatting.team.AVG}</div></div>
              <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">H / E</div><div className="text-lg font-black text-slate-800">{hitsAndErrors.top.hits}H-{hitsAndErrors.top.errors}E / {hitsAndErrors.bottom.hits}H-{hitsAndErrors.bottom.errors}E</div></div>
            </div>
          </div>

          {/* 打席速報(実況文+カウント推移+打球図)。簡易版テキスト速報を置き換え */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-black text-slate-800 mb-4">📰 打席速報</h3>
            <PlayByPlayReport report={playByPlayReport} gameInfo={gameInfo} defaultOpenLast scrollTarget={pbpScrollTarget} onScrolled={() => onPbpScrolled()} />
          </div>

          {/* Spray charts */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-black text-slate-800 mb-4">🎯 チーム打球方向</h3>
            <div className="flex flex-wrap gap-6 justify-center">
              <SprayChart hits={advancedStats.topBatting.team.sprayHits} title={gameInfo.teamTop} size={200} />
              <SprayChart hits={advancedStats.bottomBatting.team.sprayHits} title={gameInfo.teamBottom} size={200} />
            </div>
            <div className="text-[10px] text-slate-500 text-center mt-4">青=安打 / 赤=凡打 / 橙=失策 / 紫=ファウル｜波線=ゴロ / 破線=フライ / 直線=ライナー / 太弧=HR</div>
          </div>

          {/* アナリスト指標 */}
          <AnalystReport insights={analystInsights} />

          {/* Batting tables + individual spray charts */}
          {[{data: advancedStats.topBatting, name: gameInfo.teamTop}, {data: advancedStats.bottomBatting, name: gameInfo.teamBottom}].map(({data, name}) => (
            <div key={name} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-base font-black text-slate-800 mb-4">🏏 打者成績: {name}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead><tr className="bg-slate-100 border-b-2 border-slate-300">
                    <th className="py-2 px-2 text-left">順</th><th className="py-2 px-2 text-left">選手名</th><th className="py-2 px-2 text-center">守備</th><th className="py-2 px-2 text-center">投打</th><th className="py-2 px-2 text-right">打数</th><th className="py-2 px-2 text-right">安打</th><th className="py-2 px-2 text-right">四死</th><th className="py-2 px-2 text-right text-blue-600">打率</th><th className="py-2 px-2 text-right text-amber-600">OPS</th><th className="py-2 px-2 text-right text-rose-600">K%</th><th className="py-2 px-2 text-left">結果</th>
                  </tr></thead>
                  <tbody>
                    {data.players.filter(p => p.PA > 0).map((p, i) => (
                      <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50'}`}>
                        <td className="py-2 px-2 font-bold text-slate-400">{p.order}</td><td className="py-2 px-2 font-black text-slate-800">{p.name}</td>
                        <td className="py-2 px-2 text-center text-slate-500">{p.pos || '-'}</td><td className="py-2 px-2 text-center text-slate-500 text-[10px] whitespace-nowrap">{(p.throws || '?') + '投/' + (p.bats || '?') + '打'}</td>
                        <td className="py-2 px-2 text-right">{p.AB}</td><td className="py-2 px-2 text-right">{p.H}</td><td className="py-2 px-2 text-right">{p.BB_HBP}</td>
                        <td className="py-2 px-2 text-right text-blue-600 font-bold">{p.AVG}</td><td className="py-2 px-2 text-right text-amber-600 font-bold">{p.OPS}</td><td className="py-2 px-2 text-right text-rose-600">{p.KPct}%</td>
                        <td className="py-2 px-2 text-[10px] text-slate-500 max-w-[260px] align-top">
                          <div className="flex flex-wrap gap-1">
                            {p.results.length ? p.results.map((r, ri) => <span key={ri} className="inline-block px-2 py-[1px] rounded-full bg-indigo-50 text-slate-700 leading-snug">{r}</span>) : <span className="text-slate-400">-</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Per-at-bat pitch breakdown with mini strike zone */}
              {(() => {
                const ptColors = {
                  'ストレート': '#ef4444',
                  'スライダー': '#3b82f6',
                  'シュート':   '#10b981',
                  'カーブ':     '#f59e0b',
                  '落ちる球':  '#6366f1',
                  'シンカー':  '#06b6d4',
                };
                const cs = 11; // cell size px
                const svgSz = cs * 7;
                const renderAbZone = (abPitches) => {
                  // group pitches by course to handle overlaps
                  const byPos = {};
                  abPitches.forEach((p, i) => {
                    if (p.course !== null && p.course !== undefined) {
                      if (!byPos[p.course]) byPos[p.course] = [];
                      byPos[p.course].push({ ...p, seq: i + 1 });
                    }
                  });
                  const r = cs / 2 - 1.2;
                  return (
                    <svg width={svgSz} height={svgSz} style={{display:'block'}}>
                      {Array.from({length: 49}, (_, idx) => {
                        const row = Math.floor(idx / 7), col = idx % 7;
                        const isZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                        return (
                          <rect key={idx} x={col*cs} y={row*cs} width={cs-0.5} height={cs-0.5}
                            fill={isZone ? '#f0f9ff' : '#f8fafc'}
                            stroke={isZone ? '#bae6fd' : '#e2e8f0'} strokeWidth="0.4" />
                        );
                      })}
                      <rect x={2*cs} y={2*cs} width={3*cs} height={3*cs} fill="none" stroke="#475569" strokeWidth="1.5" rx="0.5" />
                      {Object.entries(byPos).map(([course, ps]) => {
                        const cIdx = parseInt(course);
                        const row = Math.floor(cIdx / 7), col = cIdx % 7;
                        const baseCx = col*cs + cs/2, baseCy = row*cs + cs/2;
                        return ps.map((p, pIdx) => {
                          const angle = ps.length > 1 ? (pIdx / ps.length) * Math.PI * 2 - Math.PI/2 : 0;
                          const dist = ps.length > 1 ? r * 0.55 : 0;
                          const cx = baseCx + Math.cos(angle) * dist;
                          const cy = baseCy + Math.sin(angle) * dist;
                          const color = ptColors[p.type] || '#94a3b8';
                          const isBall = ['ボール','ウエスト'].includes(p.result);
                          const isLastPitch = p.seq === abPitches.length;
                          return (
                            <g key={pIdx}>
                              {isLastPitch && <circle cx={cx} cy={cy} r={r+2} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 1" opacity="0.7" />}
                              <circle cx={cx} cy={cy} r={r}
                                fill={isBall ? 'white' : color}
                                stroke={color} strokeWidth={isBall ? 1.2 : 0}
                                opacity={0.92} />
                              <text x={cx} y={cy+2.2} textAnchor="middle" fontSize="5" fontWeight="900"
                                fill={isBall ? color : 'white'}>{p.seq}</text>
                            </g>
                          );
                        });
                      })}
                    </svg>
                  );
                };
                const getResultLabel = (result) => {
                  // 打席結果は deriveFinalLabel で「四球」「三振」に直してから渡ってくる。
                  // 旧データ(最終球のまま保存された記録)のために素の投球結果も拾う。
                  if (['四球','ボール','ウエスト'].includes(result)) return { text: '四球', color: '#64748b' };
                  if (result === '死球') return { text: '死球', color: '#64748b' };
                  if (['三振','スリーバント失敗','振り逃げアウト','ストライク','空振り'].includes(result)) return { text: '三振', color: '#ef4444' };
                  if (result === '振り逃げ') return { text: '振り逃げ', color: '#0891b2' };
                  if (['安','塁打','本塁打'].some(w => result.includes(w))) return { text: result, color: '#1d4ed8' };
                  return { text: result, color: '#475569' };
                };
                const playersWithABs = data.players.filter(bp => bp.PA > 0 && bp.atBats && bp.atBats.length > 0);
                if (!playersWithABs.length) return null;
                return (
                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <h4 className="text-sm font-black text-slate-700 mb-2">📋 打席内容 <span className="text-xs font-normal text-slate-400">(配球・打球方向)</span></h4>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[10px] text-slate-500 items-center">
                      {Object.entries(ptColors).map(([n,c]) => (
                        <span key={n} className="flex items-center gap-1">
                          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={c} /></svg>{n}
                        </span>
                      ))}
                      <span className="text-slate-300 mx-1">|</span>
                      <span>○=ボール ●=ストライク系 数字=投球順 点線=最終球</span>
                    </div>
                    <div className="space-y-4">
                      {playersWithABs.map((batter, bi) => (
                        <div key={bi} className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                          <div className="text-xs font-black text-slate-700 mb-3">
                            {batter.order}番 {batter.name}
                            <span className="ml-2 text-slate-400 font-normal text-[10px]">{batter.AB}打数 {batter.H}安打 打率{batter.AVG}</span>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {batter.atBats.map((ab, abIdx) => {
                              const rl = getResultLabel(ab.result);
                              return (
                                <div key={abIdx} className="flex flex-col items-center gap-1" style={{minWidth: svgSz * 2 + 6, maxWidth: svgSz * 2 + 14}}>
                                  <div className="text-[10px] text-slate-500 font-bold">{ab.inning}回{ab.isTop?'表':'裏'}</div>
                                  <div className="flex items-start gap-1.5">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] font-bold text-slate-400">配球</span>
                                      <div style={{border:'1px solid #e2e8f0',borderRadius:6,overflow:'hidden',background:'white'}}>
                                        {renderAbZone(ab.pitches)}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] font-bold text-slate-400">打球方向</span>
                                      <SprayChart hits={ab.sprayHit ? [ab.sprayHit] : []} size={svgSz} compact emptyLabel="打球なし" />
                                    </div>
                                  </div>
                                  <div className="text-[10px] font-black text-center leading-snug px-1" style={{color: rl.color, maxWidth: svgSz * 2 + 8, overflowWrap: 'anywhere'}}>{rl.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="mt-6">
                <h4 className="text-sm font-black text-slate-700 mb-3">🎯 打者別 打球方向</h4>
                <div className="flex flex-wrap gap-4 justify-center">
                  {data.players.filter(p => p.sprayHits && p.sprayHits.length > 0).map((p, i) => (
                    <SprayChart key={i} hits={p.sprayHits} title={`${p.order}番 ${p.name}`} size={160} />
                  ))}
                  {data.players.filter(p => p.sprayHits && p.sprayHits.length > 0).length === 0 && (
                    <p className="text-xs text-slate-400 py-4">打球データがありません</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Pitching stats with charts */}
          {[{data: advancedStats.pitchingTop, name: gameInfo.teamTop, label: '先攻投手陣'}, {data: advancedStats.pitchingBottom, name: gameInfo.teamBottom, label: '後攻投手陣'}].map(({data, name, label}) => (
            <div key={label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-base font-black text-slate-800 mb-4">⚾ {label}: {name}</h3>
              {data.pitchers.map((p, pi) => {
                const pieColors = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
                const pieTotal = p.types.reduce((s,t) => s + t.total, 0);
                const allPitchTypes = [...new Set(p.types.map(t => t.type))];
                const countLabels = [{key:'ahead',label:'投手有利',color:'#3b82f6'},{key:'even',label:'並行',color:'#64748b'},{key:'behind',label:'打者有利',color:'#ef4444'}];
                const countDataAll = {};
                ['vsRight','vsLeft'].forEach(side => {
                  countLabels.forEach(cl => {
                    const cObj = p.counts[side][cl.key];
                    Object.entries(cObj.types || {}).forEach(([type, cnt]) => {
                      if (!countDataAll[cl.key]) countDataAll[cl.key] = {};
                      countDataAll[cl.key][type] = (countDataAll[cl.key][type] || 0) + cnt;
                    });
                  });
                });
                const countCourseAll = {};
                const hmAll = {};
                allPitchTypes.forEach(type => { hmAll[type] = {}; });
                countLabels.forEach(cl => { countCourseAll[cl.key] = {}; allPitchTypes.forEach(type => { countCourseAll[cl.key][type] = {}; }); });
                if (p.pitchTypeHeatmaps) {
                  Object.entries(p.pitchTypeHeatmaps).forEach(([type, hm]) => {
                    if (!hmAll[type]) hmAll[type] = {};
                    Object.entries(hm.all || {}).forEach(([c, cnt]) => { hmAll[type][c] = (hmAll[type][c] || 0) + cnt; });
                    countLabels.forEach(cl => {
                      if (!countCourseAll[cl.key][type]) countCourseAll[cl.key][type] = {};
                      Object.entries(hm[cl.key] || {}).forEach(([c, cnt]) => { countCourseAll[cl.key][type][c] = (countCourseAll[cl.key][type][c] || 0) + cnt; });
                    });
                  });
                }
                const renderHeatmap = (hmData, color, size) => {
                  const mx = Math.max(1, ...Object.values(hmData).map(Number));
                  const cs = size === 'sm' ? 8 : 12;
                  const ts = cs * 7;
                  const zs = cs * 2;
                  const zw = cs * 3;
                  return (
                    <svg width={ts} height={ts} viewBox={`0 0 ${ts} ${ts}`}>
                      {Array.from({length: 49}, (_, idx) => {
                        const row = Math.floor(idx / 7), col = idx % 7;
                        const x = col * cs, y = row * cs;
                        const isZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                        const cnt = hmData[idx] || 0;
                        const intensity = cnt > 0 ? Math.max(0.18, cnt / mx) : 0;
                        return <rect key={idx} x={x} y={y} width={cs - 0.5} height={cs - 0.5} rx="1"
                          fill={cnt > 0 ? color : (isZone ? '#f1f5f9' : '#f8fafc')}
                          opacity={cnt > 0 ? intensity : 1}
                          stroke={isZone ? '#cbd5e1' : '#e2e8f0'} strokeWidth="0.3" />;
                      })}
                      <rect x={zs} y={zs} width={zw} height={zw} fill="none" stroke="#64748b" strokeWidth="1" rx="0.5" />
                      {size !== 'sm' && Array.from({length: 49}, (_, idx) => {
                        const cnt = hmData[idx] || 0;
                        if (cnt === 0) return null;
                        const row = Math.floor(idx / 7), col = idx % 7;
                        return <text key={`t${idx}`} x={col * cs + cs/2} y={row * cs + cs/2 + 2} textAnchor="middle" fontSize="5.5" fontWeight="900" fill="white">{cnt}</text>;
                      })}
                    </svg>
                  );
                };
                const allCourseData = {};
                Object.values(hmAll).forEach(typeMap => { Object.entries(typeMap).forEach(([c, cnt]) => { allCourseData[c] = (allCourseData[c] || 0) + cnt; }); });
                return (
                <div key={pi} className="mb-8 last:mb-0 bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="font-black text-lg text-slate-800">{p.name} <span className="text-sm text-slate-500 font-bold ml-2">{p.total}球</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">CSW%</div><div className="text-2xl font-black text-amber-600">{p.csw}%</div></div>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">Whiff%</div><div className="text-2xl font-black text-rose-600">{p.whiff}%</div></div>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">初球S率</div><div className="text-2xl font-black text-blue-600">{p.fStrikePct}%</div></div>
                  </div>

                  {/* === SECTION: スプリット === */}
                  {p.sideStats && (
                    <div className="flex flex-col sm:flex-row gap-3 mb-4">
                      {[{label:'🆚 対左右', rows:[{name:'対右', d:p.sideStats.right},{name:'対左', d:p.sideStats.left}]}, {label:'📊 打順', rows:[{name:'上位 1〜5番', d:p.orderStats.top},{name:'下位 6〜9番', d:p.orderStats.bottom}]}].map(({label, rows}) => (
                        <div key={label} className="flex-1 bg-white rounded-xl border border-slate-200 p-3">
                          <div className="text-[10px] font-black text-slate-600 mb-2">{label}</div>
                          <table className="w-full text-[10px] border-collapse">
                            <thead><tr className="border-b border-slate-200 bg-slate-50">
                              <th className="py-1 px-1 text-left font-black text-slate-500"></th>
                              <th className="py-1 px-1 text-right font-black text-slate-500">打席</th>
                              <th className="py-1 px-1 text-right font-black text-slate-500">投球</th>
                              <th className="py-1 px-1 text-right font-black text-sky-600">S%</th>
                              <th className="py-1 px-1 text-right font-black text-blue-600">被打率</th>
                              <th className="py-1 px-1 text-right font-black text-rose-600">K%</th>
                              <th className="py-1 px-1 text-right font-black text-emerald-600">BB%</th>
                            </tr></thead>
                            <tbody>
                              {rows.map(({name, d}, ri) => (
                                <tr key={ri} className={`border-b border-slate-100 ${ri%2===1?'bg-slate-50':''}`}>
                                  <td className="py-1 px-1 font-bold text-slate-700">{name}</td>
                                  <td className="py-1 px-1 text-right">{d.PA}</td>
                                  <td className="py-1 px-1 text-right">{d.total}</td>
                                  <td className="py-1 px-1 text-right text-sky-600 font-bold">{d.sPct}%</td>
                                  <td className="py-1 px-1 text-right text-blue-600 font-bold">{d.AVG}</td>
                                  <td className="py-1 px-1 text-right text-rose-600 font-bold">{d.KPct}%</td>
                                  <td className="py-1 px-1 text-right text-emerald-600 font-bold">{d.BBPct}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* === SECTION: 全体 === */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
                    <div className="text-xs font-black text-slate-700 mb-3">📊 全体 — 球種割合 & コース分布</div>
                    <div className="flex flex-col sm:flex-row gap-4">
                      {/* Left: pitch type table (numbers only) */}
                      <div className="sm:w-48 shrink-0">
                        <table className="w-full text-[10px] border-collapse">
                          <thead><tr className="border-b border-slate-200 bg-slate-50">
                            <th className="py-1 px-1.5 text-left font-black text-slate-600">球種</th>
                            <th className="py-1 px-1.5 text-right font-black text-slate-600">数</th>
                            <th className="py-1 px-1.5 text-right font-black text-slate-600">割合</th>
                            <th className="py-1 px-1.5 text-right font-black text-amber-600">CSW</th>
                            <th className="py-1 px-1.5 text-right font-black text-rose-600">空振</th>
                          </tr></thead>
                          <tbody>
                            {p.types.map((t, ti) => (
                              <tr key={ti} className="border-b border-slate-100">
                                <td className="py-1 px-1.5 font-bold"><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block shrink-0" style={{backgroundColor: pieColors[ti % pieColors.length]}}></span>{t.type}</span></td>
                                <td className="py-1 px-1.5 text-right font-bold">{t.total}</td>
                                <td className="py-1 px-1.5 text-right font-black text-blue-600">{Math.round((t.total/(pieTotal||1))*100)}%</td>
                                <td className="py-1 px-1.5 text-right font-bold text-amber-600">{t.csw}%</td>
                                <td className="py-1 px-1.5 text-right font-bold text-rose-600">{t.whiff}%</td>
                              </tr>
                            ))}
                            <tr className="bg-slate-50 font-black">
                              <td className="py-1 px-1.5">合計</td>
                              <td className="py-1 px-1.5 text-right">{pieTotal}</td>
                              <td className="py-1 px-1.5 text-right">—</td>
                              <td className="py-1 px-1.5 text-right text-amber-600">{p.csw}%</td>
                              <td className="py-1 px-1.5 text-right text-rose-600">{p.whiff}%</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {/* Right: course heatmaps per pitch type */}
                      <div className="flex-1">
                        <div className="flex flex-wrap gap-3 justify-center">
                          <div className="flex flex-col items-center">
                            <div className="text-[9px] font-black text-slate-500 mb-1">全球種</div>
                            {renderHeatmap(allCourseData, '#334155', 'lg')}
                          </div>
                          {p.types.filter(t => hmAll[t.type] && Object.keys(hmAll[t.type]).length > 0).map((t, ti) => (
                            <div key={ti} className="flex flex-col items-center">
                              <div className="text-[9px] font-black mb-1" style={{color: pieColors[ti % pieColors.length]}}>{t.type}</div>
                              {renderHeatmap(hmAll[t.type], pieColors[ti % pieColors.length], 'lg')}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* === SECTION: カウント別 === */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-black text-slate-700 mb-3">📈 カウント別 — 球種割合 & コース分布</div>
                    <div className="space-y-5">
                      {countLabels.map(cl => {
                        const cData = countDataAll[cl.key] || {};
                        const cTotal = Object.values(cData).reduce((s,v) => s + v, 0);
                        if (cTotal === 0) return null;
                        const cCourseAll = {};
                        Object.values(countCourseAll[cl.key] || {}).forEach(typeMap => { Object.entries(typeMap).forEach(([c, cnt]) => { cCourseAll[c] = (cCourseAll[c] || 0) + cnt; }); });
                        return (
                          <div key={cl.key} className="border-l-4 pl-3 rounded-r-lg" style={{borderColor: cl.color}}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[11px] font-black" style={{color: cl.color}}>{cl.label}</span>
                              <span className="text-[10px] text-slate-400 font-bold">({cTotal}球)</span>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3">
                              {/* Pitch type numbers */}
                              <div className="sm:w-36 shrink-0">
                                <table className="w-full text-[9px] border-collapse">
                                  <thead><tr className="border-b border-slate-200">
                                    <th className="py-0.5 px-1 text-left font-black text-slate-500">球種</th>
                                    <th className="py-0.5 px-1 text-right font-black text-slate-500">数</th>
                                    <th className="py-0.5 px-1 text-right font-black text-slate-500">割合</th>
                                  </tr></thead>
                                  <tbody>
                                    {allPitchTypes.map((type, ti) => {
                                      const cnt = cData[type] || 0;
                                      if (cnt === 0) return null;
                                      return (
                                        <tr key={ti} className="border-b border-slate-50">
                                          <td className="py-0.5 px-1 font-bold"><span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{backgroundColor: pieColors[ti % pieColors.length]}}></span>{type}</span></td>
                                          <td className="py-0.5 px-1 text-right">{cnt}</td>
                                          <td className="py-0.5 px-1 text-right font-black">{Math.round((cnt/cTotal)*100)}%</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {/* Course heatmaps */}
                              <div className="flex flex-wrap gap-2 justify-center flex-1">
                                <div className="flex flex-col items-center">
                                  <div className="text-[8px] font-black text-slate-400 mb-0.5">全球種</div>
                                  {renderHeatmap(cCourseAll, cl.color, 'sm')}
                                </div>
                                {allPitchTypes.map((type, ti) => {
                                  const typeHm = (countCourseAll[cl.key] || {})[type] || {};
                                  if (Object.keys(typeHm).length === 0) return null;
                                  return (
                                    <div key={ti} className="flex flex-col items-center">
                                      <div className="text-[8px] font-black mb-0.5" style={{color: pieColors[ti % pieColors.length]}}>{type.slice(0,4)}</div>
                                      {renderHeatmap(typeHm, pieColors[ti % pieColors.length], 'sm')}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
