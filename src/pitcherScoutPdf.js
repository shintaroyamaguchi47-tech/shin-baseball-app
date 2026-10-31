// 相手投手レポートの印刷用HTML(ブラウザの印刷から「PDFに保存」できる)。
// 1投手=A4縦1ページを目安に組む。複数投手はページを分けて1つの資料にする。
import { quickTimeStats } from './pitcherScouting.js';
import { openReportWindow, writeReport } from './reportWindow.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const TONE = {
  attack: { label: '狙う', color: '#047857', bg: '#ecfdf5' },
  wait: { label: '待つ', color: '#1d4ed8', bg: '#eff6ff' },
  caution: { label: '注意', color: '#be123c', bg: '#fff1f2' },
  info: { label: '参考', color: '#475569', bg: '#f8fafc' },
};
const SHARE_COLORS = ['#f43f5e', '#3b82f6', '#fbbf24', '#10b981', '#6366f1', '#06b6d4', '#94a3b8'];
const shareText = (shares, limit = 3) => shares.slice(0, limit).map(s => `${s.type} ${s.pct}%`).join('・') || '—';

const shareBar = shares => `<div class="bar">${shares.map((s, i) => `<i style="width:${s.pct}%;background:${SHARE_COLORS[i % SHARE_COLORS.length]}"></i>`).join('')}</div>`;

// 7×7コース図(捕手目線)。打者の左右で内角・外角の見出しを入れ替える
const courseSvg = (c, size = 112) => {
  const cs = size / 7;
  let cells = '';
  c.grid.forEach((n, i) => {
    if (!n) return;
    const row = Math.floor(i / 7), col = i % 7, op = (0.15 + 0.85 * n / c.max).toFixed(2);
    cells += `<rect x="${col * cs}" y="${row * cs}" width="${cs}" height="${cs}" fill="rgba(225,29,72,${op})"/>`
      + `<text x="${col * cs + cs / 2}" y="${row * cs + cs / 2 + 3}" text-anchor="middle" font-size="8" font-weight="bold" fill="${op > 0.55 ? '#fff' : '#334155'}">${n}</text>`;
  });
  const left = c.side === '右' ? '内角' : '外角', right = c.side === '右' ? '外角' : '内角';
  return `<div class="course"><div class="lr"><span>${left}</span><span>${right}</span></div>`
    + `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#f8fafc" stroke="#cbd5e1"/>${cells}`
    + `<rect x="${cs * 2}" y="${cs * 2}" width="${cs * 3}" height="${cs * 3}" fill="none" stroke="#334155" stroke-width="1.5"/></svg></div>`;
};
const pctOf = (v, n) => n ? Math.round(v / n * 100) : 0;

// 手書き用の罫線(メモが空欄のとき、試合中に書き込めるように)
const ruled = (lines) => `<div class="ruled">${'<div></div>'.repeat(lines)}</div>`;
const memoBlock = (title, text, lines = 3) => `<div class="memo"><div class="mt">${esc(title)}</div>${text ? `<div class="mtext">${nl2br(text)}</div>` : ruled(lines)}</div>`;

/**
 * 投手1人ぶんのページ。
 * @param {{ teamName, pitcher, report, plan, memo, gamesLabel }} page
 */
export function pitcherPageHtml({ teamName, pitcher, report, plan, memo = {}, gamesLabel = '' }) {
  const s = report.summary;
  const quick = quickTimeStats(memo.quickTimes);
  const breaking = Object.entries(memo.breaking || {}).filter(([, b]) => b && (b.size || b.speed || b.note));

  const head = `<div class="head"><div><div class="sub">${esc(teamName)}｜相手投手レポート</div><h1>${esc(pitcher.name)}<span class="throws">${esc(pitcher.throws ? `${pitcher.throws}投` : '')}</span></h1></div>`
    + `<div class="sub right">${esc(gamesLabel)}<br>${s.games}試合・対戦打者${s.batters}人・${s.pitches}球</div></div>`;

  const stats = `<div class="stats">${[
    ['ストライク率', `${s.strikePct}%`, `初球 ${s.firstStrikePct}%`],
    ['空振り率', `${s.whiffPct}%`, '空振り÷スイング'],
    ['三振率', `${s.KPct}%`, `奪三振 ${s.strikeouts}`],
    ['四死球率', `${s.BBPct}%`, ''],
    ['被打率', s.AVG, `打者1人 ${s.pitchesPerBatter}球`],
    ['クイック', quick ? `${quick.avg.toFixed(2)}秒` : '—', quick ? `${quick.min.toFixed(2)}〜${quick.max.toFixed(2)}・${quick.n}回` : '未計測'],
    ['球速', memo.maxSpeed ? `${esc(memo.maxSpeed)}km` : '—', memo.avgSpeed ? `直球平均 ${esc(memo.avgSpeed)}km` : '最速'],
  ].map(([l, v, h]) => `<div class="stat"><div class="sl">${l}</div><div class="sv">${v}</div><div class="sh">${h}</div></div>`).join('')}</div>`;

  const planHtml = `<div class="sec"><h2>次戦の攻略ポイント</h2>${plan.length
    ? `<ul class="plan">${plan.map(t => { const tn = TONE[t.tone] || TONE.info; return `<li style="border-color:${tn.color};background:${tn.bg};color:${tn.color}"><b>${tn.label}</b><span>${esc(t.text)}</span></li>`; }).join('')}</ul>`
    : '<p class="muted">記録が少ないため、攻略ポイントはまだありません</p>'}</div>`;

  const countTable = `<div class="sec"><h2>カウント別の狙い球 <small>最も多い球種(3球以上で60%以上は黄色)・下段はストライク率</small></h2><table class="counts"><thead><tr><th class="bl"></th><th>0ストライク</th><th>1ストライク</th><th>2ストライク</th></tr></thead><tbody>`
    + [0, 1, 2, 3].map(b => `<tr><th>${b}ボール</th>${[0, 1, 2].map(st => {
      const c = report.byCount.find(x => x.count === `${b}-${st}`);
      if (!c || !c.n) return '<td class="empty">—</td>';
      const strong = c.top && c.top.pct >= 60 && c.n >= 3; // 1〜2球だけの100%は強調しない
      return `<td class="${strong ? 'strong' : ''}"><div class="cn"><span>${c.count}</span><span>${c.n}球</span></div><div class="ct">${esc(c.top.type)} ${c.top.pct}%</div><div class="co">${esc(shareText(c.shares.slice(1), 2))}</div>${shareBar(c.shares)}<div class="co">ストライク ${c.strikePct}%</div></td>`;
    }).join('')}</tr>`).join('')
    + '</tbody></table>'
    + `<div class="sits">${[['初球', report.situations.first], ['ボール先行', report.situations.hitterAhead], ['追い込んでから', report.situations.twoStrikes], ['フルカウント', report.situations.full]].map(([l, g]) => `<div class="sit"><div class="cn"><span>${l}</span><span>${g.n}球</span></div><div class="ct">${esc(shareText(g.shares, 2))}</div><div class="co">直球系 ${g.fastballPct}%・ストライク ${g.strikePct}%</div></div>`).join('')}</div>`
    + (report.kPitches.length ? `<p class="kp"><b>決め球(三振を奪った球種)</b> ${esc(report.kPitches.map(k => `${k.type} ${k.n}個`).join('・'))}</p>` : '')
    + '</div>';

  const typeTable = `<div class="sec half"><h2>球種別</h2><table class="grid"><thead><tr><th>球種</th><th>割合</th><th>対右</th><th>対左</th><th>ストライク</th><th>空振り</th><th>被安</th><th>奪K</th></tr></thead><tbody>`
    + (report.byType.length ? report.byType.map(t => `<tr><th>${esc(t.type)}</th><td>${t.share}%<small>(${t.n})</small></td><td>${t.vsRight}%</td><td>${t.vsLeft}%</td><td>${t.strikePct}%</td><td>${t.whiffPct}%</td><td>${t.hits}</td><td>${t.strikeouts}</td></tr>`).join('') : '<tr><td colspan="8" class="muted">記録なし</td></tr>')
    + '</tbody></table></div>';

  const courseHtml = `<div class="sec half"><h2>コース <small>捕手目線</small></h2><div class="courses">${report.course.map(c => `<div class="cside"><div class="ch">対${c.side}打者 ${c.n}球</div>${courseSvg(c)}${c.n ? `<div class="cz">${Object.entries(c.height).map(([k, v]) => `${k} ${pctOf(v, c.n)}%`).join(' / ')}<br>${Object.entries(c.width).map(([k, v]) => `${k} ${pctOf(v, c.n)}%`).join(' / ')}</div>` : ''}</div>`).join('')}</div></div>`;

  const r = report.running;
  const runningHtml = `<div class="sec half"><h2>牽制・走者</h2><table class="grid kv"><tbody>`
    + `<tr><th>牽制</th><td>${r.pickoffs}回(走者ありの打者1人あたり ${r.pickoffsPerRunnerPa}回)</td></tr>`
    + `<tr><th>塁別</th><td>${Object.keys(r.pickoffBases).length ? esc(Object.entries(r.pickoffBases).map(([b, n]) => `${b} ${n}回`).join('・')) : 'なし'}</td></tr>`
    + `<tr><th>牽制死</th><td>${r.pickoffOuts}</td></tr><tr><th>盗塁</th><td>許 ${r.stealsAllowed} / 刺 ${r.caughtStealing}</td></tr>`
    + `<tr><th>ボーク・暴投</th><td>${r.balks} / ${r.wildPitches}</td></tr></tbody></table></div>`;

  const staminaHtml = `<div class="sec half"><h2>球数による変化</h2><table class="grid"><thead><tr><th>球数</th><th>球</th><th>ストライク</th><th>直球系</th><th>被安</th><th>四死球</th></tr></thead><tbody>`
    + (report.stamina.length ? report.stamina.map(b => `<tr><th>${b.label}</th><td>${b.n}</td><td>${b.strikePct}%</td><td>${b.fastballPct}%</td><td>${b.hits}</td><td>${b.walks}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">記録なし</td></tr>')
    + '</tbody></table></div>';

  const breakingHtml = `<div class="memo"><div class="mt">変化球の曲がり幅</div>${breaking.length
    ? `<table class="grid"><tbody>${breaking.map(([type, b]) => `<tr><th>${esc(type)}</th><td class="size">${b.size ? `曲がり ${esc(b.size)}` : ''}</td><td>${b.speed ? `${esc(b.speed)}km/h` : ''}</td><td class="left">${esc(b.note || '')}</td></tr>`).join('')}</tbody></table>`
    : ruled(3)}</div>`;

  const memoHtml = `<div class="sec"><h2>計測・観察メモ</h2><div class="memos">${breakingHtml}`
    + memoBlock('セット・牽制の癖', memo.setHabit)
    + memoBlock('球種がわかる癖・フォーム', memo.tells)
    + memoBlock('攻略メモ', memo.plan)
    + '</div></div>';

  return `<section class="page">${head}${stats}${planHtml}${countTable}<div class="row">${typeTable}${courseHtml}</div><div class="row">${runningHtml}${staminaHtml}</div>${memoHtml}</section>`;
}

const CSS = '@page{size:A4 portrait;margin:8mm;}'
  + '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
  + 'body{margin:0;background:#f1f5f9;font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#0f172a;font-size:10px;line-break:strict;}'
  + '.page{max-width:194mm;margin:12px auto;background:#fff;padding:10px 12px;border-radius:8px;}'
  + '.page+.page{break-before:page;page-break-before:always;}'
  + '.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e11d48;padding-bottom:5px;margin-bottom:6px;}'
  + 'h1{font-size:20px;margin:0;}.throws{font-size:11px;color:#64748b;margin-left:8px;}'
  + '.sub{font-size:9px;color:#64748b;font-weight:bold;}.right{text-align:right;}'
  + '.stats{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;}'
  + '.stat{border:1px solid #e2e8f0;border-radius:6px;padding:3px 5px;}.sl{font-size:8px;color:#64748b;font-weight:bold;}.sv{font-size:14px;font-weight:900;}.sh{font-size:7.5px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
  + '.sec{margin-bottom:6px;break-inside:avoid;page-break-inside:avoid;}'
  + 'h2{font-size:11px;margin:0 0 3px;padding-left:5px;border-left:3px solid #334155;}h2 small{font-size:8px;color:#94a3b8;font-weight:normal;margin-left:4px;}'
  + '.plan{list-style:none;margin:0;padding:0;display:grid;gap:2px;}.plan li{border-left:3px solid;padding:3px 6px;border-radius:0 4px 4px 0;display:flex;gap:6px;font-weight:bold;}.plan b{flex:none;width:24px;font-size:8.5px;opacity:.8;}'
  + 'table{border-collapse:collapse;width:100%;}'
  + '.counts{table-layout:fixed;border-collapse:separate;border-spacing:3px;}.counts thead th{font-size:8.5px;color:#d97706;}.counts th.bl{width:34px;}.counts tbody th{font-size:8.5px;color:#059669;text-align:left;}'
  + '.counts td{border:1px solid #e2e8f0;border-radius:5px;padding:3px 4px;vertical-align:top;}.counts td.strong{background:#fffbeb;border-color:#fcd34d;}.counts td.strong .ct{color:#92400e;}.counts td.empty{color:#cbd5e1;text-align:center;background:#f8fafc;}'
  + '.cn{display:flex;justify-content:space-between;font-size:7.5px;color:#94a3b8;font-weight:bold;}.ct{font-size:10px;font-weight:900;}.co{font-size:7.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
  + '.bar{display:flex;height:4px;border-radius:2px;overflow:hidden;background:#f1f5f9;margin:2px 0;}.bar i{display:block;height:100%;}'
  + '.sits{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:3px;}.sit{border:1px solid #e2e8f0;border-radius:5px;padding:3px 5px;}'
  + '.kp{margin:3px 0 0;font-size:9px;}.kp b{color:#be123c;margin-right:4px;}'
  + '.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}'
  + '.grid th,.grid td{border-bottom:1px solid #e2e8f0;padding:2px 3px;text-align:center;font-size:8.5px;white-space:nowrap;}.grid thead th{color:#64748b;font-size:7.5px;}.grid tbody th{text-align:left;}.grid small{color:#94a3b8;margin-left:1px;}'
  + '.kv td{text-align:left;}.grid td.left{text-align:left;white-space:normal;}.grid td.size{font-weight:bold;color:#4338ca;}'
  + '.courses{display:flex;gap:8px;}.cside{flex:1;}.ch{font-size:8.5px;font-weight:bold;color:#475569;}.lr{display:flex;justify-content:space-between;width:112px;font-size:7.5px;color:#94a3b8;font-weight:bold;}.cz{font-size:7.5px;color:#475569;margin-top:2px;}'
  + '.memos{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;}.memo{border:1px solid #e2e8f0;border-radius:5px;padding:3px 6px;}.mt{font-size:8.5px;font-weight:bold;color:#1d4ed8;}.mtext{font-size:9px;line-height:1.5;}'
  + '.ruled div{height:15px;border-bottom:1px dashed #cbd5e1;}.muted{color:#94a3b8;}'
  + '.toolbar{position:fixed;top:10px;right:14px;display:flex;gap:8px;z-index:9;}.toolbar button{border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;}'
  + '@media print{body{background:#fff;}.page{margin:0;padding:0;border-radius:0;max-width:none;}.no-print{display:none !important;}}';

/**
 * 印刷用HTML全体(1つ以上の投手ページ)。
 */
export function buildPitcherScoutHtml(pages, title = '相手投手レポート') {
  const toolbar = '<div class="toolbar no-print"><button onclick="window.print()" style="background:#1e293b;color:#fff">🖨️ 印刷 / PDF</button><button onclick="window.close()" style="background:#e2e8f0;color:#334155">✕ 閉じる</button></div>';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${toolbar}${pages.map(pitcherPageHtml).join('')}</body></html>`;
}

/**
 * 印刷用HTMLを開いて印刷ダイアログを出す(開き方は reportWindow.js)。開けなければ false。
 */
export function openPitcherScoutPdf(pages, title) {
  const w = openReportWindow(title);
  if (!w) return false;
  writeReport(w, buildPitcherScoutHtml(pages, title));
  setTimeout(() => { try { w.print(); } catch (e) { /* 画面の印刷ボタンから再実行できる */ } }, 600);
  return true;
}
