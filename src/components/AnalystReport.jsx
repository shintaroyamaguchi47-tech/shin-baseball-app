import React from 'react';

    const PT_COLORS = { 'ストレート': '#ef4444', 'スライダー': '#3b82f6', 'シュート': '#10b981', 'カーブ': '#f59e0b', '落ちる球': '#6366f1', 'シンカー': '#06b6d4' };

    function AnalystReport({ insights }) {
      if (!insights || !insights.hasData) {
        return <div className="text-center text-slate-400 text-sm py-10">投球データがありません。試合を記録すると分析が表示されます。</div>;
      }
      const pf = (v) => v == null ? '–' : v + '%';

      const Stat = ({ label, value, hint }) => (
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 leading-tight">{label}</div>
          <div className="text-xl font-black text-slate-800 mt-0.5">{pf(value)}</div>
          {hint && <div className="text-[9px] text-slate-400 mt-1 leading-snug">{hint}</div>}
        </div>
      );

      const MixBar = ({ mix }) => {
        if (!mix || !mix.items.length) return <div className="text-[11px] text-slate-400">データなし</div>;
        return (
          <div>
            <div className="flex w-full h-5 rounded-md overflow-hidden border border-slate-200 bg-slate-100">
              {mix.items.map((it, i) => (<div key={i} style={{ width: (it.pct || 0) + '%', background: PT_COLORS[it.type] || '#94a3b8' }} title={`${it.type} ${it.pct}%`}></div>))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {mix.items.map((it, i) => (<span key={i} className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: PT_COLORS[it.type] || '#94a3b8' }}></span>{it.type} {it.pct}% <span className="text-slate-400 font-normal">({it.count})</span></span>))}
            </div>
          </div>
        );
      };

      const SegBar = ({ segs, total, note }) => {
        if (!total) return <div className="text-[11px] text-slate-400">データなし</div>;
        return (
          <div>
            <div className="flex w-full h-5 rounded-md overflow-hidden border border-slate-200 bg-slate-100">
              {segs.map((s, i) => { const p = total > 0 ? Math.round(s.v / total * 1000) / 10 : 0; return <div key={i} style={{ width: p + '%', background: s.c }} title={`${s.label} ${p}%`}></div>; })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {segs.map((s, i) => { const p = total > 0 ? Math.round(s.v / total * 1000) / 10 : 0; return <span key={i} className="text-[10px] font-bold text-slate-600 flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.c }}></span>{s.label} {p}% <span className="text-slate-400 font-normal">({s.v})</span></span>; })}
            </div>
            {note && <div className="text-[9px] text-slate-400 mt-1">{note}</div>}
          </div>
        );
      };

      const TeamBlock = ({ team }) => {
        const bb = team.batting.battedBall;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 space-y-6 report-section">
            <h3 className="text-lg font-black text-slate-800 border-b-2 border-slate-200 pb-2 report-heading">{team.name}</h3>

            {/* 打撃：選球眼 */}
            <div>
              <div className="text-sm font-black text-blue-700 mb-2 flex items-center gap-1.5">🏏 打撃アプローチ（選球眼）</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Stat label="Swing%" value={team.batting.pd.swingPct} hint="全投球を振った率" />
                <Stat label="Chase%（追いかけ）" value={team.batting.pd.chasePct} hint="ボール球を振った率。低いほど好選球眼" />
                <Stat label="Z-Swing%" value={team.batting.pd.zSwingPct} hint="ストライクを振った率（積極性）" />
                <Stat label="Contact%" value={team.batting.pd.contactPct} hint="スイング時に当てた率" />
                <Stat label="空振り率(SwStr%)" value={team.batting.pd.swStrPct} hint="全投球での空振り率" />
              </div>
            </div>

            {/* 打撃：打球プロファイル */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-black text-slate-600 mb-2">打球性質 <span className="text-slate-400 font-normal">(インプレー {bb.bip})</span></div>
                <SegBar total={bb.bip} segs={[{ label: 'ゴロ', v: bb.flight.gb, c: '#f59e0b' }, { label: 'ライナー/安', v: bb.flight.ld, c: '#3b82f6' }, { label: 'フライ', v: bb.flight.fb, c: '#10b981' }, { label: '本塁打', v: bb.flight.hr, c: '#ec4899' }]} />
              </div>
              <div>
                <div className="text-[11px] font-black text-slate-600 mb-2">打球方向 <span className="text-slate-400 font-normal">(方向判明 {bb.dir.known})</span></div>
                <SegBar total={bb.dir.known} segs={[{ label: '引っ張り', v: bb.dir.pull, c: '#ef4444' }, { label: 'センター', v: bb.dir.center, c: '#64748b' }, { label: '流し', v: bb.dir.oppo, c: '#22c55e' }]} note="打者の左右と守備位置から判定" />
              </div>
            </div>

            {/* 投手：制球・支配力 */}
            <div className="pt-1">
              <div className="text-sm font-black text-rose-700 mb-2 flex items-center gap-1.5">⚾ 投手陣（制球・支配力）<span className="text-[10px] font-normal text-slate-400">総投球 {team.pitching.pitches}</span></div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <Stat label="Zone%" value={team.pitching.pd.zonePct} hint="ゾーンへの投球率（制球）" />
                <Stat label="初球S%" value={team.pitching.pd.fpStrikePct} hint="初球ストライク率" />
                <Stat label="CSW%" value={team.pitching.pd.cswPct} hint="見逃し+空振り率（支配力）" />
                <Stat label="奪空振り率" value={team.pitching.pd.swStrPct} hint="全投球で空振りを奪った率" />
                <Stat label="誘い率" value={team.pitching.pd.chasePct} hint="ボール球を振らせた率" />
                <Stat label="被Contact%" value={team.pitching.pd.contactPct} hint="打者がスイング時に当てた率" />
              </div>
            </div>

            {/* 投手：球種構成 */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-black text-slate-600 mb-2">球種構成（全カウント）</div>
                <MixBar mix={team.pitching.mix} />
              </div>
              <div>
                <div className="text-[11px] font-black text-slate-600 mb-2">2ストライク時の球種（決め球）</div>
                <MixBar mix={team.pitching.twoStrike} />
              </div>
            </div>

            {/* 投手別 */}
            {team.pitching.pitchers.length > 0 && (
              <div>
                <div className="text-[11px] font-black text-slate-600 mb-2">投手別サマリー</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead><tr className="bg-slate-100 border-b-2 border-slate-300 text-slate-600">
                      <th className="py-1.5 px-2 text-left">投手</th><th className="py-1.5 px-2 text-right">球数</th><th className="py-1.5 px-2 text-right">Zone%</th><th className="py-1.5 px-2 text-right">初球S%</th><th className="py-1.5 px-2 text-right">CSW%</th><th className="py-1.5 px-2 text-right">空振り%</th><th className="py-1.5 px-2 text-right">誘い率</th><th className="py-1.5 px-2 text-left">決め球</th>
                    </tr></thead>
                    <tbody>
                      {team.pitching.pitchers.map((pt, i) => (
                        <tr key={i} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50' : ''}`}>
                          <td className="py-1.5 px-2 font-black text-slate-800">{pt.name}<span className="text-[9px] text-slate-400 font-normal ml-1">{pt.throws}投</span></td>
                          <td className="py-1.5 px-2 text-right">{pt.pd.pitches}</td>
                          <td className="py-1.5 px-2 text-right">{pf(pt.pd.zonePct)}</td>
                          <td className="py-1.5 px-2 text-right">{pf(pt.pd.fpStrikePct)}</td>
                          <td className="py-1.5 px-2 text-right font-bold text-rose-600">{pf(pt.pd.cswPct)}</td>
                          <td className="py-1.5 px-2 text-right">{pf(pt.pd.swStrPct)}</td>
                          <td className="py-1.5 px-2 text-right">{pf(pt.pd.chasePct)}</td>
                          <td className="py-1.5 px-2 text-left text-[10px] text-slate-500">{pt.twoStrike.items.length ? pt.twoStrike.items.slice(0, 2).map(it => `${it.type} ${it.pct}%`).join(' / ') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      };

      return (
        <div className="space-y-6">
          {/* 指標ガイド：アナリストが見る指標と、本アプリで算出できる範囲 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 report-section">
            <h3 className="text-base font-black text-slate-800 mb-1 report-heading">📈 アナリスト指標ガイド</h3>
            <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">MLB/NPBのアナリストは「選球眼・制球」「配球（球種構成）」「打球プロファイル」などを定量化します。本アプリが記録する<span className="font-bold">球種・コース・結果・カウント・投打の左右・打球方向</span>から、以下の指標を算出しています。</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                <div className="text-[11px] font-black text-emerald-700 mb-1.5">✅ 算出できる指標</div>
                <ul className="text-[10px] text-slate-600 space-y-0.5 leading-snug list-disc pl-4">
                  <li>選球眼: Swing% / Chase%(ボール球スイング) / Z-Swing% / Contact% / 空振り率(SwStr%)</li>
                  <li>制球・支配力: Zone% / 初球ストライク% / CSW% / 誘い率 / 被Contact%</li>
                  <li>配球: 球種構成比・カウント別傾向・2ストライク時の決め球</li>
                  <li>打球プロファイル: ゴロ/ライナー/フライ/HR・引っ張り/センター/流し</li>
                  <li>ヒートマップ・スプレーチャート（既存レポート参照）</li>
                </ul>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                <div className="text-[11px] font-black text-slate-500 mb-1.5">⚠️ 算出できない指標（要トラッキング機材）</div>
                <ul className="text-[10px] text-slate-500 space-y-0.5 leading-snug list-disc pl-4">
                  <li>球速・球速帯</li>
                  <li>回転数・回転軸・変化量</li>
                  <li>打球初速(Exit Velocity)・打球角度(Launch Angle)・Barrel%</li>
                  <li>Extension・リリースポイント</li>
                  <li>守備指標(OAA等)・走力(Sprint Speed)</li>
                </ul>
                <div className="text-[9px] text-slate-400 mt-1.5">これらはTrackMan/Statcast等の計測機が必要です。</div>
              </div>
            </div>
          </div>
          <TeamBlock team={insights.top} />
          <TeamBlock team={insights.bottom} />
        </div>
      );
    }

export default AnalystReport;
