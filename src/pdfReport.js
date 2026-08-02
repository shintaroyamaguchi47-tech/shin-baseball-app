// 試合分析レポートのPDF(印刷用HTML)生成。App からは window.generatePdfReport(...) で呼ばれる。
  try {
  window.generatePdfReport = function(data) {
    var w = window.open('', '_blank');
    if (!w) return false;
    var gi = data.gameInfo, gs = data.gameState, stats = data.advancedStats, ps = data.pitches, hAndE = data.hitsAndErrors, analyst = data.analystInsights;
    var topTotal = gs.runs.top.reduce(function(a,b){return a+b;},0);
    var bottomTotal = gs.runs.bottom.reduce(function(a,b){return a+b;},0);
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    // 日本語の見出し・ラベル・記録文は「語の途中」で折り返すと読みにくいので、
    // 意味のまとまりを1単位として扱う。
    //   nw() … 絶対に折り返さない(短いラベル・選手名・数値)
    //   jp() … 語の途中では折らず、どうしても入らないときだけ折る(文節が空白で区切られた記録文)
    function nw(s) { return '<span class="nw">'+esc(s)+'</span>'; }
    function jp(s) { return '<span class="jp">'+esc(s)+'</span>'; }
    // 記録文(走者の進塁・選手交代)を「折り返してよい位置」で区切ったまとまりに分解する。
    // 交代の記録は [退]/[入]/[移] が意味の切れ目なので、そこだけを折り返し位置にする。
    // 例: 選手交代: [退]7番/右 宮崎幹太 ➡️ [入]右 望月唯愛 (守備)
    //     → ['選手交代:', '[退]7番/右 宮崎幹太 ➡️', '[入]右 望月唯愛 (守備)']
    // 走者の記録(「1塁走者 盗塁で2塁へ」)は切れ目がないので丸ごと1つのまとまりになる。
    function recordChunks(text) {
      var out = [];
      String(text).split(/\s+/).forEach(function(t){
        if (!t) return;
        if (!out.length || /^[\[［]/.test(t)) out.push(t);
        else out[out.length-1] += ' ' + t;
      });
      return out;
    }
    // 記録文1件を1行として組み立てる(折り返しは recordChunks の区切りでのみ起きる)。
    // ただし自由入力の長い記録は表の幅を壊すため、長いまとまりだけは文節(空白)で折り返せるようにする。
    function recordLineHtml(text) {
      return recordChunks(text).map(function(c){ return c.length <= 22 ? nw(c) : jp(c); }).join(' ');
    }
    function heatmapSvg(d, mx, color, label, sz) {
      sz = sz || 55;
      var GS=7, cs=sz/GS;
      var clrHex=color==='red'?'#ef4444':color==='indigo'?'#8b5cf6':'#3b82f6';
      var h='<div style="display:inline-block;text-align:center;margin:1px;">';
      if(label){h+='<div style="font-size:9px;font-weight:bold;color:'+clrHex+';margin-bottom:2px;">'+esc(label)+'</div>';}
      h+='<svg width="'+sz+'" height="'+sz+'" viewBox="0 0 '+sz+' '+sz+'" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.05);">';
      h+='<rect x="'+(cs*2)+'" y="'+(cs*2)+'" width="'+(cs*3)+'" height="'+(cs*3)+'" fill="none" stroke="#64748b" stroke-width="1.5"/>';
      // マス目に合わせて数字を拡大(図を大きくしたときに読めるように)
      var fnt=Math.max(8, Math.min(13, Math.round(cs*0.72)));
      for(var i=0;i<GS*GS;i++){var row=Math.floor(i/GS),col=i%GS,v=d[i]||0;if(v>0){var op=mx>0?(v/mx)*0.85:0;var fill=color==='red'?'rgba(239,68,68,'+op+')':color==='indigo'?'rgba(139,92,246,'+op+')':'rgba(59,130,246,'+op+')';h+='<rect x="'+(col*cs)+'" y="'+(row*cs)+'" width="'+cs+'" height="'+cs+'" fill="'+fill+'"/>';h+='<text x="'+(col*cs+cs/2)+'" y="'+(row*cs+cs/2+fnt*0.36)+'" text-anchor="middle" fill="'+(op>0.5?'#fff':'#334155')+'" font-size="'+fnt+'" font-family="monospace" font-weight="bold">'+v+'</text>';}}
      h+='</svg></div>';return h;
    }
    function formatResultTagsHtml(results) {
      var list = (results || []).filter(Boolean);
      if (!list.length) return '<span style="color:#94a3b8;">-</span>';
      return list.map(function(r){
        return '<span class="nw" style="display:inline-block;margin:1px 3px 1px 0;padding:1px 5px;border-radius:999px;background:#eef2ff;color:#334155;font-size:9px;line-height:1.3;">'+esc(r)+'</span>';
      }).join('');
    }
    function sprayChartSvg(hits, label, size, emptyLabel) {
      size = size || 240;
      emptyLabel = emptyLabel || 'No Data';
      var svgH = Math.round(200 * size / 240);
      var HX=120,HY=185;
      var h='<div style="display:inline-block;text-align:center;">';
      if(label) h+='<div style="font-size:'+(size<=140?'9px':'11px')+';font-weight:bold;color:#475569;margin-bottom:2px;background:#f1f5f9;padding:'+(size<=140?'1px 5px':'2px 8px')+';border-radius:8px;display:inline-block;">'+jp(label)+'</div><br/>';
      h+='<svg width="'+size+'" height="'+svgH+'" viewBox="0 0 240 200" style="background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;">';
      h+='<path d="M 120 185 L 0 65 L 0 0 L 240 0 L 240 65 Z" fill="#f8fafc"/>';
      h+='<path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7"/>';
      h+='<path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.6"/>';
      h+='<path d="M 8 70 Q 120 -25 232 70" fill="none" stroke="#94a3b8" stroke-width="2"/>';
      h+='<line x1="120" y1="185" x2="8" y2="70" stroke="#fbbf24" stroke-width="1.5"/>';
      h+='<line x1="120" y1="185" x2="232" y2="70" stroke="#fbbf24" stroke-width="1.5"/>';
      h+='<polygon points="120,185 80,145 120,110 160,145" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,2"/>';
      (hits||[]).forEach(function(pt, idx){
        // 重なり回避のオフセットは投球indexから決定論的に算出（再印刷で位置が動かないように）
        var jx=pt.isManual?0:((idx*53)%9-4)*0.5;
        var jy=pt.isManual?0:((idx*29)%9-4)*0.5;
        var tx=pt.x+jx;
        var ty=pt.y+jy;
        var c=pt.type==='hit'?'#2563eb':pt.type==='error'?'#d97706':pt.type==='foul'?'#9333ea':'#dc2626';
        var fl=pt.flight||'fly';
        if(fl==='grounder'){var dx=tx-HX,dy=ty-HY,dist=Math.sqrt(dx*dx+dy*dy),nx=-dy/dist,ny=dx/dist,dd='M '+HX+' '+HY,steps=Math.max(4,Math.round(dist/12));for(var i=1;i<=steps;i++){var t=i/steps,amp=(i%2===0?2:-2)*(1-t*0.5);dd+=' L '+(HX+dx*t+nx*amp)+' '+(HY+dy*t+ny*amp);}h+='<path d="'+dd+'" fill="none" stroke="'+c+'" stroke-width="1.5" opacity="0.8"/>';}
        else if(fl==='liner'){h+='<line x1="'+HX+'" y1="'+HY+'" x2="'+tx+'" y2="'+ty+'" stroke="'+c+'" stroke-width="2" opacity="0.8"/>';}
        else if(fl==='hr'){var mx2=(HX+tx)/2,my2=(HY+ty)/2-20;h+='<path d="M '+HX+' '+HY+' Q '+mx2+' '+my2+' '+tx+' '+ty+'" fill="none" stroke="'+c+'" stroke-width="2" opacity="0.8"/>';h+='<circle cx="'+tx+'" cy="'+ty+'" r="4" fill="'+c+'"/><circle cx="'+tx+'" cy="'+ty+'" r="7" fill="none" stroke="'+c+'" stroke-width="1"/>';}
        else{var mx2=(HX+tx)/2,my2=(HY+ty)/2-15;h+='<path d="M '+HX+' '+HY+' Q '+mx2+' '+my2+' '+tx+' '+ty+'" fill="none" stroke="'+c+'" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.8"/>';}
        if(fl!=='hr')h+='<circle cx="'+tx+'" cy="'+ty+'" r="3" fill="'+c+'"/>';
      });
      if(!hits||hits.length===0)h+='<text x="120" y="100" text-anchor="middle" fill="#94a3b8" font-size="12" font-weight="bold">'+esc(emptyLabel)+'</text>';
      h+='</svg></div>';return h;
    }
    function batterTable(batting, teamName) {
      // 見出しと選手名は縦積み(「守/備」「山脇諒/大」)になると読めないので折り返さない。
      // 幅の調整は最後の「打席結果」列(タグが自然に折り返す)に任せる。
      var th='<th class="nw" style="padding:8px 6px;text-align:';
      var h='<section class="report-section page-break"><h3 class="report-heading" style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">打者成績: '+jp(teamName)+'</h3><table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;"><thead><tr style="background:#f1f5f9;color:#475569;border-bottom:2px solid #cbd5e1;">'
        +th+'left;">順</th>'+th+'left;">選手名</th>'+th+'center;">守備</th>'+th+'center;">投打</th>'
        +th+'right;">打数</th>'+th+'right;">安打</th>'+th+'right;">四死</th>'+th+'right;">打率</th>'
        +th+'right;">OPS</th>'+th+'right;">K%</th>'+th+'left;">打席結果</th></tr></thead><tbody>';
      batting.players.forEach(function(p, i){var bg=i%2===0?'#ffffff':'#f8fafc'; h+='<tr style="background:'+bg+';border-bottom:1px solid #e2e8f0;"><td style="padding:6px;">'+p.order+'</td><td class="nw" style="padding:6px;font-weight:bold;">'+esc(p.name)+'</td><td class="nw" style="padding:6px;text-align:center;color:#475569;">'+esc(p.pos||'-')+'</td><td style="padding:6px;text-align:center;color:#475569;font-size:10px;white-space:nowrap;">'+esc((p.throws||'?')+'投/'+(p.bats||'?')+'打')+'</td><td style="padding:6px;text-align:right;">'+p.AB+'</td><td style="padding:6px;text-align:right;">'+p.H+'</td><td style="padding:6px;text-align:right;">'+p.BB_HBP+'</td><td style="padding:6px;text-align:right;color:#0ea5e9;font-weight:bold;">'+p.AVG+'</td><td style="padding:6px;text-align:right;color:#d97706;font-weight:bold;">'+p.OPS+'</td><td style="padding:6px;text-align:right;">'+p.KPct+'%</td><td class="jp" style="padding:6px;font-size:10px;line-height:1.6;">'+formatResultTagsHtml(p.results)+'</td></tr>';});
      h+='</tbody></table></section>';return h;
    }
    // 打者詳細: 旧「打者詳細」+「打席内容」を1枚のカードに統合。
    // スプレー図と打席ごとのコース図を同じカードに収め、重複していた結果タグ一覧は省く。
    function batterDetails(batting, teamName) {
      var players = (batting.players || []).filter(function(p){ return p.PA > 0; });
      if (players.length === 0) return '';
      var colors = { 'ストレート':'#ef4444', 'スライダー':'#3b82f6', 'シュート':'#10b981', 'カーブ':'#f59e0b', '落ちる球':'#6366f1', 'シンカー':'#06b6d4' };
      // 打者詳細は同じチームの打者成績の続きに流す(改ページしない)
      var h='<section class="report-section"><div class="report-heading" style="margin:0 0 4px;font-size:14px;font-weight:bold;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:3px;break-after:avoid;page-break-after:avoid;">打者詳細: '+jp(teamName)+' <span style="font-size:9px;font-weight:normal;color:#64748b;">(打球方向・打席内容)</span></div>';
      h+='<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:6px;font-size:9px;color:#64748b;align-items:center;">';
      Object.entries(colors).forEach(function(e){ h+='<span style="white-space:nowrap;"><span style="display:inline-block;width:8px;height:8px;background:'+e[1]+';border-radius:50%;margin-right:3px;"></span>'+esc(e[0])+'</span>'; });
      ['○=ボール','●=ストライク系','数字=投球順','点線=最終球'].forEach(function(t){ h+='<span style="white-space:nowrap;">'+esc(t)+'</span>'; });
      h+='</div>';
      // 配球図を大きく取るため1人1行を基本にしつつ、2打席以下の選手は半分の幅にして横に並べ、
      // ページ内の余白を減らす。カード単位で分割禁止にし、ページをまたがないようにする
      function batterCard(p){
        var c='<div class="bdc" style="width:100%;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;box-sizing:border-box;">';
        c+='<div style="font-size:11px;font-weight:bold;border-bottom:1px solid #e2e8f0;padding-bottom:3px;margin-bottom:5px;line-height:1.5;">'
          +'<span style="white-space:nowrap;">'+p.order+'番 '+esc(p.name)+'</span>'
          +' <span style="font-size:10px;color:#0ea5e9;white-space:nowrap;">AVG:'+p.AVG+' OPS:'+p.OPS+'</span>'
          +' <span style="font-size:9px;color:#64748b;font-weight:normal;white-space:nowrap;">'+p.AB+'打数'+p.H+'安打</span>'
          +' <span style="font-size:9px;color:#64748b;font-weight:normal;white-space:nowrap;">四死'+p.BB_HBP+' K'+p.K+'</span></div>';
        c+='<div style="display:flex;flex-wrap:wrap;gap:6px 8px;align-items:flex-start;">';
        (p.atBats || []).forEach(function(ab){
          var rl=atBatResultLabel(ab.result);
          c+='<div style="width:152px;text-align:center;">';
          c+='<div style="font-size:9px;color:#64748b;font-weight:bold;white-space:nowrap;margin-bottom:1px;">'+ab.inning+'回'+(ab.isTop?'表':'裏')+'</div>';
          c+='<div style="display:flex;gap:4px;justify-content:center;align-items:flex-start;">';
          c+='<div><div style="font-size:8px;color:#94a3b8;font-weight:bold;">配球</div><div style="border:1px solid #e2e8f0;border-radius:4px;overflow:hidden;background:#fff;display:inline-block;">'+atBatZoneSvg(ab.pitches, 13)+'</div></div>';
          c+='<div><div style="font-size:8px;color:#94a3b8;font-weight:bold;">打球方向</div>'+sprayChartSvg(ab.sprayHit?[ab.sprayHit]:[],'',56,'なし')+'</div>';
          c+='</div>';
          c+='<div style="font-size:9px;font-weight:bold;line-height:1.3;color:'+rl.color+';word-break:keep-all;line-break:strict;">'+esc(rl.text)+'</div>';
          c+='</div>';
        });
        c+='</div></div>';
        return c;
      }
      // カードはflexコンテナに並べず、1行=1カード(2打席以下の選手は2枚)のテーブルにする。
      // flexアイテムの break-inside:avoid は印刷時に無視するブラウザ(Safari系)があり、
      // 見出しだけがページ末尾に取り残されて中身が次ページ、という割れ方をしていた。
      // 分割禁止がどのブラウザでも確実に効くのは表の行(tr)なので、行単位で並べる。
      var rows=[];
      for (var ri=0; ri<players.length; ri++) {
        var cur=players[ri], next=players[ri+1];
        var isNarrow=function(pl){ return (pl.atBats||[]).length<=2; };
        if (isNarrow(cur) && next && isNarrow(next)) { rows.push([cur, next]); ri++; }
        else rows.push([cur]);
      }
      h+='<table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0 6px;">';
      rows.forEach(function(r){
        h+='<tr class="bdr">';
        if (r.length===2) {
          h+='<td style="width:50%;vertical-align:top;padding-right:3px;">'+batterCard(r[0])+'</td>'
            +'<td style="width:50%;vertical-align:top;padding-left:3px;">'+batterCard(r[1])+'</td>';
        } else {
          h+='<td colspan="2" style="vertical-align:top;">'+batterCard(r[0])+'</td>';
        }
        h+='</tr>';
      });
      h+='</table></section>';
      return h;
    }
    function atBatZoneSvg(abPitches, cellSize) {
      var ptColors = { 'ストレート':'#ef4444', 'スライダー':'#3b82f6', 'シュート':'#10b981', 'カーブ':'#f59e0b', '落ちる球':'#6366f1', 'シンカー':'#06b6d4' };
      var cs = cellSize || 10, svgSz = cs * 7, byPos = {};
      (abPitches || []).forEach(function(p, i) {
        if (p.course !== null && p.course !== undefined && p.course !== '') {
          if (!byPos[p.course]) byPos[p.course] = [];
          byPos[p.course].push(Object.assign({}, p, { seq: i + 1 }));
        }
      });
      var h='<svg width="'+svgSz+'" height="'+svgSz+'" viewBox="0 0 '+svgSz+' '+svgSz+'" style="display:block;background:#fff;">';
      for (var idx=0; idx<49; idx++) {
        var row=Math.floor(idx/7), col=idx%7, isZone=row>=2&&row<=4&&col>=2&&col<=4;
        h+='<rect x="'+(col*cs)+'" y="'+(row*cs)+'" width="'+(cs-0.5)+'" height="'+(cs-0.5)+'" fill="'+(isZone?'#f0f9ff':'#f8fafc')+'" stroke="'+(isZone?'#bae6fd':'#e2e8f0')+'" stroke-width="0.4"/>';
      }
      h+='<rect x="'+(2*cs)+'" y="'+(2*cs)+'" width="'+(3*cs)+'" height="'+(3*cs)+'" fill="none" stroke="#475569" stroke-width="'+(cs>=12?2:1.4)+'" rx="0.5"/>';
      // 図を大きくした分、マーカーと投球順の数字もマス目に合わせて拡大する
      var mkFnt=Math.max(5, Math.round(cs*0.62));
      Object.entries(byPos).forEach(function(entry) {
        var cIdx=parseInt(entry[0],10), ps=entry[1], row=Math.floor(cIdx/7), col=cIdx%7;
        if (!Number.isFinite(cIdx)) return;
        var baseCx=col*cs+cs/2, baseCy=row*cs+cs/2, r=cs/2-(cs>=12?1.8:1.2);
        ps.forEach(function(p, pIdx) {
          var angle=ps.length>1?(pIdx/ps.length)*Math.PI*2-Math.PI/2:0, dist=ps.length>1?r*0.55:0;
          var cx=baseCx+Math.cos(angle)*dist, cy=baseCy+Math.sin(angle)*dist;
          var color=ptColors[p.type] || '#94a3b8', isBall=['ボール','ウエスト'].includes(p.result), isLast=p.seq===(abPitches||[]).length;
          if (isLast) h+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r+cs*0.2)+'" fill="none" stroke="'+color+'" stroke-width="'+(cs>=12?1.8:1.3)+'" stroke-dasharray="'+(cs>=12?'3 1.5':'2 1')+'" opacity="0.7"/>';
          h+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+(isBall?'white':color)+'" stroke="'+color+'" stroke-width="'+(isBall?(cs>=12?1.6:1.2):0)+'" opacity="0.92"/>';
          h+='<text x="'+cx+'" y="'+(cy+mkFnt*0.36)+'" text-anchor="middle" font-size="'+mkFnt+'" font-weight="900" fill="'+(isBall?color:'white')+'">'+p.seq+'</text>';
        });
      });
      h+='</svg>';
      return h;
    }
    function atBatResultLabel(result) {
      if (['ボール','ウエスト'].includes(result)) return { text:'BB/HBP', color:'#64748b' };
      if (result === '三振' || result === '振り逃げ') return { text:'三振', color:'#ef4444' };
      if (['安','塁打','本塁打'].some(function(w){return String(result).indexOf(w)>=0;})) return { text:result, color:'#1d4ed8' };
      return { text:result || '-', color:'#475569' };
    }
    function countDistHtml(counts, title) {
      // 球種名(「ストレート」「スライダー」)が「ストレー/ト」「スライダ/ー」と割れないよう、
      // 列は球種名がそのまま入る幅を最低限確保する(8px×5文字 + 内側の余白)。
      var h='<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:7px;padding:5px 4px;flex:1 1 auto;"><div style="font-size:10px;font-weight:bold;text-align:center;margin-bottom:5px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;">'+esc(title)+'</div>';
      h+='<div style="display:flex;gap:3px;">';
      ['ahead','even','behind'].forEach(function(cs){
        var label=cs==='ahead'?'有利':cs==='even'?'平行':'不利';
        var d=counts[cs]||{total:0,strikes:0,types:{}};
        var sPct=d.total>0?Math.round((d.strikes/d.total)*100):0;
        h+='<div style="flex:1 1 auto;min-width:48px;background:#ffffff;padding:4px 2px;border-radius:5px;border:1px solid #e2e8f0;"><div style="font-size:9px;font-weight:bold;text-align:center;margin-bottom:4px;line-height:1.3;">'+label+'<br>S:'+sPct+'%</div>';
        if(d.total>0){
            Object.entries(d.types).sort(function(a,b){return b[1]-a[1];}).forEach(function(e){
                var pct=Math.round((e[1]/d.total)*100);
                h+='<div style="margin:2px 0;font-size:8px;"><div class="nw" style="color:#334155;line-height:1.3;">'+esc(e[0])+'</div><div style="display:flex;align-items:center;gap:2px;"><div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;"><div style="width:'+pct+'%;height:100%;background:#3b82f6;border-radius:2px;"></div></div><span style="flex-shrink:0;font-size:7px;color:#475569;">'+pct+'%</span></div></div>';
            });
        }else{h+='<div style="text-align:center;font-size:9px;color:#94a3b8;">-</div>';}
        h+='</div>';
      });
      h+='</div></div>'; return h;
    }
    function pitcherDetails(pitching, teamName) {
      var h='';
      pitching.pitchers.forEach(function(p, idx){
        // 各チームの投手詳細の先頭はページ頭から始める
        h+='<section class="report-section pitcher-section page-break">';
        h+='<div style="font-size:11px;font-weight:bold;color:#64748b;margin-bottom:4px;break-after:avoid;page-break-after:avoid;">投手詳細: '+jp(teamName)+'</div>';
        h+='<div style="font-size:19px;font-weight:bold;margin-bottom:8px;border-bottom:2px solid #f1f5f9;padding-bottom:6px;break-after:avoid;page-break-after:avoid;">'+nw(p.name)+' <span style="font-size:13px;color:#64748b;font-weight:normal;">('+p.total+'球)</span></div>';
        h+='<div style="display:flex;gap:8px;margin-bottom:8px;break-inside:avoid;page-break-inside:avoid;">';
        h+='<div style="flex:1;background:#f8fafc;padding:6px 10px;border-radius:7px;text-align:center;"><div style="font-size:10px;color:#64748b;">CSW%</div><div style="font-size:22px;font-weight:bold;color:#d97706;">'+p.csw+'%</div></div>';
        h+='<div style="flex:1;background:#f8fafc;padding:6px 10px;border-radius:7px;text-align:center;"><div style="font-size:10px;color:#64748b;">Whiff%</div><div style="font-size:22px;font-weight:bold;color:#ef4444;">'+p.whiff+'%</div></div>';
        h+='<div style="flex:1;background:#f8fafc;padding:6px 10px;border-radius:7px;text-align:center;"><div style="font-size:10px;color:#64748b;">初球S率</div><div style="font-size:22px;font-weight:bold;color:#0ea5e9;">'+p.fStrikePct+'%</div></div>';
        h+='</div>';
        // スプリット表 + カウント別配球を横並び
        h+='<div style="display:flex;gap:8px;margin-bottom:8px;break-inside:avoid;page-break-inside:avoid;">';
        // スプリット表(左)は中身が縦積みにならない幅を確保し、残りをカウント別配球(右)に回す
        h+='<div style="flex:0 1 auto;min-width:0;">';
        function splitRow(label, sp, bg) {
          return '<tr style="background:'+bg+';border-bottom:1px solid #e2e8f0;">'
            +'<td class="nw" style="padding:4px 6px;font-weight:bold;font-size:10px;">'+esc(label)+'</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;">'+sp.PA+'</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;">'+sp.total+'</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;color:#0ea5e9;font-weight:bold;">'+sp.sPct+'%</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;color:#0369a1;font-weight:bold;">'+sp.AVG+'</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;color:#ef4444;font-weight:bold;">'+sp.KPct+'%</td>'
            +'<td style="padding:4px 6px;text-align:right;font-size:10px;color:#10b981;font-weight:bold;">'+sp.BBPct+'%</td>'
            +'</tr>';
        }
        var splitTh='<tr style="background:#f1f5f9;color:#475569;border-bottom:1px solid #cbd5e1;">'
          +'<th style="padding:4px 6px;text-align:left;font-size:10px;"></th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">打席</th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">投球</th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">S%</th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">被打率</th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">K%</th>'
          +'<th class="nw" style="padding:4px 6px;text-align:right;font-size:10px;">BB%</th>'
          +'</tr>';
        h+='<div style="font-size:11px;font-weight:bold;margin-bottom:4px;color:#475569;">スプリット</div>';
        h+='<table style="width:auto;border-collapse:collapse;border:1px solid #e2e8f0;"><thead>'+splitTh+'</thead><tbody>';
        h+=splitRow('対右', p.sideStats.right, '#fff');
        h+=splitRow('対左', p.sideStats.left, '#f8fafc');
        h+=splitRow('上位1-5', p.orderStats.top, '#fff');
        h+=splitRow('下位6-9', p.orderStats.bottom, '#f8fafc');
        h+='</tbody></table></div>';
        // カウント別配球(右)
        h+='<div style="flex:1 1 auto;min-width:0;">';
        h+='<div style="font-size:11px;font-weight:bold;margin-bottom:4px;color:#475569;">カウント別配球</div>';
        h+='<div style="display:flex;gap:6px;">';
        h+=countDistHtml(p.counts.vsRight, '対右');
        h+=countDistHtml(p.counts.vsLeft, '対左');
        h+='</div></div>';
        h+='</div>';
        // 球種別ヒートマップ（マトリクス: 行=球種, 列=カウント）
        h+='<div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#475569;">球種別ヒートマップ</div>';
        var sortedTypedHm = Object.entries(p.pitchTypeHeatmaps||{}).sort(function(a,b){var ta=0,tb=0;Object.values(a[1].all||{}).forEach(function(v){ta+=v;});Object.values(b[1].all||{}).forEach(function(v){tb+=v;});return tb-ta;}).filter(function(e){var cnt=0;Object.values(e[1].all||{}).forEach(function(v){cnt+=v;});return cnt>0;});
        if(sortedTypedHm.length > 0) {
          var hmSz=92;
          var hmCols=['all','ahead','even','behind'];
          var hmColLabels=['全体','有利','平行','不利'];
          // 表全体を1ページに収めようとすると大きな余白ができるため、行単位で分割できるようにする
          h+='<table style="border-collapse:collapse;width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;break-inside:auto;page-break-inside:auto;">';
          h+='<thead><tr style="background:#f1f5f9;border-bottom:1px solid #e2e8f0;">';
          h+='<th style="padding:5px 8px;font-size:9px;font-weight:bold;color:#94a3b8;text-align:left;min-width:72px;"></th>';
          hmColLabels.forEach(function(lbl){h+='<th style="padding:5px 8px;font-size:10px;font-weight:bold;color:#475569;text-align:center;">'+lbl+'</th>';});
          h+='</tr></thead><tbody>';
          sortedTypedHm.forEach(function(e,ei){
            var tn=e[0], th=e[1];
            var isFB=tn.indexOf('ストレート')>=0||tn.indexOf('シュート')>=0;
            var clr=isFB?'red':'indigo';
            var clrHex=clr==='red'?'#ef4444':'#8b5cf6';
            var cnt=0; Object.values(th.all||{}).forEach(function(v){cnt+=v;});
            var rowBg=ei%2===0?'#ffffff':'#f9fafb';
            h+='<tr style="background:'+rowBg+';border-top:1px solid #f1f5f9;">';
            h+='<td style="padding:6px 8px;font-size:10px;font-weight:bold;color:'+clrHex+';vertical-align:middle;white-space:nowrap;border-right:1px solid #e2e8f0;">'+esc(tn)+'<br><span style="font-size:8px;color:#94a3b8;font-weight:normal;">'+cnt+'球</span></td>';
            hmCols.forEach(function(ck){
              var hmData=th[ck]||{};
              var hmMax=th.max?th.max[ck]||0:0;
              h+='<td style="padding:4px;text-align:center;vertical-align:middle;">';
              h+=heatmapSvg(hmData,hmMax,clr,'',hmSz);
              h+='</td>';
            });
            h+='</tr>';
          });
          h+='</tbody></table>';
        }
        h+='</section>';
      });
      return h;
    }
    function analystHtml(a){
      if(!a || !a.hasData) return '';
      var PTC={'ストレート':'#ef4444','スライダー':'#3b82f6','シュート':'#10b981','カーブ':'#f59e0b','落ちる球':'#6366f1','シンカー':'#06b6d4'};
      function pf(v){return v==null?'–':v+'%';}
      function mixTxt(mix){
        if(!mix||!mix.items.length) return '<span style="color:#94a3b8;">データなし</span>';
        return mix.items.map(function(it){return '<span class="nw" style="display:inline-block;margin:1px 4px 1px 0;padding:1px 6px;border-radius:999px;background:'+(PTC[it.type]||'#94a3b8')+';color:#fff;font-size:9px;">'+esc(it.type)+' '+it.pct+'%</span>';}).join('');
      }
      function statTable(rows){
        var h='<table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:6px;"><tbody>';
        rows.forEach(function(r){h+='<tr style="border-bottom:1px solid #eef2f7;"><td class="nw" style="padding:3px 6px;color:#475569;font-weight:bold;background:#f8fafc;width:38%;">'+r[0]+'</td><td style="padding:3px 6px;text-align:right;font-weight:bold;color:#1e293b;width:14%;">'+pf(r[1])+'</td><td style="padding:3px 6px;color:#94a3b8;font-size:9px;">'+r[2]+'</td></tr>';});
        h+='</tbody></table>';return h;
      }
      function segTxt(label,segs,total){
        if(!total) return '<div style="font-size:10px;margin:2px 0;color:#94a3b8;">'+label+': データなし</div>';
        // 「ゴロ 53.3%」のような項目が途中で改行されないよう、項目ごとに折り返しを禁止する
        var parts=segs.map(function(s){var p=total>0?Math.round(s.v/total*1000)/10:0;return '<span style="color:'+s.c+';font-weight:bold;white-space:nowrap;">'+s.label+' '+p+'%</span>';}).join('<span style="color:#cbd5e1;">/</span>');
        // 折り返しても項目が縦に揃うようにflexで並べる
        return '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;font-size:10px;margin:4px 0;line-height:1.5;">'
          +'<span style="color:#475569;font-weight:bold;white-space:nowrap;">'+label+':</span>'
          +'<span style="display:flex;flex-wrap:wrap;gap:2px 5px;align-items:baseline;">'+parts+'<span style="color:#94a3b8;white-space:nowrap;">(n='+total+')</span></span></div>';
      }
      function perTypeTable(perType){
        if(!perType||!perType.items.length) return '<span style="color:#94a3b8;font-size:10px;">データなし</span>';
        var h='<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f1f5f9;color:#475569;border-bottom:1px solid #cbd5e1;">'
          +'<th class="nw" style="padding:3px 6px;text-align:left;">球種</th><th class="nw" style="padding:3px 6px;text-align:right;">球数</th><th class="nw" style="padding:3px 6px;text-align:right;">割合</th><th class="nw" style="padding:3px 6px;text-align:right;">CSW%</th><th class="nw" style="padding:3px 6px;text-align:right;">空振り率</th><th class="nw" style="padding:3px 6px;text-align:right;">Zone%</th></tr></thead><tbody>';
        perType.items.forEach(function(it,i){
          var faint=it.count<8?'color:#94a3b8;':'';
          h+='<tr style="border-bottom:1px solid #eef2f7;background:'+(i%2?'#f8fafc':'#fff')+';'+faint+'">'
            +'<td class="nw" style="padding:3px 6px;font-weight:bold;"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:'+(PTC[it.type]||'#94a3b8')+';margin-right:3px;"></span>'+esc(it.type)+'</td>'
            +'<td style="padding:3px 6px;text-align:right;">'+it.count+'</td>'
            +'<td style="padding:3px 6px;text-align:right;">'+pf(it.usagePct)+'</td>'
            +'<td style="padding:3px 6px;text-align:right;font-weight:bold;color:#d97706;">'+pf(it.cswPct)+'</td>'
            +'<td style="padding:3px 6px;text-align:right;font-weight:bold;color:#ef4444;">'+pf(it.whiffPct)+'</td>'
            +'<td style="padding:3px 6px;text-align:right;">'+pf(it.zonePct)+'</td></tr>';
        });
        h+='</tbody></table><div style="font-size:8px;color:#94a3b8;margin-top:2px;">空振り率＝スイングに対する空振り。灰色は8球未満(参考値)。</div>';
        return h;
      }
      function situTable(tm){
        var bN=tm.batting.situational.none.pd, bR=tm.batting.situational.risp.pd;
        var pN=tm.pitching.situational.none.pd, pR=tm.pitching.situational.risp.pd;
        function tbl(title,color,n,r,rows){
          var h='<div style="flex:1;min-width:220px;"><div style="font-size:10px;font-weight:bold;color:'+color+';margin-bottom:3px;">'+title+'</div>';
          h+='<table style="width:100%;border-collapse:collapse;font-size:10px;"><thead><tr style="background:#f1f5f9;color:#94a3b8;"><th style="padding:2px 6px;text-align:left;"></th><th style="padding:2px 6px;text-align:right;white-space:nowrap;">走者なし('+n.pitches+')</th><th style="padding:2px 6px;text-align:right;white-space:nowrap;">得点圏('+r.pitches+')</th></tr></thead><tbody>';
          rows.forEach(function(rw){h+='<tr style="border-bottom:1px solid #eef2f7;"><td class="nw" style="padding:2px 6px;font-weight:bold;color:#475569;background:#f8fafc;">'+rw[0]+'</td><td style="padding:2px 6px;text-align:right;">'+pf(rw[1])+'</td><td style="padding:2px 6px;text-align:right;font-weight:bold;color:#1e293b;">'+pf(rw[2])+'</td></tr>';});
          h+='</tbody></table></div>';return h;
        }
        var h='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">';
        h+=tbl('打撃：走者なし vs 得点圏','#2563eb',bN,bR,[['Chase%',bN.chasePct,bR.chasePct],['Contact%',bN.contactPct,bR.contactPct],['空振り率',bN.swStrPct,bR.swStrPct]]);
        h+=tbl('投手：走者なし vs 得点圏','#e11d48',pN,pR,[['Zone%',pN.zonePct,pR.zonePct],['CSW%',pN.cswPct,pR.cswPct],['誘い率',pN.chasePct,pR.chasePct]]);
        h+='</div>';return h;
      }
      function teamBlock(tm, note){
        var bp=tm.batting.pd, pp=tm.pitching.pd, bb=tm.batting.battedBall;
        var h='<section class="report-section page-break"><div class="report-heading" style="font-size:15px;font-weight:bold;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:3px;margin-bottom:8px;">アナリスト指標: '+jp(tm.name)+'</div>'+(note||'');
        h+='<div style="display:flex;gap:14px;flex-wrap:wrap;">';
        h+='<div style="flex:1;min-width:240px;"><div style="font-size:11px;font-weight:bold;color:#2563eb;margin-bottom:3px;">打撃アプローチ（選球眼）</div>';
        h+=statTable([['Swing%',bp.swingPct,'全投球を振った率'],['Chase%',bp.chasePct,'ボール球を振った率'],['Z-Swing%',bp.zSwingPct,'ゾーンを振った率'],['Contact%',bp.contactPct,'スイング時コンタクト'],['空振り率',bp.swStrPct,'全投球の空振り']]);
        h+=segTxt('打球性質',[{label:'ゴロ',v:bb.flight.gb,c:'#d97706'},{label:'ライナー/安',v:bb.flight.ld,c:'#2563eb'},{label:'フライ',v:bb.flight.fb,c:'#059669'},{label:'本塁打',v:bb.flight.hr,c:'#db2777'}],bb.bip);
        h+=segTxt('打球方向',[{label:'引っ張り',v:bb.dir.pull,c:'#dc2626'},{label:'センター',v:bb.dir.center,c:'#475569'},{label:'流し',v:bb.dir.oppo,c:'#16a34a'}],bb.dir.known);
        h+='</div>';
        h+='<div style="flex:1;min-width:240px;"><div style="font-size:11px;font-weight:bold;color:#e11d48;margin-bottom:3px;">投手陣（制球・支配力） 総'+tm.pitching.pitches+'球</div>';
        h+=statTable([['Zone%',pp.zonePct,'ゾーン投球率'],['初球S%',pp.fpStrikePct,'初球ストライク率'],['CSW%',pp.cswPct,'見逃し+空振り'],['奪空振り率',pp.swStrPct,'空振り奪取率'],['誘い率',pp.chasePct,'ボール球誘発'],['被Contact%',pp.contactPct,'被コンタクト率']]);
        h+='<div style="font-size:10px;margin:3px 0;"><span style="color:#475569;font-weight:bold;">球種構成:</span><br>'+mixTxt(tm.pitching.mix)+'</div>';
        h+='<div style="font-size:10px;margin:3px 0;"><span style="color:#475569;font-weight:bold;">決め球(2S):</span><br>'+mixTxt(tm.pitching.twoStrike)+'</div>';
        h+='</div></div>';
        h+='<div style="margin-top:8px;"><div style="font-size:11px;font-weight:bold;color:#475569;margin-bottom:3px;">球種別の有効性</div>'+perTypeTable(tm.pitching.perType)+'</div>';
        h+='<div style="margin-top:8px;"><div style="font-size:11px;font-weight:bold;color:#475569;margin-bottom:3px;">状況別（走者なし vs 得点圏）</div>'+situTable(tm)+'</div>';
        h+='</section>';
        return h;
      }
      // 指標の見方は独立した見出しにせず、最初のチームのページに注記として添える
      // (1行の長文は改行位置が乱れるため、項目ごとに行を分ける)
      var guide='<div style="font-size:10px;color:#64748b;margin-bottom:8px;line-height:1.7;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;">'
        +'<div style="font-weight:bold;color:#475569;">指標の見方</div>'
        +'<div>記録した球種・コース・結果・カウント・投打の左右・打球方向から算出。</div>'
        +'<div><b>算出可:</b> <span style="white-space:nowrap;">選球眼(Swing/Chase/Contact/空振り)</span>、<span style="white-space:nowrap;">制球・支配力(Zone/初球S/CSW/誘い率)</span>、<span style="white-space:nowrap;">配球(球種構成・決め球)</span>、打球プロファイル。</div>'
        +'<div><b>算出不可(要トラッキング):</b> 球速・回転数・打球初速・打球角度・<span style="white-space:nowrap;">守備/走力指標</span>。</div>'
        +'</div>';
      return teamBlock(a.top, guide)+teamBlock(a.bottom, '');
    }
    var t=stats;
    var scoreBoardH='<table style="width:100%;border-collapse:collapse;text-align:center;font-size:12px;margin-bottom:6px;border:1px solid #cbd5e1;"><thead><tr style="background:#1e293b;color:#fff;"><th style="padding:4px 8px;text-align:left;">TEAM</th>';
    for(var i=1;i<=9;i++) scoreBoardH+='<th style="padding:3px;width:24px;">'+i+'</th>';
    scoreBoardH+='<th style="padding:4px 8px;width:36px;">R</th><th style="padding:4px 8px;width:36px;">H</th><th style="padding:4px 8px;width:36px;">E</th></tr></thead>';
    scoreBoardH+='<tbody><tr style="border-bottom:1px solid #e2e8f0;"><td class="nw" style="padding:3px 8px;text-align:left;font-weight:bold;">'+esc(gi.teamTop)+'</td>';
    for(var i=0;i<9;i++) scoreBoardH+='<td style="padding:3px 8px;">'+(gs.runs.top[i]>0?gs.runs.top[i]:(gs.inning>i+1||(gs.inning===i+1&&!gs.isTop)?'0':''))+'</td>';
    scoreBoardH+='<td style="padding:3px 8px;font-weight:bold;background:#f0f9ff;color:#0369a1;">'+topTotal+'</td><td style="padding:3px 8px;">'+hAndE.top.hits+'</td><td style="padding:3px 8px;">'+hAndE.top.errors+'</td></tr>';
    scoreBoardH+='<tr><td class="nw" style="padding:3px 8px;text-align:left;font-weight:bold;">'+esc(gi.teamBottom)+'</td>';
    for(var i=0;i<9;i++) scoreBoardH+='<td style="padding:3px 8px;">'+(gs.runs.bottom[i]>0?gs.runs.bottom[i]:(gs.inning>i+1?'0':''))+'</td>';
    scoreBoardH+='<td style="padding:3px 8px;font-weight:bold;background:#f0f9ff;color:#0369a1;">'+bottomTotal+'</td><td style="padding:3px 8px;">'+hAndE.bottom.hits+'</td><td style="padding:3px 8px;">'+hAndE.bottom.errors+'</td></tr>';
    scoreBoardH+='</tbody></table>';
    var summaryH='<h3 style="margin:6px 0 3px;font-size:14px;font-weight:bold;">チーム比較</h3><table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px;"><tbody>';
    summaryH+='<tr style="background:#f1f5f9;"><td style="width:46px;"></td><td class="jp" style="padding:3px 4px;text-align:center;font-weight:bold;">'+esc(gi.teamTop)+'</td><td class="jp" style="padding:3px 4px;text-align:center;font-weight:bold;">'+esc(gi.teamBottom)+'</td></tr>';
    function sRow(l,a,b){return '<tr style="border-bottom:1px solid #e2e8f0;"><td class="nw" style="padding:3px 8px;font-weight:bold;background:#f8fafc;">'+l+'</td><td style="padding:3px 8px;text-align:center;">'+a+'</td><td style="padding:3px 8px;text-align:center;">'+b+'</td></tr>';}
    summaryH+=sRow('打率',t.topBatting.team.AVG,t.bottomBatting.team.AVG);
    summaryH+=sRow('OPS',t.topBatting.team.OPS,t.bottomBatting.team.OPS);
    summaryH+=sRow('K%',t.topBatting.team.KPct+'%',t.bottomBatting.team.KPct+'%');
    summaryH+=sRow('BB%',t.topBatting.team.BBPct+'%',t.bottomBatting.team.BBPct+'%');
    summaryH+='</tbody></table>';
    // チーム比較とチーム打球方向を横並びにして1ページ目を圧縮
    var summarySprayH='<div class="bif" style="display:flex;gap:14px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;">'
      +'<div style="flex:1;min-width:220px;">'+summaryH+'</div>'
      +'<div style="flex:1;min-width:280px;"><h3 style="margin:6px 0 3px;font-size:14px;font-weight:bold;">チーム打球方向</h3><div style="display:flex;gap:8px;flex-wrap:nowrap;justify-content:center;">'
      +sprayChartSvg(t.topBatting.team.sprayHits,gi.teamTop,135)
      +sprayChartSvg(t.bottomBatting.team.sprayHits,gi.teamBottom,135)
      +'</div></div></div>';
    function playByPlayHtml(pbp){
      if(!pbp || !pbp.length) return '';
      // flexの大箱はChrome印刷でページ分割されず丸ごと次ページへ飛ぶため、
      // イニング毎の「行」に分けて行単位でのみ分割禁止にする。
      function innBlock(inn){
        var b='<div style="font-size:11px;font-weight:bold;color:#fff;background:'+(inn.isTop?'#1d4ed8':'#e11d48')+';padding:3px 8px;border-radius:6px 6px 0 0;">'
          +nw(inn.inning+'回'+(inn.isTop?'表':'裏'))+' '+jp((inn.isTop?gi.teamTop:gi.teamBottom)+'の攻撃')+'</div>';
        b+='<table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #e2e8f0;border-top:none;">';
        inn.atBats.forEach(function(ab,i){
          var res=String(ab.result||'');
          var isHit=['安','塁打','本塁打'].some(function(w){return res.indexOf(w)>=0;});
          var isBB=['四球','死球'].some(function(w){return res.indexOf(w)>=0;});
          var color=isHit?'#1d4ed8':isBB?'#059669':'#334155';
          // 走者の記録・選手交代は1件ずつが意味のまとまり。打席結果の後ろに続けて流すと
          // 「1塁走者 / 盗塁で2塁へ」のようにまとまりの途中で折り返されるため、
          // 1件を必ず1行として並べる(スラッシュで併記された交代も1件として分ける)。
          var ev='';
          if (ab.events && ab.events.length) {
            var lines=[];
            ab.events.forEach(function(e){
              String(e).split(' / ').forEach(function(part){
                var t=part.trim(); if(t) lines.push(t);
              });
            });
            ev=lines.map(function(t){
              return '<div class="pbp-ev"><span class="pbp-mark">・</span>'+recordLineHtml(t)+'</div>';
            }).join('');
          }
          b+='<tr style="background:'+(i%2?'#f8fafc':'#fff')+';border-bottom:1px solid #f1f5f9;">'
            +'<td style="padding:3px 5px;color:#94a3b8;text-align:right;width:16px;vertical-align:top;">'+ab.batter+'</td>'
            +'<td style="padding:3px 5px;font-weight:bold;white-space:nowrap;vertical-align:top;">'+esc(ab.batterName||'')+'</td>'
            +'<td style="padding:3px 5px;color:#64748b;text-align:right;width:30px;white-space:nowrap;vertical-align:top;">'+ab.pitchCount+'球</td>'
            +'<td style="padding:3px 5px;vertical-align:top;">'
              +'<div class="jp" style="font-weight:bold;color:'+color+';">'+jp(res||'-')+'</div>'+ev
            +'</td>'
            +'</tr>';
        });
        b+='</table>';
        return b;
      }
      // イニング毎に1行: 左=表、右=裏。片方しかない場合は空欄。
      var byInning = {};
      pbp.forEach(function(inn){
        if (!byInning[inn.inning]) byInning[inn.inning] = {};
        byInning[inn.inning][inn.isTop ? 'top' : 'bottom'] = inn;
      });
      var innNums = Object.keys(byInning).map(Number).sort(function(a,b){return a-b;});
      // テキスト速報は表紙(スコア・チーム比較)の続きに流す(改ページしない)
      var h='<section class="report-section"><h3 class="report-heading" style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:3px;">テキスト速報</h3>';
      // イニングの行もflexではなく表の行にする(打者詳細のカードと同じ理由:
      // 印刷時の分割禁止が確実に効くのは tr のため)。
      h+='<table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0 3px;">';
      innNums.forEach(function(n){
        var pair = byInning[n];
        h+='<tr class="pbr">'
          +'<td style="width:50%;vertical-align:top;padding-right:4px;">'+(pair.top ? innBlock(pair.top) : '')+'</td>'
          +'<td style="width:50%;vertical-align:top;padding-left:4px;">'+(pair.bottom ? innBlock(pair.bottom) : '')+'</td>'
          +'</tr>';
      });
      h+='</table></section>';
      return h;
    }
    function narrativeHtml(a){
      if(!a || !a.hasData) return '';
      function teamCard(tm,accent){
        var items=tm.summary||[];
        var h='<div style="flex:1;min-width:230px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:5px 8px;">';
        h+='<div style="font-size:11px;font-weight:bold;color:'+accent+';margin-bottom:2px;">'+jp(tm.name)+'</div>';
        if(items.length===0){h+='<div style="font-size:9px;color:#94a3b8;">データが少なく要点を抽出できません</div>';}
        else{h+='<ul style="margin:0;padding-left:15px;font-size:9.5px;color:#334155;line-height:1.65;">';items.slice(0,4).forEach(function(s){h+='<li style="margin-bottom:1px;">'+esc(s)+'</li>';});h+='</ul>';}
        h+='</div>';return h;
      }
      var h='<div style="margin:0 0 8px;break-inside:avoid;page-break-inside:avoid;"><div style="font-size:13px;font-weight:bold;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:3px;margin-bottom:5px;">📝 講評サマリー</div>';
      h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+teamCard(a.top,'#2563eb')+teamCard(a.bottom,'#e11d48')+'</div></div>';
      return h;
    }
    var body='<div style="max-width:900px;margin:0 auto;padding:12px 24px;font-family:sans-serif;">';
    body+='<h1 style="font-size:18px;font-weight:bold;margin:0 0 2px;">試合分析レポート</h1><div style="color:#64748b;margin-bottom:5px;font-size:11px;">'+esc(gi.date)+' / 総投球数: '+ps.filter(function(p){return !p.isEvent||p.countAsPitch;}).length+'球</div>';
    body+=narrativeHtml(analyst)+scoreBoardH+summarySprayH;
    body+=playByPlayHtml(data.playByPlay);
    body+=batterTable(t.topBatting,gi.teamTop);
    body+=batterDetails(t.topBatting,gi.teamTop);
    body+=batterTable(t.bottomBatting,gi.teamBottom);
    body+=batterDetails(t.bottomBatting,gi.teamBottom);
    body+=pitcherDetails(t.pitchingTop,gi.teamTop);
    if(t.pitchingBottom.pitchers.length>0){
      body+=pitcherDetails(t.pitchingBottom,gi.teamBottom);
    }
    body+=analystHtml(analyst);
    body+='</div>';
    var reportFileName = [gi.date, gi.teamTop, 'vs', gi.teamBottom].join('_').replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    var closeBtn='<div class="no-print" style="position:fixed;top:12px;right:16px;z-index:999;display:flex;gap:8px;">'
      +'<button onclick="window.print()" style="background:#1e293b;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ 印刷 / PDF</button>'
      +'<button onclick="window.close()" style="background:#e2e8f0;color:#334155;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">✕ 閉じる</button>'
      +'</div>';
    // セクション毎の強制改ページはページ数が膨らむため廃止し、
    // カード単位の break-inside:avoid で自然に流し込む。
    // 日本語の改行位置(句読点・小書き仮名の行頭禁則)を効かせ、単語の途中で切れないようにする
    var css='@page{margin:10mm 10mm;}'
      +'body{margin:0;background:#f1f5f9;line-break:strict;word-break:normal;overflow-wrap:break-word;text-align:left;}'
      +'p,li,td,th,div,span{orphans:2;widows:2;}'
      // .nw=折り返し禁止 / .jp=語中では折らず、収まらないときだけ折る(1文字だけ次行に残す不格好な改行を防ぐ)
      +'.nw{white-space:nowrap;}'
      +'.jp{word-break:keep-all;overflow-wrap:break-word;line-break:strict;}'
      // 記録文は1件1行。行に収まらないときは「・」の右に折り返しを揃える(ぶら下げインデント)
      +'.pbp-ev{font-size:9px;font-weight:normal;color:#d97706;line-height:1.5;padding-left:9px;text-indent:-9px;margin-top:1px;}'
      +'.pbp-mark{color:#fbbf24;}'
      +'.report-section{margin:0 0 12px;}'
      +'.report-heading{break-after:avoid;page-break-after:avoid;}'
      +'@media print{body{background:#fff !important;}'
      +'*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}'
      +'.report-section{break-inside:auto;page-break-inside:auto;padding-top:0;}'
      +'.page-break{break-before:page;page-break-before:always;}'
      +'.report-heading{break-after:avoid;page-break-after:avoid;orphans:3;widows:3;}'
      // .bdr=打者詳細カードの行 / .pbr=テキスト速報のイニングの行(どちらもページで割らない)
      +'.bdr,.pbr,.bdc,.abc,.bif,.pitcher-section table,.pitcher-section [style*="display:flex"]{break-inside:avoid;page-break-inside:avoid;}'
      +'.no-print{display:none !important;}}'
      +'table{page-break-inside:auto;}tr{page-break-inside:avoid;}'
      +'h1,h3{break-after:avoid;page-break-after:avoid;}';
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+esc(reportFileName)+'<\/title><style>'+css+'<\/style><\/head><body>'+closeBtn+body+'<\/body><\/html>');
    w.document.close();
    setTimeout(function(){w.print();},800);
    return true;
  };
  } catch(e) { console.error('Pre-script error:', e); }
