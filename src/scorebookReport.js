// スコアラー(GDF)様式に忠実な伝統的スコアブックのPDF(印刷用HTML)生成。
// App からは window.generateScorebookReport({ scorebook, gameInfo, gameState }) で呼ばれる。
// scorebook は src/scorebookData.js の buildScorebookData(...) の戻り値。
// 記譜法の解読メモは docs/scorer-notation.md 参照。
  try {
  window.generateScorebookReport = function(data) {
    var w = window.open('', '_blank');
    if (!w) return false;
    var sb = data.scorebook, gi = data.gameInfo, gs = data.gameState;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    var OUT_ROMAN = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

    // 投球1球のマーク(bbscorer公式: ●=ボール, ◎=見逃し, ○=空振り, －=ファウル)。
    // 牽制(pickoff)・イベントは投球列に出さない。
    function pitchMarkSvg(type) {
      var r = 3.4, cx = 5, cy = 5, sz = 10;
      var body;
      if (type === 'ball') body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1e293b"/>';
      else if (type === 'looking') body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#1e293b" stroke-width="1"/><circle cx="' + cx + '" cy="' + cy + '" r="1.4" fill="#1e293b"/>';
      else if (type === 'foul') body = '<line x1="1.5" y1="5" x2="8.5" y2="5" stroke="#1e293b" stroke-width="1.3"/>'; // ファウル=ダッシュ
      else if (type === 'hbp') body = '<text x="' + cx + '" y="7.5" text-anchor="middle" font-size="7" fill="#7c3aed">死</text>';
      else body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#1e293b" stroke-width="1"/>'; // swing/other = 白丸(空振り)
      return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '" style="display:block;">' + body + '</svg>';
    }
    function pitchColumnHtml(cell) {
      var marks = cell.pitchMarks || [], links = cell.pitchLinks || {};
      // pickoff(牽制)は投球列に出さないが、リンク文字は元のindexに対応させたいので
      // フィルタ前のindexで対応付ける。
      var out = [];
      marks.forEach(function (m, i) {
        if (m.type === 'pickoff') return;
        var lk = links[i] ? '<span class="sb-pl">' + esc(links[i]) + '</span>' : '';
        out.push('<div class="sb-pm">' + pitchMarkSvg(m.type) + lk + '</div>');
      });
      // 投球indexに対応しないリンク(最終球以降)も末尾に出す
      Object.keys(links).forEach(function (k) {
        if (Number(k) >= marks.length) out.push('<div class="sb-pm"><span class="sb-pl">' + esc(links[k]) + '</span></div>');
      });
      return '<div class="sb-pit">' + out.join('') + '</div>';
    }

    // ダイヤモンド(bbscorer公式サンプル準拠)。
    // 小さい細グレーのダイヤ＋各頂点からセル辺への十字線(4区画に分割)。
    // 進塁は隅ラベル(cornerLabelsHtml)と中央マークで表す。到達した塁までの辺は
    // 細い線でなぞる。中央 ●生還(自責)/○生還(非自責)/ℓ残塁、打者アウトはローマ数字、
    // 走塁死は赤斜線。四隅=塁(下:本, 右:一, 上:二, 左:三)。
    function diamondSvg(cell) {
      var s = 52, m = 26, dr = 13; // 箱52, 中心26, ダイヤ半径13(小さめ)
      var P = { 0: [m, m + dr], 1: [m + dr, m], 2: [m, m - dr], 3: [m - dr, m], 4: [m, m + dr] };
      var legEnd = [null, [P[0], P[1]], [P[1], P[2]], [P[2], P[3]], [P[3], P[0]]];
      var svg = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">';
      // 頂点→セル辺の十字線(薄グレー)
      svg += '<line x1="' + P[3][0] + '" y1="' + m + '" x2="0" y2="' + m + '" stroke="#d1d5db" stroke-width="0.8"/>';
      svg += '<line x1="' + P[1][0] + '" y1="' + m + '" x2="' + s + '" y2="' + m + '" stroke="#d1d5db" stroke-width="0.8"/>';
      svg += '<line x1="' + m + '" y1="' + P[2][1] + '" x2="' + m + '" y2="0" stroke="#d1d5db" stroke-width="0.8"/>';
      svg += '<line x1="' + m + '" y1="' + P[0][1] + '" x2="' + m + '" y2="' + s + '" stroke="#d1d5db" stroke-width="0.8"/>';
      // ダイヤ外枠(薄グレー)
      svg += '<polygon points="' + [P[0], P[1], P[2], P[3]].map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="#9ca3af" stroke-width="1"/>';

      var reached = cell.scored ? 4 : (cell.basesReachedFinal || 0);
      // 到達した辺を細くなぞる(控えめ)
      for (var b = 1; b <= reached && b <= 4; b++) {
        var e = legEnd[b];
        svg += '<line x1="' + e[0][0] + '" y1="' + e[0][1] + '" x2="' + e[1][0] + '" y2="' + e[1][1] + '" stroke="#475569" stroke-width="1.6" stroke-linecap="round"/>';
      }
      // 中央マーク(公式: ●=得点(自責), ○=得点(非自責), ℓ=残塁)
      if (cell.scored) {
        svg += cell.scoredUnearned
          ? '<circle cx="' + m + '" cy="' + m + '" r="4.2" fill="none" stroke="#dc2626" stroke-width="1.4"/>'
          : '<circle cx="' + m + '" cy="' + m + '" r="4.2" fill="#dc2626"/>';
      } else if (cell.strandedRunner) {
        svg += '<text x="' + m + '" y="' + (m + 5) + '" text-anchor="middle" font-size="14" font-style="italic" font-family="Georgia,serif" fill="#334155">ℓ</text>';
      }
      // 打者アウトのローマ数字
      if (cell.outOrderInInning) svg += '<text x="' + m + '" y="' + (m + 5) + '" text-anchor="middle" font-size="13" font-weight="bold" fill="#334155">' + (OUT_ROMAN[cell.outOrderInInning] || cell.outOrderInInning) + '</text>';
      // 走塁死: 到達塁の1つ先の辺に赤斜線＋その塁にローマ数字
      if (cell.outOnBasesOrderInInning) {
        var ob = Math.min(reached + 1, 4);
        var oe = legEnd[ob];
        var mx = (oe[0][0] + oe[1][0]) / 2, my = (oe[0][1] + oe[1][1]) / 2;
        svg += '<line x1="' + (mx - 4) + '" y1="' + (my - 4) + '" x2="' + (mx + 4) + '" y2="' + (my + 4) + '" stroke="#dc2626" stroke-width="1.8"/>';
        var ov = P[ob === 4 ? 0 : ob];
        svg += '<text x="' + ov[0] + '" y="' + (ov[1] + 4) + '" text-anchor="middle" font-size="10" font-weight="bold" fill="#dc2626">' + (OUT_ROMAN[cell.outOnBasesOrderInInning] || cell.outOnBasesOrderInInning) + '</text>';
      }
      svg += '</svg>';
      return svg;
    }

    // 4隅の塁ラベル。塁→セル隅の対応(スコアラー様式):
    //   一塁=右下, 二塁=右上, 三塁=左上, 本塁=左下。
    // 各塁には「何番打者の打席で進んだか」の数字を (n)=進塁 / [n]=生還 で表示。
    // 一塁隅には打者自身の到達理由(B=四球, 死=死球)を置く。
    function cornerLabelsHtml(cell) {
      var rb = cell.reachedBy || {}, am = cell.advanceMarks || {};
      // 各塁: 盗塁等のコード(S/WP/PB)+リンク文字があればそれを、無ければ「何番打者で進塁」の数字を表示
      var at = function (base, wrap) {
        if (am[base]) return esc(am[base].code) + (am[base].link ? '<span class="sb-lk">' + esc(am[base].link) + '</span>' : '');
        return rb[base] ? esc(wrap.charAt(0) + rb[base] + wrap.charAt(1)) : '';
      };
      var corner = { tl: at(3, '()'), tr: at(2, '()'), bl: at(4, '[]'), br: '' };
      // 一塁=右下: 打者自身の到達理由
      if (cell.finalLabel === '四球') corner.br = 'B';
      else if (cell.finalLabel === '死球') corner.br = '死';
      else if (cell.finalLabel === 'その他出塁') corner.br = 'DIB';
      var h = '';
      if (corner.tl) h += '<span class="sb-c sb-c-tl">' + corner.tl + '</span>';
      if (corner.tr) h += '<span class="sb-c sb-c-tr">' + corner.tr + '</span>';
      if (corner.bl) h += '<span class="sb-c sb-c-bl">' + corner.bl + '</span>';
      if (corner.br) h += '<span class="sb-c sb-c-br">' + esc(corner.br) + '</span>';
      return h;
    }

    // 守備結果テキスト(青字)。飛球(fly)は番号にアーチを付ける。
    function resultTextHtml(cell) {
      var t = cell.resultNotation || '';
      if (!t) return '';
      var cls = 'sb-res';
      if (cell.resultKind === 'fly' || cell.resultKind === 'sacfly') {
        // 飛球は番号にアーチ(公式の ")" 相当)
        return '<div class="' + cls + '"><span class="sb-arch">' + esc(t) + '</span></div>';
      }
      return '<div class="' + cls + '">' + esc(t) + '</div>';
    }

    function cellBoxHtml(cell) {
      return '<div class="sb-box">'
        + pitchColumnHtml(cell)
        + '<div class="sb-play">'
        + cornerLabelsHtml(cell)
        + '<div class="sb-dia">' + diamondSvg(cell) + '</div>'
        + resultTextHtml(cell)
        + '</div>'
        + '</div>';
    }

    function inningTd(cellsArr) {
      if (!cellsArr || !cellsArr.length) return '<td class="sb-td"></td>';
      return '<td class="sb-td">' + cellsArr.map(cellBoxHtml).join('') + '</td>';
    }

    function linescoreTable() {
      var topRuns = (gs.runs.top || []), bottomRuns = (gs.runs.bottom || []);
      var n = sb.maxInning;
      var h = '<table class="sb-linescore"><thead><tr><th class="sb-ls-team">チーム</th>';
      for (var i = 1; i <= n; i++) h += '<th>' + i + '</th>';
      h += '<th>R</th><th>H</th><th>E</th></tr></thead><tbody>';
      function row(teamName, runsArr, team) {
        var r = 0, hSum = 0, eSum = 0, cells = '';
        for (var i = 1; i <= n; i++) { var v = Number(runsArr[i - 1]) || 0; r += v; cells += '<td>' + v + '</td>'; }
        sb[team].inningSummary.forEach(function (s) { hSum += s.H; eSum += s.E; });
        return '<tr><td class="sb-ls-team">' + esc(teamName) + '</td>' + cells + '<td class="sb-ls-total">' + r + '</td><td class="sb-ls-total">' + hSum + '</td><td class="sb-ls-total">' + eSum + '</td></tr>';
      }
      h += row(gi.teamTop, topRuns, 'top') + row(gi.teamBottom, bottomRuns, 'bottom');
      h += '</tbody></table>';
      return h;
    }

    function teamGrid(team, teamName, headBg) {
      var n = sb.maxInning;
      var head = '<tr><th class="sb-hd-narrow">打順</th><th class="sb-hd-name">名前</th><th class="sb-hd-narrow">守備</th>';
      for (var i = 1; i <= n; i++) head += '<th>' + i + '</th>';
      head += '</tr>';
      var rows = team.slots.map(function (slot) {
        var names = slot.occupants.length ? slot.occupants.map(function (o) { return esc(o.name); }).join('<br>') : '<span class="sb-empty">-</span>';
        var poss = slot.occupants.map(function (o) { return esc(o.pos || ''); }).join('<br>');
        var tds = '';
        for (var i = 1; i <= n; i++) tds += inningTd(slot.cellsByInning[i]);
        return '<tr><td class="sb-hd-narrow">' + slot.order + '</td><td class="sb-hd-name">' + names + '</td><td class="sb-hd-narrow">' + poss + '</td>' + tds + '</tr>';
      }).join('');
      function multiRow(label, keys) {
        var cells = '';
        for (var i = 1; i <= n; i++) { var s = team.inningSummary[i - 1]; cells += '<td>' + (s ? keys.map(function (k) { return s[k]; }).join('|') : '') + '</td>'; }
        return '<tr class="sb-sum-row"><td colspan="3" class="sb-sum-label">' + label + '</td>' + cells + '</tr>';
      }
      var foot = multiRow('安打|四球|三振', ['H', 'BB', 'K']) + multiRow('得点|残塁', ['R', 'LOB']) + multiRow('投球数|失策', ['pitchCount', 'E']);
      return '<table class="sb-grid"><thead style="background:' + headBg + ';">' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table>';
    }

    function playerTotalsTable(team) {
      var h = '<table class="sb-totals"><thead><tr><th>選手</th><th>打席</th><th>打数</th><th>得点</th><th>安打</th><th>二</th><th>三</th><th>本</th><th>打点</th><th>四死</th><th>三振</th><th>盗塁</th><th>犠打</th><th>犠飛</th></tr></thead><tbody>';
      team.playerTotals.forEach(function (p) {
        h += '<tr><td class="sb-tot-name">' + esc(p.name) + '</td><td>' + p.PA + '</td><td>' + p.AB + '</td><td>' + p.R + '</td><td>' + p.H + '</td><td>' + p.H2 + '</td><td>' + p.H3 + '</td><td>' + p.HR + '</td><td>' + p.RBI + '</td><td>' + (p.BB + p.HBP) + '</td><td>' + p.K + '</td><td>' + p.SB + '</td><td>' + p.SH + '</td><td>' + p.SF + '</td></tr>';
      });
      h += '</tbody></table>';
      return h;
    }
    function pitcherTable(team) {
      if (!team.pitcherStats.length) return '';
      var h = '<table class="sb-pitchers"><thead><tr><th>投手</th><th>投打</th><th>回</th><th>球数</th><th>打者</th><th>安打</th><th>本</th><th>四死</th><th>三振</th><th>失点</th><th>暴投</th><th>ボーク</th></tr></thead><tbody>';
      team.pitcherStats.forEach(function (p) {
        var innP = (Math.floor(p.outs / 3) + (p.outs % 3) / 10).toFixed(1);
        h += '<tr><td class="sb-tot-name">' + esc(p.name) + '</td><td>' + esc(p.throws) + '</td><td>' + innP + '</td><td>' + p.pitches + '</td><td>' + p.battersFaced + '</td><td>' + p.hits + '</td><td>' + p.hr + '</td><td>' + (p.bb + p.hbp) + '</td><td>' + p.k + '</td><td>' + p.runs + '</td><td>' + p.wildPitches + '</td><td>' + p.balks + '</td></tr>';
      });
      h += '</tbody></table>';
      return h;
    }
    function extraBaseFootnote(team) {
      var parts = [];
      if (team.extraBaseHits.doubles.length) parts.push('二塁打: ' + team.extraBaseHits.doubles.map(esc).join(', '));
      if (team.extraBaseHits.triples.length) parts.push('三塁打: ' + team.extraBaseHits.triples.map(esc).join(', '));
      if (team.extraBaseHits.homeruns.length) parts.push('本塁打: ' + team.extraBaseHits.homeruns.map(esc).join(', '));
      return parts.length ? '<div class="sb-footnote">' + parts.join(' 　 ') + '</div>' : '';
    }

    function teamSection(team, teamName, accent, headBg) {
      return '<section class="sb-section"><h3 class="sb-team-heading" style="color:' + accent + ';">' + esc(teamName) + '</h3>'
        + teamGrid(team, teamName, headBg) + extraBaseFootnote(team) + playerTotalsTable(team) + pitcherTable(team) + '</section>';
    }

    var header = '<div class="sb-header"><div class="sb-header-main"><span class="sb-vs">' + esc(gi.teamTop) + ' 対 ' + esc(gi.teamBottom) + '</span>'
      + '<span class="sb-meta">' + esc(gi.date || '') + (gi.venue ? ' ／ ' + esc(gi.venue) : '') + (gi.tournament ? ' ／ ' + esc(gi.tournament) : '') + '</span></div>' + linescoreTable() + '</div>';

    var legend = '<div class="sb-legend">'
      + '<span>投球(上→下): <b>●</b>ボール <b>◎</b>見逃し <b>○</b>空振り <b>－</b>ファウル</span>'
      + '<span>ダイヤ: 中央 ●=得点(自責) ○=得点(非自責) ℓ=残塁 / Ⅰ Ⅱ Ⅲ=イニング内アウト順 / 赤斜線=走塁死 / 隅の数字(n)=n番打者の打席で進塁 [n]=生還</span>'
      + '<span>結果: K見逃し三振 Ks空振り三振 5-3等=ゴロ守備経路 数字にアーチ=飛球 Ef捕球失 Et送球失 Fc野選 B四球 S盗塁 WP暴投 PB捕逸 / 隅数字(n)=進塁 [n]=生還した打順</span>'
      + '</div>';

    var body = '<div class="sb-page">' + header + legend
      + teamSection(sb.top, gi.teamTop, '#1d4ed8', '#eff6ff')
      + teamSection(sb.bottom, gi.teamBottom, '#e11d48', '#fef2f2') + '</div>';

    var reportFileName = [gi.date, gi.teamTop, 'vs', gi.teamBottom, 'scorebook'].join('_').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    var closeBtn = '<div class="no-print" style="position:fixed;top:12px;right:16px;z-index:999;display:flex;gap:8px;">'
      + '<button onclick="window.print()" style="background:#1e293b;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ 印刷 / PDF</button>'
      + '<button onclick="window.close()" style="background:#e2e8f0;color:#334155;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">✕ 閉じる</button></div>';

    var style = '@page{size:landscape;margin:8mm;}'
      + 'body{margin:0;background:#f1f5f9;font-family:sans-serif;color:#1e293b;}'
      + '.sb-page{max-width:1500px;margin:0 auto;padding:16px 20px 40px;}'
      + '.sb-header-main{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}'
      + '.sb-vs{font-size:18px;font-weight:bold;}.sb-meta{font-size:11px;color:#64748b;}'
      + 'table.sb-linescore{border-collapse:collapse;font-size:11px;margin-bottom:8px;}'
      + '.sb-linescore th,.sb-linescore td{border:1px solid #cbd5e1;padding:3px 8px;text-align:center;}'
      + '.sb-ls-team{text-align:left !important;font-weight:bold;background:#f8fafc;}.sb-ls-total{font-weight:bold;background:#f8fafc;}'
      + '.sb-legend{display:flex;flex-direction:column;gap:1px;font-size:9px;color:#64748b;margin-bottom:10px;}'
      + '.sb-team-heading{font-size:14px;font-weight:bold;margin:14px 0 4px;border-bottom:2px solid currentColor;padding-bottom:2px;}'
      + '.sb-section{break-inside:avoid;page-break-inside:avoid;}'
      + 'table.sb-grid{border-collapse:collapse;font-size:9px;width:100%;margin-bottom:4px;table-layout:fixed;}'
      + '.sb-grid th,.sb-grid td{border:1px solid #cbd5e1;text-align:center;vertical-align:top;}'
      + '.sb-grid thead th{padding:3px 2px;font-size:10px;}'
      + '.sb-hd-narrow{width:26px;}.sb-hd-name{width:66px;font-weight:bold;font-size:9px;text-align:left !important;padding-left:3px !important;}'
      + '.sb-empty{color:#cbd5e1;}'
      + '.sb-td{width:66px;padding:0;background:#fff;}'
      + '.sb-box{position:relative;display:flex;align-items:stretch;border-bottom:1px dotted #e2e8f0;min-height:52px;}'
      + '.sb-box:last-child{border-bottom:none;}'
      + '.sb-pit{width:14px;display:flex;flex-direction:column;align-items:center;padding-top:1px;gap:0px;flex-shrink:0;}'
      + '.sb-pm{position:relative;display:flex;align-items:center;}'
      + '.sb-pl{position:absolute;left:10px;top:0;font-size:6px;font-weight:bold;color:#c026d3;}'
      + '.sb-lk{font-size:5.5px;font-weight:bold;color:#c026d3;vertical-align:super;}'
      + '.sb-play{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1px 0;}'
      + '.sb-dia{position:relative;}'
      + '.sb-c{position:absolute;font-size:7px;font-weight:bold;color:#334155;line-height:1;z-index:2;}'
      + '.sb-c-tl{top:2px;left:1px;}.sb-c-tr{top:2px;right:1px;}.sb-c-bl{bottom:12px;left:1px;}.sb-c-br{bottom:12px;right:1px;}'
      + '.sb-res{font-size:9px;font-weight:bold;color:#1d4ed8;line-height:1;margin-top:-2px;}'
      + '.sb-res-k{color:#1d4ed8;}'
      + '.sb-arch{border-top:1.4px solid #1d4ed8;padding:0 1px;}'
      + '.sb-sum-row{background:#f8fafc;font-size:8px;}.sb-sum-label{text-align:left !important;padding-left:3px !important;font-weight:bold;color:#475569;white-space:nowrap;}'
      + 'table.sb-totals,table.sb-pitchers{border-collapse:collapse;font-size:9px;width:100%;margin:4px 0;}'
      + '.sb-totals th,.sb-totals td,.sb-pitchers th,.sb-pitchers td{border:1px solid #e2e8f0;padding:2px 3px;text-align:center;}'
      + '.sb-totals thead,.sb-pitchers thead{background:#f1f5f9;}.sb-tot-name{text-align:left !important;font-weight:bold;}'
      + '.sb-footnote{font-size:9px;color:#64748b;margin:2px 0 4px;}'
      + '@media print{body{background:#fff !important;}*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}.no-print{display:none !important;}.sb-section{break-inside:avoid;page-break-inside:avoid;}}';

    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(reportFileName) + '<\/title><style>' + style + '<\/style><\/head><body>' + closeBtn + body + '<\/body><\/html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 800);
    return true;
  };
  } catch (e) { console.error('Pre-script error:', e); }
