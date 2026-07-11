import React, { useEffect, useState } from 'react';

const HX = 120, HY = 185, MOUND_Y = 145;

function FieldDiagram({ play }) {
  const svgSz = 96;
  return (
    <svg width={svgSz} height={svgSz * (200 / 240)} viewBox="0 0 240 200" style={{ display: 'block' }}>
      <path d="M 120 185 L 0 65 L 0 0 L 240 0 L 240 65 Z" fill="#f8fafc" />
      <path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7" />
      <path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.7" />
      <path d="M 8 70 Q 120 -25 232 70" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
      <line x1="120" y1="185" x2="8" y2="70" stroke="#fbbf24" strokeWidth="1.2" />
      <line x1="120" y1="185" x2="232" y2="70" stroke="#fbbf24" strokeWidth="1.2" />
      <polygon points="120,185 80,145 120,110 160,145" fill="none" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
      <circle cx={HX} cy={HY} r="3" fill="#334155" />
      {play.hasHitLocation ? (
        <>
          {play.flight === 'hr' ? (
            <path d={`M ${HX} ${HY} Q ${(HX + play.hitX) / 2} ${(HY + play.hitY) / 2 - 22} ${play.hitX} ${play.hitY}`} fill="none" stroke="#dc2626" strokeWidth="1.8" strokeDasharray="4,2.5" opacity="0.9" />
          ) : (
            <line x1={HX} y1={HY} x2={play.hitX} y2={play.hitY} stroke="#dc2626" strokeWidth="1.8" strokeDasharray="4,2.5" opacity="0.9" />
          )}
          <circle cx={play.hitX} cy={play.hitY} r="6" fill="#92400e" stroke="#fff" strokeWidth="1.5" />
        </>
      ) : (
        <line x1={HX} y1={MOUND_Y} x2={HX} y2={HY} stroke="#1e293b" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.85" />
      )}
    </svg>
  );
}

function CountDots({ label, filled, total, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-black text-slate-500 w-3">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: i < filled ? color : '#e2e8f0' }} />
        ))}
      </div>
    </div>
  );
}

function PlayCard({ play }) {
  const resultColor = play.isHit ? '#1d4ed8' : play.isBB ? '#0d9488' : play.isError ? '#d97706' : play.isOut ? '#e11d48' : '#475569';
  return (
    <div id={`pbp-${play.key}`} className="bg-white rounded-xl border border-slate-200 overflow-hidden scroll-mt-20">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70 text-[11px] leading-relaxed text-slate-700">
        {play.narrative.map((line, i) => (
          <span key={i} className={i === 0 ? 'font-bold text-slate-800' : ''}>{line}{i < play.narrative.length - 1 ? ' ' : ''}</span>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row">
        <div className="flex-1 min-w-0">
          <table className="w-full text-[11px] border-collapse">
            <tbody>
              {play.pitchRows.map((row, i) => row.isEvent ? (
                <tr key={i} className="border-b border-slate-100 bg-blue-50/40">
                  <td colSpan={2} className="py-1.5 px-3 text-blue-800 font-bold">{row.label}</td>
                  <td className="py-1.5 px-3"></td>
                </tr>
              ) : (
                <tr key={i} className={`border-b border-slate-100 ${row.count === null ? 'bg-blue-50' : ''}`}>
                  <td className="py-1.5 pl-3 pr-1 w-6">
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black ${row.count === null ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{row.seq}</span>
                  </td>
                  <td className={`py-1.5 px-2 font-bold ${row.count === null ? '' : 'text-slate-600'}`} style={row.count === null ? { color: resultColor } : undefined}>{row.label}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-400 font-mono">{row.count || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 flex sm:flex-col items-center justify-center gap-2 p-3 border-t sm:border-t-0 sm:border-l border-slate-100 bg-slate-50/40">
          <FieldDiagram play={play} />
          <div className="flex flex-col gap-1">
            <CountDots label="B" filled={play.count.balls} total={4} color="#22c55e" />
            <CountDots label="S" filled={play.count.strikes} total={3} color="#eab308" />
            <CountDots label="O" filled={play.count.outs} total={3} color="#ef4444" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InningBlock({ inning, teamName, defaultOpen, forceOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 text-white text-xs font-bold">
        <span>{inning.inning}回{inning.isTop ? '表' : '裏'} {teamName}の攻撃 <span className="text-slate-400 font-normal ml-1">({inning.plays.length}打席)</span></span>
        <span className="text-slate-400">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      {open && (
        <div className="p-2 space-y-2 bg-slate-100/60">
          {inning.plays.map((play, i) => <PlayCard key={play.key || i} play={play} />)}
        </div>
      )}
    </div>
  );
}

function PlayByPlayReport({ report, gameInfo, defaultOpenLast, scrollTarget, onScrolled }) {
  useEffect(() => {
    if (!scrollTarget) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[id^="pbp-${scrollTarget}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      if (onScrolled) onScrolled();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, report, onScrolled]);

  if (!report || report.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-10">投球データがありません。試合を記録すると打席速報が表示されます。</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1 items-center px-1">
        <span>🟤 打球処理位置</span><span>- - -打球軌跡(推定)</span><span>┊投球(打球データなし)</span>
        <span className="text-slate-300">|</span>
        <span>●=到達したB/S/Oのカウント</span>
      </div>
      {report.map((inning, i) => {
        const inningKey = `${inning.inning}-${inning.isTop}-`;
        return (
          <InningBlock
            key={i}
            inning={inning}
            teamName={inning.isTop ? gameInfo.teamTop : gameInfo.teamBottom}
            defaultOpen={defaultOpenLast && i === report.length - 1}
            forceOpen={!!scrollTarget && scrollTarget.startsWith(inningKey)}
          />
        );
      })}
    </div>
  );
}

export default PlayByPlayReport;
