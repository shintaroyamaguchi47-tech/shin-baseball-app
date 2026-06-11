    // ============================================================
    // アナリスト指標の算出（収集データの範囲で算出可能な指標のみ）
    // MLB/NPBのアナリストが重視する指標のうち、本アプリが記録している
    // 「球種・コース・結果・カウント・投打の左右・打球方向」から
    // 計算できるものだけを算出する。球速/回転数/打球初速などの
    // トラッキング系指標はデータ未収集のため対象外。
    // ============================================================
    function buildAnalystInsights(pwcs, lineups, gameInfo) {
      const inZone = (c) => { if (c === null || c === undefined) return false; const row = Math.floor(c / 7), col = c % 7; return row >= 2 && row <= 4 && col >= 2 && col <= 4; };
      const isReal = (p) => p && !p.isEvent && !(p.result && (p.result.startsWith('牽制') || ['盗塁死', 'その他出塁'].includes(p.result)));
      const WHIFF = (r) => r.includes('空振り');
      const CALLED = (r) => r === 'ストライク' || r.includes('見逃し');
      const CONTACT = (r) => ['ファウル', 'バントファウル', 'スリーバント失敗', 'インプレー', 'バント', 'ゴロ', '飛', '安', '塁打', '二塁打', '三塁打', '本塁打', 'エラー', '犠', '直', '野手選択', '併殺'].some(w => r.includes(w));
      const ISSTRIKE = (r) => !['ボール', 'ウエスト', '死球'].includes(r);
      const cleanType = (t) => t ? t.replace(/系$/, '') : '不明';
      const pct1 = (n, d) => d > 0 ? Math.round((n / d) * 1000) / 10 : null;

      // 各投球に「その時点でのストライク数(_sb)」を付与（決め球＝2ストライク時の判定用）
      let curKey = null, b = 0, s = 0;
      const enr = [];
      pwcs.forEach(p => {
        if (!isReal(p)) return;
        const key = `${p.inning}-${p.isTop}-${p.batter}`;
        if (key !== curKey) { curKey = key; b = 0; s = 0; }
        enr.push({ ...p, _sb: s });
        if (['ボール', 'ウエスト'].includes(p.result)) b++;
        else if (['ストライク', '空振り', 'バント空振り'].includes(p.result)) s++;
        else if (['ファウル', 'バントファウル'].includes(p.result) && s < 2) s++;
      });

      // プレートディシプリン（選球眼・制球）の集計
      const pdAgg = (list) => {
        let total = 0, withC = 0, zone = 0, swing = 0, whiff = 0, called = 0, contact = 0, zSw = 0, zWhiff = 0, oSw = 0, oContact = 0, firstP = 0, firstS = 0, strikeN = 0;
        list.forEach(p => {
          const r = p.result; total++;
          if (ISSTRIKE(r)) strikeN++;
          const hasC = p.course !== null && p.course !== undefined;
          const z = hasC && inZone(p.course);
          if (hasC) { withC++; if (z) zone++; }
          const w = WHIFF(r), ct = CONTACT(r), sw = w || ct, cl = CALLED(r);
          if (sw) swing++; if (w) whiff++; if (cl) called++; if (ct) contact++;
          if (hasC) {
            if (z) { if (sw) { zSw++; if (w) zWhiff++; } }
            else { if (sw) { oSw++; if (ct) oContact++; } }
          }
          if (p.pitchNumber === 1) { firstP++; if (ISSTRIKE(r)) firstS++; }
        });
        const oZone = withC - zone;
        return {
          pitches: total,
          zonePct: pct1(zone, withC),
          strikePct: pct1(strikeN, total),
          swingPct: pct1(swing, total),
          swStrPct: pct1(whiff, total),
          cswPct: pct1(called + whiff, total),
          contactPct: pct1(contact, swing),
          zSwingPct: pct1(zSw, zone),
          chasePct: pct1(oSw, oZone),
          zContactPct: pct1(zSw - zWhiff, zSw),
          oContactPct: pct1(oContact, oSw),
          fpStrikePct: pct1(firstS, firstP),
        };
      };

      // 球種構成比
      const mixAgg = (list) => {
        const m = {}; let tot = 0;
        list.forEach(p => { const t = cleanType(p.type); if (t === '不明' || t === '-') return; m[t] = (m[t] || 0) + 1; tot++; });
        return { total: tot, items: Object.entries(m).map(([type, count]) => ({ type, count, pct: pct1(count, tot) })).sort((a, b) => b.count - a.count) };
      };

      // 打球方向（守備位置の文字列から左/中/右を判定）
      const fieldSide = (res) => {
        if (/レフト|左翼|サード|ショート|三遊間/.test(res)) return 'L';
        if (/ライト|右翼|ファースト|セカンド|一二間/.test(res)) return 'R';
        if (/センター|中堅|ピッチャー|キャッチャー|二遊間|左中|右中|投/.test(res)) return 'C';
        return null;
      };
      const ballFlight = (res) => res.includes('本塁打') ? 'hr' : ['ゴロ', '併殺', 'バント'].some(w => res.includes(w)) ? 'gb' : ['直', 'ライナー', '安', '二塁打', '三塁打'].some(w => res.includes(w)) ? 'ld' : 'fb';

      // 打球プロファイル（ゴロ/ライナー/フライ/HR ＆ 引っ張り/センター/流し）
      const battedBallAgg = (list) => {
        const abs = []; let cur = [];
        list.forEach(p => { if (p.pitchNumber === 1 && cur.length > 0) { abs.push(cur); cur = []; } cur.push(p); });
        if (cur.length) abs.push(cur);
        const flight = { gb: 0, ld: 0, fb: 0, hr: 0 };
        const dir = { pull: 0, center: 0, oppo: 0, known: 0 };
        let bip = 0;
        abs.forEach(ab => {
          const last = ab[ab.length - 1]; if (!last) return; const res = last.result || '';
          const isHit = ['安', '塁打', '本塁打'].some(w => res.includes(w));
          const inPlay = isHit || ['ゴロ', '飛', '直', 'エラー', 'バント', '併殺', '野手選択'].some(w => res.includes(w));
          if (!inPlay) return;
          bip++;
          flight[ballFlight(res)]++;
          const side = fieldSide(res), hand = last.batterBats;
          if (side && (hand === '右' || hand === '左')) {
            if (side === 'C') { dir.center++; dir.known++; }
            else { const pull = (hand === '右' && side === 'L') || (hand === '左' && side === 'R'); if (pull) dir.pull++; else dir.oppo++; dir.known++; }
          }
        });
        return { bip, flight, dir };
      };

      const buildTeam = (battingIsTop, name) => {
        const batList = enr.filter(p => p.isTop === battingIsTop);   // 自チームが打席に立った投球（被投球）
        const pitchList = enr.filter(p => p.isTop !== battingIsTop);  // 自チームが投げた投球
        const batting = { pitches: batList.length, pd: pdAgg(batList), battedBall: battedBallAgg(batList) };
        const byPitcher = {};
        pitchList.forEach(p => { const n = p.pitcherName || '不明'; (byPitcher[n] = byPitcher[n] || []).push(p); });
        const pitchers = Object.entries(byPitcher).map(([n, list]) => ({
          name: n, throws: (list[0] && list[0].pitcherThrows) || '右',
          pd: pdAgg(list), mix: mixAgg(list), twoStrike: mixAgg(list.filter(p => p._sb >= 2)),
        })).sort((a, b) => b.pd.pitches - a.pd.pitches);
        const pitching = { pitches: pitchList.length, pd: pdAgg(pitchList), mix: mixAgg(pitchList), twoStrike: mixAgg(pitchList.filter(p => p._sb >= 2)), pitchers };
        return { name, batting, pitching };
      };

      return { hasData: enr.length > 0, top: buildTeam(true, gameInfo.teamTop), bottom: buildTeam(false, gameInfo.teamBottom) };
    }

export { buildAnalystInsights };
