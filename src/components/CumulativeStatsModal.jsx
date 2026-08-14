import React from 'react';

// 期間・チームで絞り込んだ累計成績(打者/投手)の一覧モーダル。
// 表示専用: 集計済みの cumulativeStats を描き、絞り込み条件は呼び出し側が持つ。
export default function CumulativeStatsModal({
  cumulativeStats,
  registeredTeams,
  pitches,
  cumulativeTeam,
  setCumulativeTeam,
  cumulativeDateFrom,
  setCumulativeDateFrom,
  cumulativeDateTo,
  setCumulativeDateTo,
  cumulativeTab,
  setCumulativeTab,
  expandedCumKey,
  setExpandedCumKey,
  onClose,
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/70 z-[200] flex items-center justify-center p-2 md:p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] border border-slate-200">
        <div className="p-4 border-b border-amber-200 bg-amber-50 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-lg font-black text-amber-800">📊 累計成績</h2>
            <div className="text-[11px] font-bold text-amber-700 mt-0.5">{cumulativeTeam} / {cumulativeStats.games.length}試合</div>
          </div>
          <button onClick={() => onClose()} className="text-amber-400 hover:text-amber-800 font-bold text-xl px-2">✕</button>
        </div>
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0 flex flex-col gap-2">
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[10px] font-bold text-slate-500">チーム</label>
            <select value={cumulativeTeam} onChange={e => setCumulativeTeam(e.target.value)} className="text-xs font-bold border border-slate-300 rounded px-2 py-1 bg-white">
              {registeredTeams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <label className="text-[10px] font-bold text-slate-500 ml-2">期間</label>
            <input type="date" value={cumulativeDateFrom} onChange={e => setCumulativeDateFrom(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white" />
            <span className="text-xs text-slate-400">〜</span>
            <input type="date" value={cumulativeDateTo} onChange={e => setCumulativeDateTo(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => { setCumulativeDateFrom(''); setCumulativeDateTo(''); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">全期間</button>
            <button onClick={() => { const n = new Date(); const fm = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`; const last = new Date(n.getFullYear(), n.getMonth()+1, 0); const tm = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`; setCumulativeDateFrom(fm); setCumulativeDateTo(tm); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">今月</button>
            <button onClick={() => { const y = new Date().getFullYear(); setCumulativeDateFrom(`${y}-01-01`); setCumulativeDateTo(`${y}-12-31`); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">今年</button>
            <button onClick={() => { const y = new Date().getFullYear() - 1; setCumulativeDateFrom(`${y}-01-01`); setCumulativeDateTo(`${y}-12-31`); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">昨年</button>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setCumulativeTab('batter')} className={`flex-1 py-2 rounded-lg font-black text-xs ${cumulativeTab==='batter' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-300'}`}>🏏 打者</button>
            <button onClick={() => setCumulativeTab('pitcher')} className={`flex-1 py-2 rounded-lg font-black text-xs ${cumulativeTab==='pitcher' ? 'bg-rose-600 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-300'}`}>⚾ 投手</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto modal-scroll p-3">
          {cumulativeStats.games.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12 font-bold">この期間に保存試合がありません</p>
          ) : cumulativeTab === 'batter' ? (
            cumulativeStats.batters.length === 0 ? <p className="text-center text-slate-400 text-sm py-12 font-bold">打者データなし</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 text-[10px]">
                    <tr>
                      <th className="py-2 px-2 text-left">選手名</th>
                      <th className="py-2 px-1 text-right">G</th>
                      <th className="py-2 px-1 text-right">PA</th>
                      <th className="py-2 px-1 text-right">AB</th>
                      <th className="py-2 px-1 text-right">H</th>
                      <th className="py-2 px-1 text-right">2B</th>
                      <th className="py-2 px-1 text-right">3B</th>
                      <th className="py-2 px-1 text-right">HR</th>
                      <th className="py-2 px-1 text-right">四死</th>
                      <th className="py-2 px-1 text-right">K</th>
                      <th className="py-2 px-1 text-right text-blue-600">打率</th>
                      <th className="py-2 px-1 text-right text-emerald-600">出塁</th>
                      <th className="py-2 px-1 text-right text-purple-600">長打</th>
                      <th className="py-2 px-1 text-right text-amber-600">OPS</th>
                      <th className="py-2 px-1 text-right text-rose-600">K%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cumulativeStats.batters.map((b, i) => (
                      <React.Fragment key={b.name}>
                        <tr onClick={() => setExpandedCumKey(expandedCumKey === `b-${b.name}` ? null : `b-${b.name}`)} className={`cursor-pointer border-b border-slate-200 ${i%2===0?'bg-white':'bg-slate-50'} hover:bg-amber-50`}>
                          <td className="py-2 px-2 font-black">{expandedCumKey===`b-${b.name}`?'▼':'▶'} {b.name}</td>
                          <td className="py-2 px-1 text-right">{b.G}</td>
                          <td className="py-2 px-1 text-right">{b.PA}</td>
                          <td className="py-2 px-1 text-right">{b.AB}</td>
                          <td className="py-2 px-1 text-right">{b.H}</td>
                          <td className="py-2 px-1 text-right">{b._2B}</td>
                          <td className="py-2 px-1 text-right">{b._3B}</td>
                          <td className="py-2 px-1 text-right">{b.HR}</td>
                          <td className="py-2 px-1 text-right">{b.BB_HBP}</td>
                          <td className="py-2 px-1 text-right">{b.K}</td>
                          <td className="py-2 px-1 text-right font-black text-blue-600">{b.AVG}</td>
                          <td className="py-2 px-1 text-right font-black text-emerald-600">{b.OBP}</td>
                          <td className="py-2 px-1 text-right font-black text-purple-600">{b.SLG}</td>
                          <td className="py-2 px-1 text-right font-black text-amber-600">{b.OPS}</td>
                          <td className="py-2 px-1 text-right text-rose-600">{b.KPct}%</td>
                        </tr>
                        {expandedCumKey===`b-${b.name}` && (
                          <tr><td colSpan={15} className="bg-amber-50/60 p-2">
                            <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">試合別ログ</div>
                            <table className="w-full text-[11px] border-collapse">
                              <thead className="bg-white text-slate-500 text-[10px]">
                                <tr><th className="py-1 px-2 text-left">日付</th><th className="py-1 px-2 text-left">対戦</th><th className="py-1 px-1 text-right">PA</th><th className="py-1 px-1 text-right">AB</th><th className="py-1 px-1 text-right">H</th><th className="py-1 px-1 text-right">四死</th><th className="py-1 px-1 text-right">K</th><th className="py-1 px-1 text-left">結果</th></tr>
                              </thead>
                              <tbody>
                                {b.gameLog.map((gl, gi) => (
                                  <tr key={gi} className="border-b border-amber-100"><td className="py-1 px-2">{gl.date}</td><td className="py-1 px-2">{gl.opponent}</td><td className="py-1 px-1 text-right">{gl.PA}</td><td className="py-1 px-1 text-right">{gl.AB}</td><td className="py-1 px-1 text-right">{gl.H}</td><td className="py-1 px-1 text-right">{gl.BB_HBP}</td><td className="py-1 px-1 text-right">{gl.K}</td><td className="py-1 px-2 text-[10px]">{gl.results.join(', ')}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            cumulativeStats.pitchers.length === 0 ? <p className="text-center text-slate-400 text-sm py-12 font-bold">投手データなし</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-600 text-[10px]">
                    <tr>
                      <th className="py-2 px-2 text-left">投手</th>
                      <th className="py-2 px-1 text-right">G</th>
                      <th className="py-2 px-1 text-right">球数</th>
                      <th className="py-2 px-1 text-right">対戦</th>
                      <th className="py-2 px-1 text-right">H</th>
                      <th className="py-2 px-1 text-right">K</th>
                      <th className="py-2 px-1 text-right">BB</th>
                      <th className="py-2 px-1 text-right text-blue-600">被打率</th>
                      <th className="py-2 px-1 text-right text-rose-600">K%</th>
                      <th className="py-2 px-1 text-right text-amber-600">BB%</th>
                      <th className="py-2 px-1 text-right text-indigo-600">CSW%</th>
                      <th className="py-2 px-1 text-right text-emerald-600">Whiff%</th>
                      <th className="py-2 px-1 text-right">S%</th>
                      <th className="py-2 px-1 text-right">初球S%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cumulativeStats.pitchers.map((p, i) => (
                      <React.Fragment key={p.name}>
                        <tr onClick={() => setExpandedCumKey(expandedCumKey === `p-${p.name}` ? null : `p-${p.name}`)} className={`cursor-pointer border-b border-slate-200 ${i%2===0?'bg-white':'bg-slate-50'} hover:bg-amber-50`}>
                          <td className="py-2 px-2 font-black">{expandedCumKey===`p-${p.name}`?'▼':'▶'} {p.name} <span className="text-[9px] text-slate-400">({p.throws}投)</span></td>
                          <td className="py-2 px-1 text-right">{p.G}</td>
                          <td className="py-2 px-1 text-right">{p.pitches}</td>
                          <td className="py-2 px-1 text-right">{p.PA}</td>
                          <td className="py-2 px-1 text-right">{p.H}</td>
                          <td className="py-2 px-1 text-right">{p.K}</td>
                          <td className="py-2 px-1 text-right">{p.BB}</td>
                          <td className="py-2 px-1 text-right font-black text-blue-600">{p.AVG}</td>
                          <td className="py-2 px-1 text-right font-black text-rose-600">{p.KPct}%</td>
                          <td className="py-2 px-1 text-right font-black text-amber-600">{p.BBPct}%</td>
                          <td className="py-2 px-1 text-right font-black text-indigo-600">{p.csw}%</td>
                          <td className="py-2 px-1 text-right font-black text-emerald-600">{p.whiffPct}%</td>
                          <td className="py-2 px-1 text-right">{p.strikePct}%</td>
                          <td className="py-2 px-1 text-right">{p.fStrikePct}%</td>
                        </tr>
                        {expandedCumKey===`p-${p.name}` && (
                          <tr><td colSpan={14} className="bg-amber-50/60 p-2">
                            {p.types.length > 0 && (
                              <div className="mb-3">
                                <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">球種別</div>
                                <div className="flex flex-wrap gap-2">
                                  {p.types.map(t => (
                                    <div key={t.type} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px]">
                                      <span className="font-black text-slate-700">{t.type}</span>
                                      <span className="text-slate-400 mx-1">·</span>
                                      <span>{t.total}球</span>
                                      <span className="text-slate-400 mx-1">·</span>
                                      <span className="text-indigo-600 font-bold">S {t.strikePct}%</span>
                                      <span className="text-slate-400 mx-1">·</span>
                                      <span className="text-emerald-600 font-bold">Whiff {t.whiffPct}%</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">試合別ログ</div>
                            <table className="w-full text-[11px] border-collapse">
                              <thead className="bg-white text-slate-500 text-[10px]">
                                <tr><th className="py-1 px-2 text-left">日付</th><th className="py-1 px-2 text-left">対戦</th><th className="py-1 px-1 text-right">球数</th><th className="py-1 px-1 text-right">対戦</th><th className="py-1 px-1 text-right">H</th><th className="py-1 px-1 text-right">K</th><th className="py-1 px-1 text-right">BB</th><th className="py-1 px-1 text-right">S%</th></tr>
                              </thead>
                              <tbody>
                                {p.gameLog.map((gl, gi) => (
                                  <tr key={gi} className="border-b border-amber-100"><td className="py-1 px-2">{gl.date}</td><td className="py-1 px-2">{gl.opponent}</td><td className="py-1 px-1 text-right">{gl.pitches}</td><td className="py-1 px-1 text-right">{gl.PA}</td><td className="py-1 px-1 text-right">{gl.H}</td><td className="py-1 px-1 text-right">{gl.K}</td><td className="py-1 px-1 text-right">{gl.BB}</td><td className="py-1 px-1 text-right">{gl.pitches>0?Math.round(gl.strikes/gl.pitches*100):0}%</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
        <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <button onClick={() => onClose()} className="w-full bg-slate-700 text-white py-2.5 rounded-xl font-bold text-sm">閉じる</button>
        </div>
      </div>
    </div>
  );
}
