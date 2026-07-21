import React from 'react';

    function SprayChart({ hits, title, size = 200, compact = false, emptyLabel = 'No Data' }) {
      const HX = 120, HY = 185;
      const scale = size / 240;
      const h = size, w = size;
      const svgH = Math.round(200 * scale);
      return (
        <div style={{display:'inline-block', textAlign:'center', margin: compact ? 0 : '8px'}}>
          {title ? <><div style={{fontSize:'11px', fontWeight:'bold', color:'#475569', marginBottom:'4px', background:'#f1f5f9', padding:'2px 8px', borderRadius:'12px', display:'inline-block'}}>{title}</div><br/></> : null}
          <svg width={w} height={svgH} viewBox="0 0 240 200" style={{background:'#ffffff', border:'1px solid #cbd5e1', borderRadius:'8px', boxShadow:'0 1px 3px rgba(0,0,0,0.1)'}}>
            <path d="M 120 185 L 0 65 L 0 0 L 240 0 L 240 65 Z" fill="#f8fafc"/>
            <path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7"/>
            <path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.6"/>
            <path d="M 8 70 Q 120 -25 232 70" fill="none" stroke="#94a3b8" strokeWidth="2"/>
            <line x1="120" y1="185" x2="8" y2="70" stroke="#fbbf24" strokeWidth="1.5"/>
            <line x1="120" y1="185" x2="232" y2="70" stroke="#fbbf24" strokeWidth="1.5"/>
            <polygon points="120,185 80,145 120,110 160,145" fill="none" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,2"/>
            {(!hits || hits.length === 0) && (
              <text x="120" y="100" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold">{emptyLabel}</text>
            )}
            {(hits || []).map((pt, idx) => {
              const tx = pt.x + (pt.isManual ? 0 : (Math.random() - 0.5) * 4);
              const ty = pt.y + (pt.isManual ? 0 : (Math.random() - 0.5) * 4);
              const c = pt.type === 'hit' ? '#2563eb' : pt.type === 'error' ? '#d97706' : pt.type === 'foul' ? '#9333ea' : '#dc2626';
              const fl = pt.flight || 'fly';
              if (fl === 'grounder') {
                const dx = tx - HX, dy = ty - HY, dist = Math.sqrt(dx*dx + dy*dy);
                const nx = -dy/dist, ny = dx/dist;
                const steps = Math.max(4, Math.round(dist/12));
                let dd = `M ${HX} ${HY}`;
                for (let i = 1; i <= steps; i++) {
                  const t = i/steps, amp = (i%2===0 ? 2 : -2) * (1 - t*0.5);
                  dd += ` L ${HX + dx*t + nx*amp} ${HY + dy*t + ny*amp}`;
                }
                return <path key={idx} d={dd} fill="none" stroke={c} strokeWidth="1.5" opacity="0.8"/>;
              } else if (fl === 'liner') {
                return <line key={idx} x1={HX} y1={HY} x2={tx} y2={ty} stroke={c} strokeWidth="2" opacity="0.8"/>;
              } else if (fl === 'hr') {
                const mx2 = (HX+tx)/2, my2 = (HY+ty)/2 - 20;
                return (
                  <g key={idx}>
                    <path d={`M ${HX} ${HY} Q ${mx2} ${my2} ${tx} ${ty}`} fill="none" stroke={c} strokeWidth="2" opacity="0.8"/>
                    <circle cx={tx} cy={ty} r="4" fill={c}/>
                    <circle cx={tx} cy={ty} r="7" fill="none" stroke={c} strokeWidth="1"/>
                  </g>
                );
              } else {
                const mx2 = (HX+tx)/2, my2 = (HY+ty)/2 - 15;
                return (
                  <g key={idx}>
                    <path d={`M ${HX} ${HY} Q ${mx2} ${my2} ${tx} ${ty}`} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3,2" opacity="0.8"/>
                    <circle cx={tx} cy={ty} r="3" fill={c}/>
                  </g>
                );
              }
            })}
          </svg>
        </div>
      );
    }

export default SprayChart;
