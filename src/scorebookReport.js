// 伝統的なスコアブック様式のPDF(印刷用HTML)生成。
// App からは window.generateScorebookReport({ scorebook, gameInfo, gameState }) で呼ばれる。
// scorebook は src/scorebookData.js の buildScorebookData(...) の戻り値。
  try {
  window.generateScorebookReport = function(data) {
    var w = window.open('', '_blank');
    if (!w) return false;
    var sb = data.scorebook, gi = data.gameInfo, gs = data.gameState;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    var PITCH_GLYPH = { ball: '○', looking: '●', swing: '✕', foul: 'F', hbp: 'HB', pickoff: '牽', other: '·' };
    var PITCH_COLOR = { ball: '#16a34a', looking: '#1e293b', swing: '#dc2626', foul: '#d97706', hbp: '#7c3aed', pickoff: '#0ea5e9', other: '#94a3b8' };
    var OUT_ROMAN = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

    function pitchMarksHtml(marks) {
      if (!marks || !marks.length) return '';
      var h = '<div class="sb-marks">';
      marks.forEach(function (m) {
        var label = m.type === 'pickoff' ? '牽' + (m.label.match(/\((.)/) ? m.label.match(/\((.)/)[1] : '') : PITCH_GLYPH[m.type] || '·';
        h += '<span style="color:' + (PITCH_COLOR[m.type] || '#94a3b8') + ';" title="' + esc(m.label) + '">' + esc(label) + '</span>';
      });
      h += '</div>';
      return h;
    }

    // ダイヤモンド: home(下)→1塁(右)→2塁(上)→3塁(左)→home。
    // basesReachedInitialまでの区間は実線(その打席自身の進塁)、
    // それ以降basesReachedFinalまでは破線(盗塁・暴投・捕逸・失策等による後続の進塁)で描く。
    function diamondSvg(cell) {
      var s = 34;
      var home = [s / 2, s - 2], first = [s - 2, s / 2], second = [s / 2, 2], third = [2, s / 2];
      var edges = [[home, first], [first, second], [second, third], [third, home]];
      var outline = '<polygon points="' + [home, first, second, third].map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="#cbd5e1" stroke-width="1"/>';
      var segs = '';
      var initial = cell.basesReachedInitial || 0, final = cell.basesReachedFinal || 0;
      var color = cell.eventType === 'error' ? '#d97706' : '#2563eb';
      for (var leg = 1; leg <= 4 && leg <= final; leg++) {
        var e = edges[leg - 1], solid = leg <= initial;
        segs += '<line x1="' + e[0][0] + '" y1="' + e[0][1] + '" x2="' + e[1][0] + '" y2="' + e[1][1] + '" stroke="' + color + '" stroke-width="2.5"' + (solid ? '' : ' stroke-dasharray="3,2"') + ' stroke-linecap="round"/>';
      }
      var scoredDot = final === 4 ? '<circle cx="' + home[0] + '" cy="' + home[1] + '" r="2.6" fill="#dc2626"/>' : '';
      var outVertex = [null, first, second, third, home];
      var outMark = '';
      if (cell.outOnBasesOrderInInning) {
        var v = outVertex[final] || first;
        outMark = '<line x1="' + (v[0] - 3) + '" y1="' + (v[1] - 3) + '" x2="' + (v[0] + 3) + '" y2="' + (v[1] + 3) + '" stroke="#dc2626" stroke-width="1.6"/>'
          + '<line x1="' + (v[0] - 3) + '" y1="' + (v[1] + 3) + '" x2="' + (v[0] + 3) + '" y2="' + (v[1] - 3) + '" stroke="#dc2626" stroke-width="1.6"/>';
      }
      return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' + outline + segs + scoredDot + outMark + '</svg>';
    }

    function cellBoxHtml(cell) {
      var h = '<div class="sb-box">';
      h += pitchMarksHtml(cell.pitchMarks);
      h += '<div class="sb-diamond-wrap">' + diamondSvg(cell);
      if (cell.outOrderInInning) h += '<div class="sb-outorder">' + (OUT_ROMAN[cell.outOrderInInning] || cell.outOrderInInning) + '</div>';
      if (cell.rbi > 0) h += '<div class="sb-rbi">' + '●'.repeat(Math.min(cell.rbi, 4)) + '</div>';
      h += '</div>';
      h += '<div class="sb-result">' + esc(cell.resultNotation || '') + '</div>';
      var notes = (cell.advancementNotes || []).map(function (n) { return n.text; }).filter(Boolean);
      if (cell.outOnBasesReason) notes.push(cell.outOnBasesReason);
      if (notes.length) h += '<div class="sb-notes">' + esc(notes.join(' / ')) + '</div>';
      h += '</div>';
      return h;
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
        var r = 0, hSum = 0, eSum = 0;
        var cells = '';
        for (var i = 1; i <= n; i++) {
          var v = Number(runsArr[i - 1]) || 0; r += v;
          cells += '<td>' + (i <= n ? v : '') + '</td>';
        }
        sb[team].inningSummary.forEach(function (s) { hSum += s.H; eSum += s.E; });
        return '<tr><td class="sb-ls-team">' + esc(teamName) + '</td>' + cells + '<td class="sb-ls-total">' + r + '</td><td class="sb-ls-total">' + hSum + '</td><td class="sb-ls-total">' + eSum + '</td></tr>';
      }
      h += row(gi.teamTop, topRuns, 'top') + row(gi.teamBottom, bottomRuns, 'bottom');
      h += '</tbody></table>';
      return h;
    }

    function teamGrid(team, teamName, accent) {
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

      function sumRow(label, key) {
        var cells = '';
        for (var i = 1; i <= n; i++) { var s = team.inningSummary[i - 1]; cells += '<td>' + (s ? s[key] : '') + '</td>'; }
        return '<tr class="sb-sum-row"><td colspan="3" class="sb-sum-label">' + label + '</td>' + cells + '</tr>';
      }
      var foot = sumRow('安打|四球|三振', 'H') // 3値を1セルにまとめて描画するため下でカスタム処理
        ;
      // 安打/四球/三振、得点/残塁、投球数/失策を1セルに2〜3行でまとめる
      function multiRow(label, keys) {
        var cells = '';
        for (var i = 1; i <= n; i++) {
          var s = team.inningSummary[i - 1];
          cells += '<td>' + (s ? keys.map(function (k) { return s[k]; }).join('|') : '') + '</td>';
        }
        return '<tr class="sb-sum-row"><td colspan="3" class="sb-sum-label">' + label + '</td>' + cells + '</tr>';
      }
      foot = multiRow('安打|四球|三振', ['H', 'BB', 'K'])
        + multiRow('得点|残塁', ['R', 'LOB'])
        + multiRow('投球数|失策', ['pitchCount', 'E']);

      return '<table class="sb-grid"><thead style="background:' + accent + ';">' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table>';
    }

    function playerTotalsTable(team) {
      var h = '<table class="sb-totals"><thead><tr><th>選手</th><th>打席</th><th>打数</th><th>得点</th><th>安打</th><th>二塁打</th><th>三塁打</th><th>本塁打</th><th>打点</th><th>四死球</th><th>三振</th><th>盗塁</th><th>犠打</th><th>犠飛</th></tr></thead><tbody>';
      team.playerTotals.forEach(function (p) {
        h += '<tr><td class="sb-tot-name">' + esc(p.name) + '</td><td>' + p.PA + '</td><td>' + p.AB + '</td><td>' + p.R + '</td><td>' + p.H + '</td><td>' + p.H2 + '</td><td>' + p.H3 + '</td><td>' + p.HR + '</td><td>' + p.RBI + '</td><td>' + (p.BB + p.HBP) + '</td><td>' + p.K + '</td><td>' + p.SB + '</td><td>' + p.SH + '</td><td>' + p.SF + '</td></tr>';
      });
      h += '</tbody></table>';
      return h;
    }

    function pitcherTable(team) {
      if (!team.pitcherStats.length) return '';
      var h = '<table class="sb-pitchers"><thead><tr><th>投手</th><th>投打</th><th>回</th><th>球数</th><th>打者</th><th>安打</th><th>本塁打</th><th>四死球</th><th>三振</th><th>失点</th><th>暴投</th><th>ボーク</th></tr></thead><tbody>';
      team.pitcherStats.forEach(function (p) {
        var innPitched = (Math.floor(p.outs / 3) + (p.outs % 3) / 10).toFixed(1);
        h += '<tr><td class="sb-tot-name">' + esc(p.name) + '</td><td>' + esc(p.throws) + '</td><td>' + innPitched + '</td><td>' + p.pitches + '</td><td>' + p.battersFaced + '</td><td>' + p.hits + '</td><td>' + p.hr + '</td><td>' + (p.bb + p.hbp) + '</td><td>' + p.k + '</td><td>' + p.runs + '</td><td>' + p.wildPitches + '</td><td>' + p.balks + '</td></tr>';
      });
      h += '</tbody></table>';
      return h;
    }

    function extraBaseHitsFootnote(team) {
      var parts = [];
      if (team.extraBaseHits.doubles.length) parts.push('二塁打: ' + team.extraBaseHits.doubles.map(esc).join(', '));
      if (team.extraBaseHits.triples.length) parts.push('三塁打: ' + team.extraBaseHits.triples.map(esc).join(', '));
      if (team.extraBaseHits.homeruns.length) parts.push('本塁打: ' + team.extraBaseHits.homeruns.map(esc).join(', '));
      if (!parts.length) return '';
      return '<div class="sb-footnote">' + parts.join(' 　 ') + '</div>';
    }

    function teamSection(team, teamName, accent) {
      var h = '<section class="sb-section">';
      h += '<h3 class="sb-team-heading" style="color:' + accent + ';">' + esc(teamName) + '</h3>';
      h += teamGrid(team, teamName, accent === '#1d4ed8' ? '#eff6ff' : '#fef2f2');
      h += extraBaseHitsFootnote(team);
      h += playerTotalsTable(team);
      h += pitcherTable(team);
      h += '</section>';
      return h;
    }

    var header = '<div class="sb-header">'
      + '<div class="sb-header-main"><span class="sb-vs">' + esc(gi.teamTop) + ' 対 ' + esc(gi.teamBottom) + '</span>'
      + '<span class="sb-meta">' + esc(gi.date || '') + (gi.venue ? ' ／ ' + esc(gi.venue) : '') + (gi.tournament ? ' ／ ' + esc(gi.tournament) : '') + '</span></div>'
      + linescoreTable()
      + '</div>';

    var legend = '<div class="sb-legend no-print-hide">'
      + '<span>投球記号: <span style="color:' + PITCH_COLOR.ball + ';">○ボール</span> <span style="color:' + PITCH_COLOR.looking + ';">●見逃し</span> <span style="color:' + PITCH_COLOR.swing + ';">✕空振り</span> <span style="color:' + PITCH_COLOR.foul + ';">Fファウル</span> <span style="color:' + PITCH_COLOR.pickoff + ';">牽制</span></span>'
      + '<span>ダイヤモンド: 実線=打席自身の進塁 / 破線=盗塁・暴投・捕逸・失策等での進塁 / 赤点=生還 / 赤✕=走塁死 / Ⅰ Ⅱ Ⅲ=イニング内の何アウト目か / ●=打点</span>'
      + '</div>';

    var body = '<div class="sb-page">' + header + legend
      + teamSection(sb.top, gi.teamTop, '#1d4ed8')
      + teamSection(sb.bottom, gi.teamBottom, '#e11d48')
      + '</div>';

    var reportFileName = [gi.date, gi.teamTop, 'vs', gi.teamBottom, 'scorebook'].join('_').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    var closeBtn = '<div class="no-print" style="position:fixed;top:12px;right:16px;z-index:999;display:flex;gap:8px;">'
      + '<button onclick="window.print()" style="background:#1e293b;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ 印刷 / PDF</button>'
      + '<button onclick="window.close()" style="background:#e2e8f0;color:#334155;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">✕ 閉じる</button>'
      + '</div>';

    var style = '@page{size:landscape;margin:8mm;}'
      + 'body{margin:0;background:#f1f5f9;font-family:sans-serif;color:#1e293b;}'
      + '.sb-page{max-width:1400px;margin:0 auto;padding:16px 20px 40px;}'
      + '.sb-header-main{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}'
      + '.sb-vs{font-size:18px;font-weight:bold;}'
      + '.sb-meta{font-size:11px;color:#64748b;}'
      + 'table.sb-linescore{border-collapse:collapse;font-size:11px;margin-bottom:10px;}'
      + '.sb-linescore th,.sb-linescore td{border:1px solid #cbd5e1;padding:3px 8px;text-align:center;}'
      + '.sb-ls-team{text-align:left !important;font-weight:bold;background:#f8fafc;}'
      + '.sb-ls-total{font-weight:bold;background:#f8fafc;}'
      + '.sb-legend{display:flex;flex-direction:column;gap:2px;font-size:9px;color:#64748b;margin-bottom:10px;}'
      + '.sb-team-heading{font-size:14px;font-weight:bold;margin:14px 0 4px;border-bottom:2px solid currentColor;padding-bottom:2px;}'
      + '.sb-section{break-inside:avoid;page-break-inside:avoid;}'
      + 'table.sb-grid{border-collapse:collapse;font-size:9px;width:100%;margin-bottom:4px;table-layout:fixed;}'
      + '.sb-grid th,.sb-grid td{border:1px solid #cbd5e1;text-align:center;vertical-align:top;}'
      + '.sb-grid thead th{padding:3px 2px;font-size:10px;color:#1e293b;}'
      + '.sb-hd-narrow{width:28px;}'
      + '.sb-hd-name{width:70px;font-weight:bold;font-size:9px;text-align:left !important;padding-left:4px !important;}'
      + '.sb-empty{color:#cbd5e1;}'
      + '.sb-td{width:56px;padding:1px;background:#fff;}'
      + '.sb-box{position:relative;display:inline-block;width:100%;padding:1px 0;border-bottom:1px dotted #e2e8f0;}'
      + '.sb-box:last-child{border-bottom:none;}'
      + '.sb-marks{font-size:7px;line-height:1;letter-spacing:0.5px;min-height:8px;}'
      + '.sb-diamond-wrap{position:relative;width:34px;height:34px;margin:0 auto;}'
      + '.sb-outorder{position:absolute;top:-2px;left:-2px;font-size:9px;font-weight:bold;color:#475569;}'
      + '.sb-rbi{position:absolute;bottom:-2px;right:-2px;font-size:6px;color:#dc2626;letter-spacing:-1px;}'
      + '.sb-result{font-size:9px;font-weight:bold;color:#1d4ed8;line-height:1.1;}'
      + '.sb-notes{font-size:6.5px;color:#d97706;line-height:1.1;word-break:break-all;}'
      + '.sb-sum-row{background:#f8fafc;font-size:8px;}'
      + '.sb-sum-label{text-align:left !important;padding-left:4px !important;font-weight:bold;color:#475569;white-space:nowrap;}'
      + 'table.sb-totals,table.sb-pitchers{border-collapse:collapse;font-size:9px;width:100%;margin:4px 0;}'
      + '.sb-totals th,.sb-totals td,.sb-pitchers th,.sb-pitchers td{border:1px solid #e2e8f0;padding:2px 4px;text-align:center;}'
      + '.sb-totals thead,.sb-pitchers thead{background:#f1f5f9;}'
      + '.sb-tot-name{text-align:left !important;font-weight:bold;}'
      + '.sb-footnote{font-size:9px;color:#64748b;margin:2px 0 4px;}'
      + '@media print{'
      + 'body{background:#fff !important;}*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}'
      + '.no-print{display:none !important;}'
      + '.sb-section{break-inside:avoid;page-break-inside:avoid;}'
      + '}';

    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(reportFileName) + '<\/title><style>' + style + '<\/style><\/head><body>' + closeBtn + body + '<\/body><\/html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 800);
    return true;
  };
  } catch (e) { console.error('Pre-script error:', e); }
