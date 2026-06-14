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

      // 球種別の有効性（使用率だけでなく CSW%・空振り率・Zone% を球種ごとに算出）
      const perTypeAgg = (list) => {
        const m = {}; let tot = 0;
        list.forEach(p => {
          const t = cleanType(p.type); if (t === '不明' || t === '-') return;
          const e = m[t] || (m[t] = { type: t, count: 0, swings: 0, whiffs: 0, csw: 0, strikes: 0, zone: 0, withC: 0 });
          const r = p.result; e.count++; tot++;
          const w = WHIFF(r), sw = w || CONTACT(r), cl = CALLED(r);
          if (sw) e.swings++; if (w) e.whiffs++; if (w || cl) e.csw++; if (ISSTRIKE(r)) e.strikes++;
          if (p.course !== null && p.course !== undefined) { e.withC++; if (inZone(p.course)) e.zone++; }
        });
        return {
          total: tot,
          items: Object.values(m).map(e => ({
            type: e.type, count: e.count,
            usagePct: pct1(e.count, tot),
            cswPct: pct1(e.csw, e.count),
            whiffPct: pct1(e.whiffs, e.swings),  // スイングに対する空振り率（Whiff%）
            strikePct: pct1(e.strikes, e.count),
            zonePct: pct1(e.zone, e.withC),
          })).sort((a, b) => b.count - a.count),
        };
      };

      // 走者状況の分類（投球時点の走者から：得点圏=2塁or3塁 / 走者あり=1塁のみ / 走者なし）
      const runnerState = (p) => { const rn = p.runners || {}; return (rn.second || rn.third) ? 'risp' : (rn.first ? 'on' : 'none'); };

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

      // 数値から要点を文章化（PDF/画面の「講評サマリー」用）。サンプル数が少ない指標は言及しない。
      const buildSummary = (team) => {
        const out = []; const p = team.pitching, b = team.batting;
        if (p.pitches >= 15) {
          if (p.pd.cswPct != null && p.pd.cswPct >= 30) out.push(`投手陣はCSW%が${p.pd.cswPct}%と高く支配力がある`);
          else if (p.pd.cswPct != null && p.pd.cswPct < 24) out.push(`投手陣のCSW%は${p.pd.cswPct}%と低めで打たせて取る傾向`);
          if (p.pd.fpStrikePct != null && p.pd.fpStrikePct >= 60) out.push(`初球ストライク率${p.pd.fpStrikePct}%でカウントを先行できている`);
          else if (p.pd.fpStrikePct != null && p.pd.fpStrikePct < 50) out.push(`初球ストライク率${p.pd.fpStrikePct}%と低くボール先行になりがち`);
          const dp = p.twoStrike && p.twoStrike.items[0];
          if (dp) out.push(`2ストライクからの決め球は${dp.type}(${dp.pct}%)が中心`);
          // 球種別の有効性ハイライト（最も空振りを奪える球）
          const wt = (p.perType.items || []).filter(it => it.count >= 8 && it.whiffPct != null).sort((a, c) => c.whiffPct - a.whiffPct)[0];
          if (wt && wt.whiffPct >= 25) out.push(`${wt.type}の空振り率が${wt.whiffPct}%と高く有効`);
        }
        if (b.pd.pitches >= 15) {
          if (b.pd.chasePct != null && b.pd.chasePct >= 30) out.push(`打線はChase%(ボール球スイング)が${b.pd.chasePct}%と高く誘い球に手を出しやすい`);
          else if (b.pd.chasePct != null && b.pd.chasePct <= 20) out.push(`打線はChase%が${b.pd.chasePct}%と低く選球眼が良い`);
          if (b.pd.contactPct != null && b.pd.contactPct >= 85) out.push(`Contact%${b.pd.contactPct}%でバットに当てるのが上手い`);
        }
        // 得点圏での配球変化（崩れる/押し込む）
        const rn = p.situational.risp, no = p.situational.none;
        if (rn.pd.pitches >= 8 && rn.pd.zonePct != null && no.pd.zonePct != null) {
          const d = rn.pd.zonePct - no.pd.zonePct;
          if (d <= -8) out.push(`得点圏ではZone%が${no.pd.zonePct}%→${rn.pd.zonePct}%に低下し慎重(四球リスク)`);
          else if (d >= 8) out.push(`得点圏ではZone%が${no.pd.zonePct}%→${rn.pd.zonePct}%に上昇し押し込む配球`);
        }
        return out;
      };

      const buildTeam = (battingIsTop, name) => {
        const batList = enr.filter(p => p.isTop === battingIsTop);   // 自チームが打席に立った投球（被投球）
        const pitchList = enr.filter(p => p.isTop !== battingIsTop);  // 自チームが投げた投球
        const batRisp = batList.filter(p => runnerState(p) === 'risp'), batNone = batList.filter(p => runnerState(p) === 'none');
        const batting = {
          pitches: batList.length, pd: pdAgg(batList), battedBall: battedBallAgg(batList),
          situational: { none: { pd: pdAgg(batNone) }, risp: { pd: pdAgg(batRisp) } },
        };
        const byPitcher = {};
        pitchList.forEach(p => { const n = p.pitcherName || '不明'; (byPitcher[n] = byPitcher[n] || []).push(p); });
        const pitchers = Object.entries(byPitcher).map(([n, list]) => ({
          name: n, throws: (list[0] && list[0].pitcherThrows) || '右',
          pd: pdAgg(list), mix: mixAgg(list), twoStrike: mixAgg(list.filter(p => p._sb >= 2)), perType: perTypeAgg(list),
        })).sort((a, b) => b.pd.pitches - a.pd.pitches);
        const pitRisp = pitchList.filter(p => runnerState(p) === 'risp'), pitNone = pitchList.filter(p => runnerState(p) === 'none');
        const pitching = {
          pitches: pitchList.length, pd: pdAgg(pitchList), mix: mixAgg(pitchList),
          twoStrike: mixAgg(pitchList.filter(p => p._sb >= 2)), perType: perTypeAgg(pitchList),
          situational: {
            none: { pd: pdAgg(pitNone), mix: mixAgg(pitNone) },
            risp: { pd: pdAgg(pitRisp), mix: mixAgg(pitRisp) },
          },
          pitchers,
        };
        const team = { name, batting, pitching };
        team.summary = buildSummary(team);
        return team;
      };

      return { hasData: enr.length > 0, top: buildTeam(true, gameInfo.teamTop), bottom: buildTeam(false, gameInfo.teamBottom) };
    }

export { buildAnalystInsights };
