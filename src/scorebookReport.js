// スコアラー(GDF)様式に忠実な伝統的スコアブックのPDF(印刷用HTML)生成。
// App からは window.generateScorebookReport({ scorebook, gameInfo, gameState }) で呼ばれる。
// scorebook は src/scorebookData.js の buildScorebookData(...) の戻り値。
// 記譜法の解読メモは docs/scorer-notation.md 参照。
  try {
  window.generateScorebookReport = function(data) {
    var w = window.open('', '_blank');
    if (!w) return false;
    var sb = data.scorebook, gi = data.gameInfo, gs = data.gameState;
    var options = Object.assign({ includeCharts: true, includeStats: true }, data.options || {});
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

      // 辺のなぞりは「打者自身の打席結果」で到達した塁までに限る(単打=1辺, 二塁打=2辺 ...)。
      // その後の盗塁/野手選択等での追加進塁は隅ラベルの数字で示すため、辺は追加でなぞらない。
      var reached = cell.basesReachedInitial || 0;
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
        // 盗塁死/牽制死の守備経路(例: 2-6)。理由文字列の末尾「(2-6)」から抽出する
        var routeM = /\(([\d-]+)\)/.exec(cell.outOnBasesReason || '');
        if (routeM) svg += '<text x="' + ov[0] + '" y="' + (ov[1] + (ob === 4 ? -6 : 14)) + '" text-anchor="middle" font-size="8" fill="#dc2626">' + esc(routeM[1]) + '</text>';
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

    // 守備結果テキスト(青字)。十字で区切られた4区画=各塁に対応する(右下=一塁,
    // 右上=二塁, 左上=三塁, 左下=本塁)。「どの塁まで進んだか」は各区画の隅ラベル
    // (cornerLabelsHtml、何番打者の打席で進塁したか)で示す一方、打席結果そのもの
    // (5-3, K, 二塁打/三塁打/本塁打の番号等)は二塁打・本塁打であっても常に
    // 右下(本塁→一塁の区画)に書く。実際のスコアブック(bbscorer)の複数試合を
    // 確認して検証済み: 本塁打も二塁打も守備結果の番号は右下に記載されている。
    // 公式凡例: 飛球=アーチ")", ライナー=直線"－", ファウルフライ=F+アーチ, 犠打/犠飛=四角枠。
    // 四球/死球/その他出塁は到達理由として隅ラベル(B/死/DIB)で表示済みなので、
    // 守備結果としては重複させない。
    function resultTextHtml(cell) {
      var t = cell.resultNotation || '';
      if (!t) return '';
      if (['四球', '死球', 'その他出塁'].indexOf(cell.finalLabel) !== -1) return '';
      var inner = esc(t);
      if (cell.resultKind === 'fly' || cell.resultKind === 'sacfly' || cell.resultKind === 'foulfly') inner = '<span class="sb-arch">' + inner + '</span>';
      else if (cell.resultKind === 'liner') inner = '<span class="sb-line">' + inner + '</span>';
      if (cell.resultKind === 'sac' || cell.resultKind === 'sacfly') inner = '<span class="sb-sqr">' + inner + '</span>';
      return '<div class="sb-res sb-res-br">' + inner + '</div>';
    }

    function cellBoxHtml(cell) {
      return '<div class="sb-box">'
        + pitchColumnHtml(cell)
        + '<div class="sb-play">'
        + '<div class="sb-dia">' + diamondSvg(cell) + '</div>'
        + cornerLabelsHtml(cell)
        + resultTextHtml(cell)
        + '</div>'
        + '</div>';
    }

    // 打席結果欄用の配球文字列(投球順)。●=ボール ◎=見逃し ○=空振り ー=ファウル 死=死球
    var SEQ_CHAR = { ball: '●', looking: '◎', swing: '○', foul: 'ー', hbp: '死' };
    function pitchSeqText(cell) {
      return (cell.pitchMarks || [])
        .filter(function (m) { return m.type !== 'pickoff'; })
        .map(function (m) { return SEQ_CHAR[m.type] || '○'; })
        .join('');
    }

    // アプリ内「打席内容(コース・球種)」と同じ配色・様式のミニストライクゾーン図。
    // 数字=投球順、○=ボール(白抜き)、●=ストライク系(塗り)、点線リング=最終球、色=球種。
    var PT_COLORS = { 'ストレート': '#ef4444', 'スライダー': '#3b82f6', 'シュート': '#10b981', 'カーブ': '#f59e0b', '落ちる球': '#6366f1', 'シンカー': '#06b6d4' };
    var ZONE_CS = 7; // 7x7グリッドのセルpx
    function zoneChartSvg(cell) {
      var marks = (cell.pitchMarks || []).filter(function (m) { return m.type !== 'pickoff'; });
      var cs = ZONE_CS, sz = cs * 7;
      var svg = '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '" style="display:block;background:#fff;">';
      for (var idx = 0; idx < 49; idx++) {
        var row = Math.floor(idx / 7), col = idx % 7;
        var isZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
        svg += '<rect x="' + (col * cs) + '" y="' + (row * cs) + '" width="' + (cs - 0.4) + '" height="' + (cs - 0.4) + '" fill="' + (isZone ? '#f0f9ff' : '#f8fafc') + '" stroke="' + (isZone ? '#bae6fd' : '#e2e8f0') + '" stroke-width="0.3"/>';
      }
      svg += '<rect x="' + (2 * cs) + '" y="' + (2 * cs) + '" width="' + (3 * cs) + '" height="' + (3 * cs) + '" fill="none" stroke="#475569" stroke-width="1"/>';
      var byPos = {};
      marks.forEach(function (m, i) { if (m.course != null) { (byPos[m.course] = byPos[m.course] || []).push({ m: m, seq: i + 1 }); } });
      var r = cs / 2 - 0.7;
      Object.keys(byPos).forEach(function (courseKey) {
        var ps = byPos[courseKey];
        var cIdx = parseInt(courseKey, 10);
        var row = Math.floor(cIdx / 7), col = cIdx % 7;
        var baseCx = col * cs + cs / 2, baseCy = row * cs + cs / 2;
        ps.forEach(function (e, pIdx) {
          // 同一コースに複数球あれば円周上に散らす(App.jsxと同じ)
          var angle = ps.length > 1 ? (pIdx / ps.length) * Math.PI * 2 - Math.PI / 2 : 0;
          var dist = ps.length > 1 ? r * 0.6 : 0;
          var cx = baseCx + Math.cos(angle) * dist, cy = baseCy + Math.sin(angle) * dist;
          var color = PT_COLORS[e.m.pitchType] || '#94a3b8';
          var isBall = e.m.type === 'ball';
          if (e.seq === marks.length) svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 1.3) + '" fill="none" stroke="' + color + '" stroke-width="0.9" stroke-dasharray="1.5 1" opacity="0.75"/>';
          svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (isBall ? '#fff' : color) + '" stroke="' + color + '" stroke-width="' + (isBall ? 0.9 : 0) + '" opacity="0.92"/>';
          svg += '<text x="' + cx + '" y="' + (cy + 1.7) + '" text-anchor="middle" font-size="4.2" font-weight="900" fill="' + (isBall ? color : '#fff') + '">' + e.seq + '</text>';
        });
      });
      svg += '</svg>';
      return svg;
    }

    // 打者1人分の打球方向ミニチャート(App.jsxのSprayChartと同じ座標系240x200)。
    // 青=安打, 赤=アウト, 橙=エラー/野選。ゴロ=ジグザグ, ライナー=直線, 飛球=点線弧, 本塁打=実線弧+二重丸。
    function sprayChartSvg(cells) {
      var HX = 120, HY = 185;
      var pts = [];
      cells.forEach(function (c) {
        if (c.incompletePA) return;
        var x = null, y = null;
        if (c.hasHitLocation && c.hitX !== undefined && c.hitY !== undefined) { x = c.hitX; y = c.hitY; }
        else if (c.sprayFallback) { x = c.sprayFallback.x; y = c.sprayFallback.y; }
        if (x == null) return;
        var isHit = ['single', 'double', 'triple', 'homerun'].indexOf(c.eventType) !== -1;
        var color = isHit ? '#2563eb' : (c.eventType === 'error' || c.resultKind === 'fc') ? '#d97706' : '#dc2626';
        pts.push({ x: x, y: y, color: color, flight: c.flight || 'fly' });
      });
      if (!pts.length) return '';
      var svg = '<svg width="84" height="70" viewBox="0 0 240 200" style="display:block;background:#fff;">';
      svg += '<path d="M 120 185 L 0 65 L 0 0 L 240 0 L 240 65 Z" fill="#f8fafc"/>';
      svg += '<path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7"/>';
      svg += '<path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.6"/>';
      svg += '<path d="M 8 70 Q 120 -25 232 70" fill="none" stroke="#94a3b8" stroke-width="2"/>';
      svg += '<line x1="120" y1="185" x2="8" y2="70" stroke="#fbbf24" stroke-width="1.5"/>';
      svg += '<line x1="120" y1="185" x2="232" y2="70" stroke="#fbbf24" stroke-width="1.5"/>';
      svg += '<polygon points="120,185 80,145 120,110 160,145" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,2"/>';
      pts.forEach(function (p) {
        var tx = p.x, ty = p.y;
        if (p.flight === 'grounder') {
          var dx = tx - HX, dy = ty - HY, dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var nx = -dy / dist, ny = dx / dist;
          var steps = Math.max(4, Math.round(dist / 12));
          var dd = 'M ' + HX + ' ' + HY;
          for (var i = 1; i <= steps; i++) {
            var t = i / steps, amp = (i % 2 === 0 ? 2 : -2) * (1 - t * 0.5);
            dd += ' L ' + (HX + dx * t + nx * amp) + ' ' + (HY + dy * t + ny * amp);
          }
          svg += '<path d="' + dd + '" fill="none" stroke="' + p.color + '" stroke-width="2.5" opacity="0.85"/>';
        } else if (p.flight === 'liner') {
          svg += '<line x1="' + HX + '" y1="' + HY + '" x2="' + tx + '" y2="' + ty + '" stroke="' + p.color + '" stroke-width="3" opacity="0.85"/>';
        } else if (p.flight === 'hr') {
          var mx = (HX + tx) / 2, my = (HY + ty) / 2 - 20;
          svg += '<path d="M ' + HX + ' ' + HY + ' Q ' + mx + ' ' + my + ' ' + tx + ' ' + ty + '" fill="none" stroke="' + p.color + '" stroke-width="3" opacity="0.85"/>';
          svg += '<circle cx="' + tx + '" cy="' + ty + '" r="5" fill="' + p.color + '"/><circle cx="' + tx + '" cy="' + ty + '" r="9" fill="none" stroke="' + p.color + '" stroke-width="1.5"/>';
        } else {
          var mx2 = (HX + tx) / 2, my2 = (HY + ty) / 2 - 15;
          svg += '<path d="M ' + HX + ' ' + HY + ' Q ' + mx2 + ' ' + my2 + ' ' + tx + ' ' + ty + '" fill="none" stroke="' + p.color + '" stroke-width="2.5" stroke-dasharray="5,3" opacity="0.85"/>';
          svg += '<circle cx="' + tx + '" cy="' + ty + '" r="4.5" fill="' + p.color + '"/>';
        }
      });
      svg += '</svg>';
      return svg;
    }

    // 結果ラベルの配色(アプリ内「打席内容」と同じ: 安打=青, 三振=赤, 四死球=グレー)
    function resultLabelColor(cell) {
      if (cell.isHit) return '#1d4ed8';
      if (['三振', 'スリーバント失敗', '振り逃げアウト'].indexOf(cell.finalLabel) !== -1) return '#ef4444';
      if (['四球', '死球', 'その他出塁'].indexOf(cell.finalLabel) !== -1) return '#64748b';
      return '#475569';
    }

    // 各打者行の右端「打席内容・打球方向」パネル。打席ごとに
    // [イニング / コース・球種チャート / 結果] を並べ、末尾にその打者の打球方向図を置く。
    // コース記録が無い打席(スコアラー取込等)はチャートの代わりに配球記号列を出す。
    function paPanelHtml(slot, n) {
      var items = [];
      var sprayCells = [];
      for (var i = 1; i <= n; i++) {
        (slot.cellsByInning[i] || []).forEach(function (c) {
          if (!c.summaryText) return; // 中断打席は結果なし
          sprayCells.push(c);
          var hasCourse = (c.pitchMarks || []).some(function (m) { return m.type !== 'pickoff' && m.course != null; });
          var body = hasCourse
            ? '<div class="sb-pn-zone">' + zoneChartSvg(c) + '</div>'
            : '<div class="sb-pn-seq">' + pitchSeqText(c) + '</div>';
          items.push('<div class="sb-pn-item"><div class="sb-pn-inn">' + i + '回</div>' + body
            + '<div class="sb-pn-res" style="color:' + resultLabelColor(c) + ';">' + esc(c.summaryText) + '</div></div>');
        });
      }
      if (!items.length) return '';
      var spray = sprayChartSvg(sprayCells);
      if (spray) items.push('<div class="sb-pn-item"><div class="sb-pn-inn">打球</div><div class="sb-pn-zone">' + spray + '</div></div>');
      return '<div class="sb-pn">' + items.join('') + '</div>';
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
      // 打者一巡(同一イニングに同じ打順の打席が2つ以上)のイニングは列を左右に分割し、
      // 左が先の打席になるよう横に並べる(上下に積まない)。ヘッダはcolspanで1つのイニング番号。
      var subCols = {};
      for (var i = 1; i <= n; i++) {
        var mx = 1;
        team.slots.forEach(function (slot) { var c = slot.cellsByInning[i]; if (c && c.length > mx) mx = c.length; });
        subCols[i] = mx;
      }
      // 右端パネルの幅は「最も打席数の多い打者の項目数」で決める。幅指定なしにすると
      // 残り幅を全部吸ってしまい、表の右側に大きな空白ができる。
      // 余り幅は table-layout:fixed が各列に按分するので、イニング列も一緒に広がる。
      var maxPanelItems = 0;
      team.slots.forEach(function (slot) {
        var items = 0;
        for (var i = 1; i <= n; i++) (slot.cellsByInning[i] || []).forEach(function (c) { if (c.summaryText) items++; });
        if (items) items++; // 末尾の打球方向図
        if (items > maxPanelItems) maxPanelItems = items;
      });
      var cols = '<colgroup><col style="width:26px"><col style="width:66px"><col style="width:26px">';
      for (var i = 1; i <= n; i++) for (var k = 0; k < subCols[i]; k++) cols += '<col style="width:66px">';
      if (options.includeCharts) cols += '<col style="width:' + Math.max(66, maxPanelItems * 54 + 6) + 'px">';
      cols += '</colgroup>';
      var head = '<tr><th class="sb-hd-narrow">打順</th><th class="sb-hd-name">名前</th><th class="sb-hd-narrow">守備</th>';
      for (var i = 1; i <= n; i++) head += '<th' + (subCols[i] > 1 ? ' colspan="' + subCols[i] + '"' : '') + '>' + i + '</th>';
      if (options.includeCharts) head += '<th class="sb-hd-pa">打席内容(コース・球種)・打球方向</th>';
      head += '</tr>';
      var rows = team.slots.map(function (slot) {
        var names = slot.occupants.length ? slot.occupants.map(function (o) { return esc(o.name); }).join('<br>') : '<span class="sb-empty">-</span>';
        var poss = slot.occupants.map(function (o) { return esc(o.pos || ''); }).join('<br>');
        var tds = '';
        for (var i = 1; i <= n; i++) {
          var cellsArr = slot.cellsByInning[i] || [];
          for (var k = 0; k < subCols[i]; k++) {
            var cls = 'sb-td' + (k > 0 ? ' sb-td-cont' : '');
            tds += '<td class="' + cls + '">' + (cellsArr[k] ? cellBoxHtml(cellsArr[k]) : '') + '</td>';
          }
        }
        if (options.includeCharts) tds += '<td class="sb-td-pa">' + paPanelHtml(slot, n) + '</td>';
        return '<tr><td class="sb-hd-narrow">' + slot.order + '</td><td class="sb-hd-name">' + names + '</td><td class="sb-hd-narrow">' + poss + '</td>' + tds + '</tr>';
      }).join('');
      function multiRow(label, keys) {
        var cells = '';
        for (var i = 1; i <= n; i++) { var s = team.inningSummary[i - 1]; cells += '<td' + (subCols[i] > 1 ? ' colspan="' + subCols[i] + '"' : '') + '>' + (s ? keys.map(function (k) { return s[k]; }).join('|') : '') + '</td>'; }
        return '<tr class="sb-sum-row"><td colspan="3" class="sb-sum-label">' + label + '</td>' + cells + (options.includeCharts ? '<td></td>' : '') + '</tr>';
      }
      var foot = multiRow('安打|四球|三振', ['H', 'BB', 'K']) + multiRow('得点|残塁', ['R', 'LOB']) + multiRow('投球数|失策', ['pitchCount', 'E']);
      return '<table class="sb-grid">' + cols + '<thead style="background:' + headBg + ';">' + head + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table>';
    }

    function playerTotalsTable(players) {
      var h = '<table class="sb-totals"><thead><tr><th class="sb-tot-name">選手</th><th>打席</th><th>打数</th><th>得点</th><th>安打</th><th>二</th><th>三</th><th>本</th><th>打点</th><th>四死</th><th>三振</th><th>盗塁</th><th>犠打</th><th>犠飛</th><th>打率</th></tr></thead><tbody>';
      players.forEach(function (p) {
        var avg = p.AB > 0 ? (p.H / p.AB).toFixed(3).replace(/^0/, '') : '.000';
        h += '<tr><td class="sb-tot-name">' + esc(p.name) + '</td><td>' + p.PA + '</td><td>' + p.AB + '</td><td>' + p.R + '</td><td>' + p.H + '</td><td>' + p.H2 + '</td><td>' + p.H3 + '</td><td>' + p.HR + '</td><td>' + p.RBI + '</td><td>' + (p.BB + p.HBP) + '</td><td>' + p.K + '</td><td>' + p.SB + '</td><td>' + p.SH + '</td><td>' + p.SF + '</td><td>' + avg + '</td></tr>';
      });
      h += '</tbody></table>';
      return h;
    }
    function pitcherTable(team) {
      if (!team.pitcherStats.length) return '';
      var h = '<table class="sb-pitchers"><thead><tr><th class="sb-tot-name">投手</th><th>投打</th><th>回</th><th>球数</th><th>打者</th><th>安打</th><th>本</th><th>四死</th><th>三振</th><th>失点</th><th>暴投</th><th>ボーク</th></tr></thead><tbody>';
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

    // 個人成績はスコア表の下に「打撃成績 | 投手成績」の横並びで敷く。
    // 右側の細い縦列に押し込むより1行が大きく読め、スコア表も紙面の全幅を使える
    // (=打席内容パネルの折り返しが減り、全体の縮小率も小さくて済む)。
    // 打撃成績は人数が多いと縦に伸びて紙面を圧迫する(投手成績の右側は空いたまま)ので、
    // 9人を超えたら2段に割って横に並べ、帯の高さを半分に抑える。
    function teamStatsBand(team) {
      var totals = team.playerTotals;
      var chunks = totals.length > 9 ? [totals.slice(0, Math.ceil(totals.length / 2)), totals.slice(Math.ceil(totals.length / 2))] : [totals];
      var bat = chunks.map(function (rows, i) {
        return '<div class="sb-stats-col"><h4 class="sb-subheading">打撃成績' + (i > 0 ? '(続き)' : '') + '</h4>' + playerTotalsTable(rows) + '</div>';
      }).join('');
      // 投手は人数が少なく右側が空きやすいので、長打の注記もこちらに寄せる
      var right = (team.pitcherStats.length ? '<h4 class="sb-subheading">投手成績</h4>' + pitcherTable(team) : '') + extraBaseFootnote(team);
      return '<div class="sb-stats-band">' + bat + (right ? '<div class="sb-stats-col sb-stats-col-pit">' + right + '</div>' : '') + '</div>';
    }

    function teamScoreSection(team, teamName, accent, headBg) {
      return '<section class="sb-section"><h3 class="sb-team-heading" style="color:' + accent + ';">' + esc(teamName) + '</h3>'
        + teamGrid(team, teamName, headBg)
        + (options.includeStats ? teamStatsBand(team) : extraBaseFootnote(team)) + '</section>';
    }

    // 試合ヘッダーは「試合名・スコア表・凡例」を1行に横並びにする。縦に積むと
    // 紙面の高さを10mm近く食うが、右側は元々空いているので横に置けばタダで済む。
    function headerHtml(legendHtml) {
      return '<div class="sb-header">'
        + '<div class="sb-header-main"><span class="sb-vs">' + esc(gi.teamTop) + ' 対 ' + esc(gi.teamBottom) + '</span>'
        + '<span class="sb-meta">' + esc(gi.date || '') + (gi.venue ? ' ／ ' + esc(gi.venue) : '') + (gi.tournament ? ' ／ ' + esc(gi.tournament) : '') + '</span></div>'
        + '<div class="sb-header-ls">' + linescoreTable() + '</div>'
        + (legendHtml ? '<div class="sb-header-legend">' + legendHtml + '</div>' : '')
        + '</div>';
    }

    var legend = '<div class="sb-legend">'
      + '<span>投球(上→下): <b>●</b>ボール <b>◎</b>見逃し <b>○</b>空振り <b>－</b>ファウル</span>'
      + '<span>ダイヤ: 中央 ●=得点(自責) ○=得点(非自責) ℓ=残塁 / Ⅰ Ⅱ Ⅲ=イニング内アウト順 / 赤斜線=走塁死 / 隅の数字(n)=n番打者の打席で進塁 [n]=生還</span>'
      + '<span>結果: K見逃し三振 Ks空振り三振 5-3等=ゴロ守備経路 数字にアーチ=飛球 直線=ライナー F+数字=邪飛 四角枠=犠打/犠飛 Ef捕球失 Et送球失 Fc野選 B四球 S盗塁 WP暴投 PB捕逸 / 隅数字(n)=進塁 [n]=生還した打順</span>'
      + '<span>打者一巡: 同一イニングに2打席以上ある場合はイニング列を左右に分割(左が1打席目、破線が区切り)</span>'
      + '<span>右端「打席内容」: コース図は 数字=投球順 ○=ボール ●=ストライク系 点線=最終球 色=球種(赤スト 青スラ 緑シュート 橙カーブ 紫落ちる球 水シンカー) / 結果 青=安打 赤=三振 / コース記録が無い打席は配球記号列(●ボール ◎見逃し ○空振り ーファウル) / 打球図: 青=安打 赤=アウト 橙=エラー</span>'
      + '</div>';

    var compactLegend = '<div class="sb-legend-compact">'
      + '<span>投球: ●ボール ◎見逃し ○空振り －ファウル</span>'
      + '<span>ダイヤ: ●得点 ○非自責点 ℓ残塁 ⅠⅡⅢアウト順</span>'
      + '<span>右図: 数字=投球順 点線=最終球／青=安打 赤=アウト 橙=失策</span>'
      + '</div>';

    function sheet(content, pageLabel, legendMode, kind) {
      var legendHtml = legendMode === 'full' ? legend : legendMode === 'compact' ? compactLegend : '';
      return '<article class="sb-sheet sb-' + kind + '-sheet"><div class="sb-sheet-content">' + headerHtml(legendHtml) + content + '</div>'
        + '<div class="sb-page-footer">' + esc(pageLabel) + '</div></article>';
    }

    var body = '<div class="sb-page">'
      + sheet(teamScoreSection(sb.top, gi.teamTop, '#1d4ed8', '#eff6ff'), '先攻スコア', 'compact', 'score')
      + sheet(teamScoreSection(sb.bottom, gi.teamBottom, '#e11d48', '#fef2f2'), '後攻スコア', 'compact', 'score');
    // 個人成績は各チームのスコアページ右側に統合するため、独立した成績ページは作らない。
    body += '</div>';

    var reportFileName = [gi.date, gi.teamTop, 'vs', gi.teamBottom, 'scorebook'].join('_').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    var closeBtn = '<div class="no-print" style="position:fixed;top:12px;right:16px;z-index:999;display:flex;align-items:center;gap:8px;">'
      + '<span style="background:#fff;color:#475569;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;font-size:11px;line-height:1.4;">用紙は<b>A4・横</b>。1チーム1ページに収まらないときは<br>印刷設定の<b>「ヘッダーとフッター」をオフ</b>にしてください</span>'
      + '<button onclick="(window.__sbPrint||window.print).call(window)" style="background:#1e293b;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ 印刷 / PDF</button>'
      + '<button onclick="window.close()" style="background:#e2e8f0;color:#334155;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">✕ 閉じる</button></div>';

    // 画面と印刷でまったく同じ絵にするため、1シート=A4横1ページの固定枠とし、
    // 中身(.sb-sheet-content)は実測して1ページに収まる倍率へ縮小する(fitScript)。
    // 印刷時に寸法や段組みを組み替えない ＝ 画面プレビューがそのまま出力になる。
    //
    // 紙面の大きさ(287mm x 182mm)は @page の余白5mmぴったりではなく、意図的に低くしてある。
    // ブラウザの印刷は @page の余白どおりに出るとは限らず、
    //   ・ヘッダー/フッター(URL・ページ番号)をONにすると上下の余白が広がる
    //   ・プリンタ既定の余白(0.5インチ等)が優先されることがある
    // といった理由で印刷可能領域が縮む。そのときブラウザは「幅に合わせて全体を縮小」
    // するため、高さが余るかどうかは 紙面の縦横比 で決まる。A4横で上下左右12.7mm+
    // ヘッダー/フッター相当まで見込むと 高さ/幅 は 0.66 程度が限界なので、
    // 199mm(0.693)では数mmだけはみ出して2ページ目に薄い帯が出てしまう。
    // 182mm(0.634)なら余白1インチの環境でも1ページに収まる。
    // (縦に詰めたぶんは試合ヘッダーの横並び化で取り返しているので、打席表の高さはほぼ変わらない)
    var style = '@page{size:A4 landscape;margin:5mm;}'
      + 'body{margin:0;background:#f1f5f9;font-family:sans-serif;color:#1e293b;}'
      + '.sb-page{margin:0;padding:0;}'
      + '.sb-sheet{position:relative;box-sizing:border-box;background:#fff;width:287mm;height:182mm;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;}'
      + '.sb-sheet:last-child{break-after:auto;page-break-after:auto;}'
      + '.sb-sheet-content{box-sizing:border-box;width:287mm;display:flow-root;transform-origin:top left;}'
      + '.sb-page-footer{position:absolute;right:1mm;bottom:1mm;font-size:8px;color:#94a3b8;}'
      // 試合名 / スコア表 / 凡例 を横1行に並べる(縦に積まないぶん打席表に高さを回せる)
      + '.sb-header{display:flex;align-items:flex-start;gap:6mm;margin-bottom:2px;}'
      + '.sb-header-main{display:flex;flex-direction:column;gap:1px;flex:none;}'
      + '.sb-header-ls{flex:none;}'
      + '.sb-header-legend{flex:1 1 0;min-width:0;padding-top:1px;}'
      + '.sb-vs{font-size:16px;font-weight:bold;line-height:1.2;}.sb-meta{font-size:10px;color:#64748b;}'
      + 'table.sb-linescore{border-collapse:collapse;font-size:11px;margin:0;}'
      + '.sb-linescore th,.sb-linescore td{border:1px solid #cbd5e1;padding:2px 7px;text-align:center;}'
      + '.sb-ls-team{text-align:left !important;font-weight:bold;background:#f8fafc;}.sb-ls-total{font-weight:bold;background:#f8fafc;}'
      + '.sb-legend{display:flex;flex-direction:column;gap:1px;font-size:9px;color:#64748b;margin:0;}'
      + '.sb-legend-compact{display:flex;flex-wrap:wrap;gap:1px 12px;font-size:7px;color:#64748b;margin:0;}'
      + '.sb-team-heading{font-size:13px;font-weight:bold;margin:4px 0 3px;border-bottom:2px solid currentColor;padding-bottom:1px;break-after:avoid;page-break-after:avoid;}'
      + 'table.sb-grid{border-collapse:collapse;font-size:9px;width:100%;margin-bottom:4px;table-layout:fixed;}'
      + '.sb-grid th,.sb-grid td{border:1px solid #cbd5e1;text-align:center;vertical-align:top;}'
      + '.sb-grid thead th{padding:3px 2px;font-size:10px;}'
      + '.sb-hd-narrow{width:26px;}.sb-hd-name{width:66px;font-weight:bold;font-size:9px;text-align:left !important;padding-left:3px !important;}'
      + '.sb-empty{color:#cbd5e1;}'
      + '.sb-td{width:66px;padding:0;background:#fff;}'
      // 打者一巡でイニング列を分割したときの2列目以降(同一イニングの続き)。境界を破線にして区別
      + '.sb-td-cont{border-left:1px dashed #cbd5e1 !important;}'
      // 右端の「打席内容・打球方向」パネル(コース図+結果+打球方向図)
      + '.sb-hd-pa{font-size:9px;}'
      + '.sb-td-pa{background:#fff;text-align:left !important;vertical-align:top;padding:1px 2px !important;}'
      + '.sb-pn{display:flex;flex-wrap:wrap;align-items:flex-start;gap:3px;}'
      + '.sb-pn-item{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:51px;}'
      + '.sb-pn-inn{font-size:6.5px;font-weight:bold;color:#94a3b8;line-height:1;}'
      + '.sb-pn-zone{border:1px solid #e2e8f0;border-radius:2px;overflow:hidden;}'
      + '.sb-pn-res{font-size:8px;font-weight:bold;line-height:1.1;text-align:center;max-width:60px;}'
      + '.sb-pn-seq{font-size:8px;letter-spacing:-0.5px;color:#475569;max-width:51px;word-break:break-all;text-align:center;line-height:1.3;padding-top:14px;min-height:35px;}'
      // 列が広がったときにダイヤが左に寄って見えないよう、セル内容は中央に置く
      + '.sb-box{position:relative;display:flex;justify-content:center;align-items:stretch;border-bottom:1px dotted #e2e8f0;min-height:52px;}'
      + '.sb-box:last-child{border-bottom:none;}'
      + '.sb-pit{width:14px;display:flex;flex-direction:column;align-items:center;padding-top:1px;gap:0px;flex-shrink:0;}'
      + '.sb-pm{position:relative;display:flex;align-items:center;}'
      + '.sb-pl{position:absolute;left:10px;top:0;font-size:6px;font-weight:bold;color:#c026d3;}'
      + '.sb-lk{font-size:5.5px;font-weight:bold;color:#c026d3;vertical-align:super;}'
      + '.sb-play{position:relative;width:52px;height:52px;flex:none;}'
      + '.sb-dia{position:absolute;top:0;left:0;}'
      + '.sb-c{position:absolute;font-size:7px;font-weight:bold;color:#334155;line-height:1;z-index:2;}'
      + '.sb-c-tl{top:2px;left:1px;}.sb-c-tr{top:2px;right:1px;}.sb-c-bl{bottom:12px;left:1px;}.sb-c-br{bottom:12px;right:1px;}'
      // 守備結果は常に十字の右下区画(本塁→一塁)に配置する(二塁打/三塁打/本塁打でも同じ)
      + '.sb-res{position:absolute;font-size:9px;font-weight:bold;color:#1d4ed8;line-height:1;z-index:2;white-space:nowrap;}'
      + '.sb-res-br{right:1px;bottom:1px;text-align:right;}'
      + '.sb-res-k{color:#1d4ed8;}'
      + '.sb-arch{border-top:1.4px solid #1d4ed8;border-radius:60% 60% 0 0/100% 100% 0 0;padding:0 2px;}'
      + '.sb-line{border-top:1.4px solid #1d4ed8;padding:0 1px;}'
      + '.sb-sqr{border:1px solid #1d4ed8;border-radius:1px;padding:0 2px 1px;display:inline-block;line-height:1.1;}'
      + '.sb-sum-row{background:#f8fafc;font-size:8px;}.sb-sum-label{text-align:left !important;padding-left:3px !important;font-weight:bold;color:#475569;white-space:nowrap;}'
      + '.sb-footnote{font-size:9px;color:#64748b;margin:2px 0 4px;}'
      // 個人成績の帯: 打撃成績(列が多いので広め)と投手成績を横並びにする
      + '.sb-stats-band{display:flex;align-items:flex-start;gap:3mm;margin-top:1.5mm;}'
      + '.sb-stats-col{flex:1.5 1 0;min-width:0;}.sb-stats-col-pit{flex:1 1 0;}'
      + '.sb-subheading{font-size:9px;font-weight:bold;margin:0 0 2px;color:#475569;border-bottom:1px solid #cbd5e1;padding-bottom:1px;}'
      + 'table.sb-totals,table.sb-pitchers{border-collapse:collapse;table-layout:fixed;font-size:8px;width:100%;margin:0;}'
      + '.sb-totals th,.sb-totals td,.sb-pitchers th,.sb-pitchers td{border:1px solid #dbe3ec;padding:1.5px 2px;text-align:center;white-space:nowrap;}'
      + '.sb-totals thead,.sb-pitchers thead{background:#f1f5f9;color:#475569;}'
      + '.sb-tot-name{text-align:left !important;font-weight:bold;width:30%;white-space:normal;overflow-wrap:anywhere;line-height:1.2;}'
      + '.sb-pitchers .sb-tot-name{width:24%;}'
      + '.sb-stats-col .sb-footnote{margin:3px 0 0;}'
      // 画面: シート自体の寸法・内部倍率は印刷と同一のまま、ページ全体だけを画面幅に合わせて縮小表示する
      + '@media screen{body{overflow-x:hidden;}.sb-page{width:287mm;max-width:none;overflow:visible;transform:scale(var(--preview-scale,1));transform-origin:top left;margin:12px;}.sb-sheet{margin:0 0 18px;box-shadow:0 8px 30px rgba(15,23,42,.12);}}'
      // 印刷: プレビュー用の縮小(と本文高さ指定)を外すだけ。シートの寸法・中身の倍率は画面と同じ
      + '@media print{body{background:#fff!important;height:auto!important;}.sb-page{margin:0;padding:0;transform:none!important;}.sb-sheet{margin:0;box-shadow:none;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}.no-print{display:none!important;}}';

    // ブラウザ任せの改ページは環境ごとに結果が変わり、画面プレビューと印刷がずれる原因になる。
    // そこでポップアップ側で「A4横1ページ = .sb-sheet(287mm x 199mm)」の紙面を自分で組み、
    // 画面はその紙面をそのまま並べて表示するだけにする(＝プレビュー = 印刷結果)。
    //   1) 倍率探索: 中身の版面幅を 287mm/k に広げて k 倍に縮小する。単純な全体縮小と違い
    //      右端パネルの折り返しが減るため、少ない縮小でページ数を減らせる。
    //      ページ数が最小になる中で最大の k(=一番大きい文字)を採用する。
    //   2) 改ページ: 採用した k で打者行を実測し、1ページに入る分だけ詰める。
    //      行の途中では切らず、試合ヘッダー・表ヘッダー・列幅は全ページ共通にする。
    //   3) 保険: それでも溢れるページは、そのページだけさらに縮小して収める。
    var fitScript = [
      '(function(){',
      'var KS=[1,.92,.85,.78,.72,.66,.62],templates=null;',
      // 元の(チーム単位の)シートを雛形として保持し、再実行時は必ず雛形から組み直す
      'function initTemplates(){',
      'if(templates)return;',
      'templates=[];',
      'var list=document.querySelectorAll(".sb-sheet");',
      'for(var i=0;i<list.length;i++)templates.push(list[i].cloneNode(true));',
      '}',
      // 版面を availW/k の幅で組んで k 倍に縮小する(見た目の幅は availW のまま)
      'function applyScale(c,k,availW){',
      'c.style.width=(availW/k)+"px";',
      'c.style.transform=k<1?"scale("+k+")":"none";',
      'c.setAttribute("data-k",String(k));',
      '}',
      // 現在の版面で打者行をページに詰める。戻り値は各ページの行indexの配列
      // (offsetTop/offsetHeight は transform の影響を受けない版面座標なので availH も k で割る)
      'function planPages(sheet,content,k){',
      'var table=content.querySelector(".sb-grid");if(!table)return [[]];',
      'var availH=sheet.clientHeight/k;',
      'var thead=table.querySelector("thead"),tfoot=table.querySelector("tfoot");',
      'var theadH=thead?thead.offsetHeight:0;',
      // 集計行・注記・個人成績の帯は最終ページにだけ載るので、最終行の余白として確保する
      'var tail=(tfoot?tfoot.offsetHeight:0);',
      'var extras=content.querySelectorAll(".sb-footnote,.sb-stats-band");',
      'for(var e=0;e<extras.length;e++)tail+=extras[e].offsetHeight;',
      // 表より上(試合ヘッダー・凡例・チーム名)は毎ページ再掲するので固定費として引く
      'var budget=availH-table.offsetTop-theadH-4;',
      'var rows=table.querySelectorAll("tbody tr"),hs=[],total=0;',
      'for(var i=0;i<rows.length;i++){hs.push(rows[i].offsetHeight);total+=hs[i];}',
      'var groups=pack(hs,budget,Infinity,tail);',
      // ページ数が変わらない範囲で各ページの行数をならす(最終ページが1行だけ等を避ける)
      'if(groups.length>1){',
      'var even=pack(hs,budget,Math.ceil(total/groups.length)+1,tail);',
      'if(even.length<=groups.length)groups=even;',
      '}',
      'return groups.length?groups:[[]];',
      '}',
      // 行を上から詰める。budget=1ページの実寸、cap=ならし用の目標高さ、tail=最終ページの追加分
      'function pack(hs,budget,cap,tail){',
      'var groups=[],cur=[],used=0;',
      'for(var i=0;i<hs.length;i++){',
      'var h=hs[i],extra=(i===hs.length-1)?tail:0;',
      'if(cur.length&&(used+h+extra>budget||used+h>cap)){groups.push(cur);cur=[];used=0;}',
      'cur.push(i);used+=h;',
      '}',
      'if(cur.length)groups.push(cur);',
      'return groups;',
      '}',
      // ページ数が最小になる中で最大の倍率を探す
      'function planTeam(tpl,host){',
      'var probe=tpl.cloneNode(true);host.appendChild(probe);',
      'var content=probe.querySelector(".sb-sheet-content");',
      'var best={k:1,groups:[[]]};',
      'if(content){',
      'var availW=probe.clientWidth;',
      'for(var i=0;i<KS.length;i++){',
      'applyScale(content,KS[i],availW);',
      'var groups=planPages(probe,content,KS[i]);',
      'if(i===0||groups.length<best.groups.length)best={k:KS[i],groups:groups};',
      'if(best.groups.length<=1)break;',
      '}}',
      'host.removeChild(probe);',
      'return best;',
      '}',
      // 雛形1枚(=1チーム)をA4ページ群に分割して host に並べる
      'function buildPages(tpl,host){',
      'var plan=planTeam(tpl,host),groups=plan.groups;',
      'for(var g=0;g<groups.length;g++){',
      'var sheet=tpl.cloneNode(true),last=(g===groups.length-1);',
      'var tb=sheet.querySelector(".sb-grid tbody");',
      'if(tb){var trs=[].slice.call(tb.children);',
      'for(var r=0;r<trs.length;r++)if(groups[g].indexOf(r)<0)tb.removeChild(trs[r]);}',
      // 集計行・注記・個人成績の帯は最終ページのみ
      'if(!last){',
      'var ft=sheet.querySelector(".sb-grid tfoot");if(ft)ft.parentNode.removeChild(ft);',
      'var ex=sheet.querySelectorAll(".sb-footnote,.sb-stats-band");',
      'for(var x=0;x<ex.length;x++)ex[x].parentNode.removeChild(ex[x]);',
      '}',
      'var foot=sheet.querySelector(".sb-page-footer");',
      'if(foot&&groups.length>1)foot.textContent=foot.textContent+" "+(g+1)+"/"+groups.length;',
      'host.appendChild(sheet);',
      'var c=sheet.querySelector(".sb-sheet-content");',
      'if(c)applyScale(c,plan.k,sheet.clientWidth);',
      '}',
      '}',
      'function paginate(){',
      'var host=document.querySelector(".sb-page");if(!host)return;',
      'initTemplates();',
      'host.innerHTML="";',
      'for(var i=0;i<templates.length;i++)buildPages(templates[i],host);',
      '}',
      // 保険: 1行が1ページより高い等でまだ溢れるページは、そのページだけさらに縮めて収める
      'function fitSheets(){',
      'var sheets=document.querySelectorAll(".sb-sheet");',
      'for(var i=0;i<sheets.length;i++){',
      'var s=sheets[i],c=s.querySelector(".sb-sheet-content");if(!c)continue;',
      'var k=parseFloat(c.getAttribute("data-k"))||1,guard=0;',
      'while(c.offsetHeight*k>s.clientHeight&&k>.3&&guard++<20){',
      'k=Math.round((k-.04)*100)/100;applyScale(c,k,s.clientWidth);',
      '}}}',
      // 画面プレビューだけ、紙面(287mm)を画面幅に合わせて全体縮小する(印刷には効かない)
      'function fitPreview(){',
      'var page=document.querySelector(".sb-page");if(!page)return;',
      'var sheet=document.querySelector(".sb-sheet");',
      'var target=(sheet?sheet.offsetWidth:1085)+24;',
      'var scale=Math.min(1,Math.max(.3,window.innerWidth/target));',
      'document.documentElement.style.setProperty("--preview-scale",String(scale));',
      'document.body.style.height=Math.ceil(page.scrollHeight*scale+24)+"px";',
      '}',
      'function layout(){paginate();fitSheets();fitPreview();}',
      'window.__sbPrint=function(){layout();window.print();};',
      // 紙面は mm 基準なので画面幅が変わっても組版は不変。リサイズ時は表示倍率だけ直す
      'window.addEventListener("resize",fitPreview);',
      'window.addEventListener("load",layout);',
      'window.addEventListener("beforeprint",fitSheets);',
      'if(document.fonts&&document.fonts.ready&&document.fonts.ready.then)document.fonts.ready.then(layout);',
      'layout();',
      '})();'
    ].join('');
    var previewScript = '<script>' + fitScript + '<' + '/script>';
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(reportFileName) + '<\/title><style>' + style + '<\/style><\/head><body>' + closeBtn + body + previewScript + '<\/body><\/html>');
    w.document.close();
    // 自動印刷の前に、フォント読み込み後のレイアウトで倍率を計算し直す
    setTimeout(function () {
      try {
        if (typeof w.__sbPrint === 'function') w.__sbPrint();
        else w.print();
      } catch (e) { try { w.print(); } catch (e2) { /* 印刷ボタンから再実行できる */ } }
    }, 800);
    return true;
  };
  } catch (e) { console.error('Pre-script error:', e); }
