import React, { useMemo, useState } from 'react';
import { buildPitcherReport, buildGamePlan, listTeamPitchers, quickTimeStats } from '../pitcherScouting.js';

// 相手投手の分析レポート。次戦の打席・走塁で使う傾向と、試合で測ったクイックや変化球の印象をメモできる。
const BREAK_TYPES = ['スライダー', 'カーブ', 'フォーク・スプリット', 'チェンジアップ', 'シュート', 'シンカー', 'カット', 'その他'];
const BREAK_SIZES = ['小', '中', '大'];
const toneStyle = {
  attack: 'border-l-emerald-500 bg-emerald-50 text-emerald-900',
  wait: 'border-l-blue-500 bg-blue-50 text-blue-900',
  caution: 'border-l-rose-500 bg-rose-50 text-rose-900',
  info: 'border-l-slate-400 bg-slate-50 text-slate-800',
};
const toneLabel = { attack: '狙う', wait: '待つ', caution: '注意', info: '参考' };

const Stat = ({ label, value, hint }) => <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold text-slate-500">{label}</div><div className="text-xl font-black text-slate-800 mt-1">{value}</div>{hint && <div className="text-[9px] text-slate-400 mt-1">{hint}</div>}</div>;
const ShareBar = ({ shares }) => (
  <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
    {shares.map((s, i) => <i key={s.type} title={`${s.type} ${s.pct}%`} className={['bg-rose-500', 'bg-blue-500', 'bg-amber-400', 'bg-emerald-500', 'bg-indigo-500', 'bg-cyan-500', 'bg-slate-400'][i % 7]} style={{ width: `${s.pct}%` }} />)}
  </div>
);
const shareText = (shares, limit = 3) => shares.slice(0, limit).map(s => `${s.type} ${s.pct}%`).join('・') || '—';

export default function PitcherScoutReport({ db, games, team, teams, onSelectTeam, notes, onNotesChange }) {
  const pitchers = useMemo(() => team ? listTeamPitchers(db, games, team.id) : [], [db, games, team]);
  const [pickedName, setPickedName] = useState('');
  const pitcher = pitchers.find(p => p.name === pickedName) || pitchers[0] || null;
  const report = useMemo(() => pitcher ? buildPitcherReport(db, games, team.id, pitcher.name) : null, [db, games, team, pitcher]);
  const [quickInput, setQuickInput] = useState('');

  const noteKey = pitcher?.id;
  const memo = { quickTimes: [], maxSpeed: '', avgSpeed: '', breaking: {}, setHabit: '', tells: '', plan: '', ...((noteKey && notes[noteKey]?.scout) || {}) };
  const saveMemo = (patch) => {
    if (!noteKey) return;
    const prev = notes[noteKey];
    const base = typeof prev === 'string' ? { general: prev } : (prev || {});
    onNotesChange({ ...notes, [noteKey]: { ...base, scout: { ...memo, ...patch, updatedAt: new Date().toISOString() } } });
  };
  const addQuick = () => {
    const v = Number(String(quickInput).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(v) || v <= 0 || v > 5) return;
    saveMemo({ quickTimes: [...memo.quickTimes, Number(v.toFixed(2))] });
    setQuickInput('');
  };
  const setBreak = (type, patch) => saveMemo({ breaking: { ...memo.breaking, [type]: { size: '', speed: '', note: '', ...(memo.breaking[type] || {}), ...patch } } });
  const quick = quickTimeStats(memo.quickTimes);
  const plan = report ? buildGamePlan(report, memo) : [];
  const opponentTeams = teams.filter(t => t.role !== 'own');

  return (
    <div className="space-y-4">
      <section className="panel space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg">相手投手レポート</h3>
          <span className="text-[10px] font-bold text-slate-400">{team ? `${team.name}｜${games.length}試合の記録から集計` : ''}</span>
        </div>
        {opponentTeams.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] font-bold text-slate-400">チーム:</span>
            {opponentTeams.map(t => <button key={t.id} onClick={() => { onSelectTeam(t.id); setPickedName(''); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${team?.id === t.id ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}>{t.name}</button>)}
          </div>
        )}
        {pitchers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] font-bold text-slate-400">投手:</span>
            {pitchers.map(p => <button key={p.name} onClick={() => setPickedName(p.name)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${pitcher?.name === p.name ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300'}`}>{p.name}<span className="ml-1 opacity-60 font-normal">{p.throws}{p.throws ? '投・' : ''}{p.pitches}球</span></button>)}
          </div>
        ) : <p className="empty">{team ? 'このチームの投球記録がありません。上でチームを選んでください' : 'チームを選んでください'}</p>}
      </section>

      {pitcher && report && <>
        <section className="panel border-l-4 border-l-rose-500">
          <h3>次戦の攻略ポイント｜{pitcher.name}</h3>
          {plan.length ? (
            <ul className="mt-3 space-y-2">
              {plan.map((t, i) => <li key={i} className={`border-l-4 rounded-r-lg px-3 py-2 text-xs font-bold flex gap-2 ${toneStyle[t.tone]}`}><span className="shrink-0 text-[10px] font-black opacity-70 w-7">{toneLabel[t.tone]}</span><span>{t.text}</span></li>)}
            </ul>
          ) : <p className="text-xs text-slate-400 mt-2">記録が増えると、ここに攻略ポイントが自動で並びます</p>}
        </section>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="対戦打者 / 投球数" value={`${report.summary.batters} / ${report.summary.pitches}`} hint={`${report.summary.games}試合・打者1人${report.summary.pitchesPerBatter}球`} />
          <Stat label="ストライク率" value={`${report.summary.strikePct}%`} hint={`初球 ${report.summary.firstStrikePct}%`} />
          <Stat label="空振り率" value={`${report.summary.whiffPct}%`} hint="空振り ÷ スイング" />
          <Stat label="三振率 / 四死球率" value={`${report.summary.KPct}% / ${report.summary.BBPct}%`} />
          <Stat label="被打率" value={report.summary.AVG} />
        </div>

        <section className="panel">
          <h3>カウント別の狙い球</h3>
          <p className="text-[10px] text-slate-400 mt-1">そのカウントで最も多く投げた球種。太字が狙い球の候補、下段はストライク率</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-1 table-fixed">
              <thead><tr><th className="text-[10px] text-slate-400 w-7 md:w-14"></th>{[0, 1, 2].map(s => <th key={s} className="text-[10px] font-black text-amber-600 whitespace-nowrap">{s}<span className="hidden md:inline">ストライク</span><span className="md:hidden">S</span></th>)}</tr></thead>
              <tbody>
                {[0, 1, 2, 3].map(b => (
                  <tr key={b}>
                    <th className="text-[10px] font-black text-emerald-600 text-left whitespace-nowrap">{b}<span className="hidden md:inline">ボール</span><span className="md:hidden">B</span></th>
                    {[0, 1, 2].map(s => {
                      const c = report.byCount.find(x => x.count === `${b}-${s}`);
                      const strong = c.top && c.top.pct >= 60;
                      return (
                        <td key={s} className={`align-top rounded-xl border p-1.5 md:p-2 ${!c.n ? 'bg-slate-50 border-slate-100 text-slate-300' : strong ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                          <div className="flex justify-between text-[10px] font-bold text-slate-400"><span>{c.count}</span><span>{c.n}球</span></div>
                          {c.n ? <>
                            <div className={`mt-1 ${strong ? 'font-black text-amber-800' : 'font-bold text-slate-700'}`}>{c.top.type} {c.top.pct}%</div>
                            <div className="text-[10px] text-slate-500 truncate">{shareText(c.shares.slice(1), 2)}</div>
                            <div className="mt-1"><ShareBar shares={c.shares} /></div>
                            <div className="text-[10px] text-slate-500 mt-1">ストライク {c.strikePct}%</div>
                          </> : <div className="mt-1">—</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {[['初球', report.situations.first], ['ボール先行', report.situations.hitterAhead], ['追い込んでから', report.situations.twoStrikes], ['フルカウント', report.situations.full]].map(([label, g]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-2.5">
                <div className="flex justify-between text-[10px] font-bold text-slate-500"><span>{label}</span><span>{g.n}球</span></div>
                <div className="text-xs font-black text-slate-800 mt-1">{shareText(g.shares, 2)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">直球系 {g.fastballPct}%・ストライク {g.strikePct}%</div>
              </div>
            ))}
          </div>
          {report.kPitches.length > 0 && <p className="text-xs mt-3"><b className="text-rose-600">決め球(三振を奪った球種):</b> {report.kPitches.map(k => `${k.type} ${k.n}個`).join('・')}</p>}
        </section>

        <section className="panel">
          <h3>球種別</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead><tr className="text-[10px] text-slate-400 text-left border-b"><th className="py-1.5">球種</th><th>割合</th><th>対右</th><th>対左</th><th>ストライク率</th><th>空振り率</th><th>被安打</th><th>奪三振</th></tr></thead>
              <tbody>{report.byType.map(t => <tr key={t.type} className="border-b border-slate-100"><td className="py-2 font-black">{t.type}</td><td>{t.share}% <span className="text-slate-400">({t.n})</span></td><td>{t.vsRight}%</td><td>{t.vsLeft}%</td><td>{t.strikePct}%</td><td>{t.whiffPct}%</td><td>{t.hits}</td><td>{t.strikeouts}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h3>コースの傾向(捕手目線)</h3>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            {report.course.map(c => (
              <div key={c.side} className="flex gap-3 items-start">
                <div>
                  <div className="text-[10px] font-black text-slate-500 mb-1">対{c.side}打者 {c.n}球</div>
                  <div className="flex justify-between text-[9px] font-bold text-slate-400 w-[140px]"><span>{c.side === '右' ? '内角' : '外角'}</span><span>{c.side === '右' ? '外角' : '内角'}</span></div>
                  <div className="relative grid grid-cols-7 gap-px bg-slate-200 p-1 rounded-lg w-[140px] h-[140px]">
                    <div className="absolute top-[28.6%] left-[28.6%] w-[42.8%] h-[42.8%] border-2 border-slate-700 rounded pointer-events-none"></div>
                    {c.grid.map((n, i) => <div key={i} title={`${n}球`} className="rounded-sm" style={{ backgroundColor: n ? `rgba(225,29,72,${0.15 + 0.85 * n / c.max})` : '#fff' }}></div>)}
                  </div>
                </div>
                <div className="text-[11px] space-y-1 pt-5">
                  {c.n ? <>
                    {Object.entries(c.height).map(([k, v]) => <div key={k} className="flex gap-2"><span className="w-10 text-slate-500">{k}</span><b>{Math.round(v / c.n * 100)}%</b></div>)}
                    <div className="h-1"></div>
                    {Object.entries(c.width).map(([k, v]) => <div key={k} className="flex gap-2"><span className="w-10 text-slate-500">{k}</span><b>{Math.round(v / c.n * 100)}%</b></div>)}
                  </> : <span className="text-slate-400">記録なし</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-3">
          <section className="panel">
            <h3>牽制・走者への対応</h3>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Stat label="牽制" value={`${report.running.pickoffs}回`} hint={`走者ありの打者1人あたり${report.running.pickoffsPerRunnerPa}回`} />
              <Stat label="牽制死" value={report.running.pickoffOuts} />
              <Stat label="盗塁 許/刺" value={`${report.running.stealsAllowed} / ${report.running.caughtStealing}`} />
            </div>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              {Object.keys(report.running.pickoffBases).length ? Object.entries(report.running.pickoffBases).map(([base, n]) => <span key={base} className="bg-orange-50 border border-orange-200 text-orange-800 rounded-lg px-3 py-1.5 font-bold">{base}へ {n}回</span>) : <span className="text-slate-400">牽制の記録なし</span>}
              {report.running.balks > 0 && <span className="bg-slate-100 rounded-lg px-3 py-1.5 font-bold">ボーク {report.running.balks}</span>}
              {report.running.wildPitches > 0 && <span className="bg-slate-100 rounded-lg px-3 py-1.5 font-bold">暴投 {report.running.wildPitches}</span>}
            </div>
          </section>
          <section className="panel">
            <h3>球数による変化</h3>
            {report.stamina.length ? (
              <table className="w-full text-xs mt-2">
                <thead><tr className="text-[10px] text-slate-400 text-left border-b"><th className="py-1.5">試合内の球数</th><th>球</th><th>ストライク率</th><th>直球系</th><th>被安打</th><th>四死球</th></tr></thead>
                <tbody>{report.stamina.map(b => <tr key={b.label} className="border-b border-slate-100"><td className="py-2 font-bold">{b.label}</td><td>{b.n}</td><td>{b.strikePct}%</td><td>{b.fastballPct}%</td><td>{b.hits}</td><td>{b.walks}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-xs text-slate-400 mt-2">記録なし</p>}
          </section>
        </div>

        <section className="panel border-l-4 border-l-blue-500 space-y-4">
          <div className="flex items-center justify-between gap-2"><h3>計測・観察メモ｜{pitcher.name}</h3>{memo.updatedAt && <span className="text-[10px] text-slate-400">更新 {new Date(memo.updatedAt).toLocaleDateString('ja-JP')}</span>}</div>

          <div>
            <p className="text-xs font-black text-slate-700">⏱ クイックのタイム(秒)</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <input aria-label="クイックのタイム" inputMode="decimal" value={quickInput} onChange={e => setQuickInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addQuick(); }} placeholder="例 1.25" className="filter-input w-28" />
              <button onClick={addQuick} className="bg-blue-600 text-white px-4 rounded-lg text-xs font-black whitespace-nowrap">追加</button>
              {quick && <span className="text-xs font-bold text-slate-600 self-center">平均 <b className="text-blue-700 text-sm">{quick.avg.toFixed(2)}</b>秒(最速{quick.min.toFixed(2)}・最遅{quick.max.toFixed(2)}・{quick.n}回)</span>}
            </div>
            {memo.quickTimes.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{memo.quickTimes.map((t, i) => <button key={i} onClick={() => saveMemo({ quickTimes: memo.quickTimes.filter((_, j) => j !== i) })} title="タップで削除" className="bg-slate-100 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-mono font-bold">{Number(t).toFixed(2)} ✕</button>)}</div>}
          </div>

          <div className="grid grid-cols-2 gap-2 max-w-sm">
            <label className="text-[10px] font-bold text-slate-500">最速(km/h)<input inputMode="numeric" value={memo.maxSpeed} onChange={e => saveMemo({ maxSpeed: e.target.value })} className="filter-input w-full mt-1" /></label>
            <label className="text-[10px] font-bold text-slate-500">直球の平均(km/h)<input inputMode="numeric" value={memo.avgSpeed} onChange={e => saveMemo({ avgSpeed: e.target.value })} className="filter-input w-full mt-1" /></label>
          </div>

          <div>
            <p className="text-xs font-black text-slate-700">↪ 変化球の曲がり幅</p>
            <div className="mt-2 space-y-2">
              {BREAK_TYPES.map(type => {
                const b = memo.breaking[type] || {};
                return (
                  <div key={type} className="grid grid-cols-[92px_auto_1fr] md:grid-cols-[110px_auto_90px_1fr] gap-2 items-center">
                    <span className="text-xs font-bold text-slate-700">{type}</span>
                    <div className="flex gap-1">{BREAK_SIZES.map(size => <button key={size} onClick={() => setBreak(type, { size: b.size === size ? '' : size })} aria-pressed={b.size === size} className={`w-8 py-1.5 rounded-md text-[11px] font-black border ${b.size === size ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-300'}`}>{size}</button>)}</div>
                    <input aria-label={`${type}の球速`} inputMode="numeric" value={b.speed || ''} onChange={e => setBreak(type, { speed: e.target.value })} placeholder="km/h" className="filter-input min-w-0" />
                    <input aria-label={`${type}のメモ`} value={b.note || ''} onChange={e => setBreak(type, { note: e.target.value })} placeholder="横に大きい・縦に落ちる など" className="filter-input col-span-3 md:col-span-1" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div><p className="text-xs font-black text-slate-700">セット・牽制の癖</p><textarea value={memo.setHabit} onChange={e => saveMemo({ setHabit: e.target.value })} placeholder="首を2回振ったら投球、長く持つと牽制 など" className="memo-area min-h-20" /></div>
            <div><p className="text-xs font-black text-slate-700">球種がわかる癖・フォーム</p><textarea value={memo.tells} onChange={e => saveMemo({ tells: e.target.value })} placeholder="変化球はグラブが開く、腕の振りが緩む など" className="memo-area min-h-20" /></div>
          </div>
          <div><p className="text-xs font-black text-slate-700">攻略メモ</p><textarea value={memo.plan} onChange={e => saveMemo({ plan: e.target.value })} placeholder="打席での狙い、ベンチからの指示 など" className="memo-area min-h-24" /></div>
        </section>
      </>}
    </div>
  );
}
