import React, { useState, useMemo, useEffect, useCallback } from 'react';
import SprayChart from './components/SprayChart.jsx';
import AnalystReport from './components/AnalystReport.jsx';
import PlayByPlayReport from './components/PlayByPlayReport.jsx';
import { buildAnalystInsights } from './analystInsights.js';
import { buildPlayByPlayReport } from './playByPlay.js';
import * as storage from './storage.js';
import { asPlayerObj, findDuplicateNameIndices, mergeRosterPlayers, renamePlayersInGame, detectLineupRenames } from './teamUtils.js';
import { renumberPitchNumbers, reassignPitchBatter } from './gameUtils.js';
import { insertSubstitution, applySubstitutionToLineup, lineupSnapshotAt, findPitcherAt, buildSubstitutionEventText, dropBenchEntry, STARTING_SLOTS } from './substitutionUtils.js';
import AnalyticsHub from './components/AnalyticsHub.jsx';
import { normalizeArchive } from './analyticsData.js';
import { isScorerGdf, convertScorerGame } from './scorerImport.js';
import { buildScorebookData } from './scorebookData.js';
import { autoPositions, buildAdvanceChoices, buildAdvanceEvents, previewAdvanceResult, isAdjustableEventType, isEarnedAdvanceReason, describeRunners } from './runnerAdvance.js';

    function App() {
      const makeInitialGameState = () => ({ inning: 1, isTop: true, outs: 0, balls: 0, strikes: 0, batterTop: 1, batterBottom: 1, runners: { first: false, second: false, third: false }, runs: { top: [0,0,0,0,0,0,0,0,0], bottom: [0,0,0,0,0,0,0,0,0] }, earnedRuns: { top: [0,0,0,0,0,0,0,0,0], bottom: [0,0,0,0,0,0,0,0,0] } });
      const makeInitialLineups = () => ({
        top: Array.from({length: 10}, (_,i)=>({ order: i<9 ? i+1 : '投', name: i<9 ? `先攻${i+1}番` : `先発投手`, pos: i===9?'投':'未', throws: '右', bats: '右' })),
        bottom: Array.from({length: 10}, (_,i)=>({ order: i<9 ? i+1 : '投', name: i<9 ? `後攻${i+1}番` : `先発投手`, pos: i===9?'投':'未', throws: '右', bats: '右' }))
      });
      const loadStored = (key, fallback) => {
        const saved = storage.getItem(key);
        if (!saved) return fallback;
        try { return JSON.parse(saved); } catch(e) { return fallback; }
      };
      const ensureRunArray = (arr, inning) => {
        const runs = Array.isArray(arr) ? arr.map(v => Number.isFinite(Number(v)) ? Number(v) : 0) : [];
        while (runs.length < Math.max(9, inning)) runs.push(0);
        return runs;
      };
      const normalizeGameState = (state) => {
        const base = makeInitialGameState();
        const merged = { ...base, ...(state || {}) };
        const inning = Math.max(1, merged.inning || 1);
        return {
          ...merged,
          inning,
          runs: {
            top: ensureRunArray(merged.runs?.top, inning),
            bottom: ensureRunArray(merged.runs?.bottom, inning)
          },
          earnedRuns: {
            // 旧データには自責点がないため得点を初期値として移行し、スコア修正画面で訂正できる
            top: ensureRunArray(merged.earnedRuns?.top || merged.runs?.top, inning),
            bottom: ensureRunArray(merged.earnedRuns?.bottom || merged.runs?.bottom, inning)
          },
          runners: { ...base.runners, ...(merged.runners || {}) }
        };
      };
      const advanceGameState = (prev, eventType, addedOuts = 0) => {
        const state = normalizeGameState(prev);
        let newOuts = state.outs + addedOuts, newInning = state.inning, newIsTop = state.isTop, newBatterTop = state.batterTop, newBatterBottom = state.batterBottom;
        let newRunners = { ...state.runners }, newRunsArray = ensureRunArray(state.runs[state.isTop ? 'top' : 'bottom'], newInning), runScored = 0;
        if (newOuts < 3) {
          if (eventType === 'walk' || eventType === 'other') {
            if (newRunners.first && newRunners.second && newRunners.third) runScored = 1; else if (newRunners.first && newRunners.second) newRunners.third = true; else if (newRunners.first) newRunners.second = true; newRunners.first = true;
          } else if (['single', 'error'].includes(eventType)) {
            if (newRunners.third) runScored++; newRunners.third = newRunners.second; newRunners.second = newRunners.first; newRunners.first = true;
          } else if (eventType === 'double') {
            if (newRunners.third) runScored++; if (newRunners.second) runScored++; newRunners.third = newRunners.first; newRunners.second = true; newRunners.first = false;
          } else if (eventType === 'triple') {
            if (newRunners.third) runScored++; if (newRunners.second) runScored++; if (newRunners.first) runScored++; newRunners.third = true; newRunners.second = false; newRunners.first = false;
          } else if (eventType === 'homerun') {
            if (newRunners.third) runScored++; if (newRunners.second) runScored++; if (newRunners.first) runScored++; runScored++; newRunners = { first: false, second: false, third: false };
          } else if (eventType === 'sac_bunt') {
            if (newRunners.third) runScored++; newRunners.third = newRunners.second; newRunners.second = newRunners.first; newRunners.first = false;
          } else if (eventType === 'sac_fly') {
            if (newRunners.third) runScored++; newRunners.third = false;
          }
        }
        if (runScored > 0) newRunsArray[newInning - 1] = (newRunsArray[newInning - 1] || 0) + runScored;
        if (state.isTop) newBatterTop = newBatterTop === 9 ? 1 : newBatterTop + 1; else newBatterBottom = newBatterBottom === 9 ? 1 : newBatterBottom + 1;
        if (newOuts >= 3) { newOuts = 0; newRunners = { first: false, second: false, third: false }; if (state.isTop) newIsTop = false; else { newIsTop = true; newInning++; } }
        const scoringTeam = state.isTop ? 'top' : 'bottom';
        const nextRuns = { ...state.runs, [scoringTeam]: newRunsArray };
        const nextEarnedRuns = { ...state.earnedRuns, top: ensureRunArray(state.earnedRuns?.top, newInning), bottom: ensureRunArray(state.earnedRuns?.bottom, newInning) };
        if (runScored > 0) nextEarnedRuns[scoringTeam][state.inning - 1] = (nextEarnedRuns[scoringTeam][state.inning - 1] || 0) + runScored;
        nextRuns.top = ensureRunArray(nextRuns.top, newInning);
        nextRuns.bottom = ensureRunArray(nextRuns.bottom, newInning);
        return { ...state, outs: newOuts, balls: 0, strikes: 0, batterTop: newBatterTop, batterBottom: newBatterBottom, inning: newInning, isTop: newIsTop, runners: newRunners, runs: nextRuns, earnedRuns: nextEarnedRuns };
      };
      const resultToEventType = (result) => {
        if (result.includes('本塁打')) return 'homerun';
        if (result.includes('三塁打')) return 'triple';
        if (result.includes('二塁打')) return 'double';
        if (result.includes('安')) return 'single';
        if (['エラー','敵失(エラー)','野手選択'].some(w => result.includes(w))) return 'error';
        if (result.includes('犠打')) return 'sac_bunt';
        if (result.includes('犠飛')) return 'sac_fly';
        return 'out';
      };
      // 走者イベント記録(「2塁走者 盗塁で3塁へ」「1塁走者が牽制死」など)1件を試合状況へ反映する。
      // 記録の再構築(rebuildGameStateFromPitches)と、打席直後の進塁補正の両方から使う。
      const applyRunnerEventToState = (prev, resultText) => {
        const state = normalizeGameState(prev);
        const res = resultText || '';
        const runnerKey = res.startsWith('1塁走者') ? 'first' : res.startsWith('2塁走者') ? 'second' : res.startsWith('3塁走者') ? 'third' : null;
        if (!runnerKey) return state;
        if (res.includes('が')) {
          let newOuts = state.outs + 1, newRunners = { ...state.runners, [runnerKey]: false }, newInning = state.inning, newIsTop = state.isTop;
          if (newOuts >= 3) { newOuts = 0; newRunners = { first: false, second: false, third: false }; if (state.isTop) newIsTop = false; else { newIsTop = true; newInning++; } }
          return normalizeGameState({ ...state, outs: newOuts, inning: newInning, isTop: newIsTop, runners: newRunners, balls: 0, strikes: 0 });
        }
        if (res.includes('で')) {
          const newRunners = { ...state.runners, [runnerKey]: false };
          const runs = { ...state.runs };
          const earnedRuns = { ...state.earnedRuns };
          if (res.includes('2塁へ')) newRunners.second = true;
          else if (res.includes('3塁へ')) newRunners.third = true;
          else if (res.includes('本塁へ')) {
            const team = state.isTop ? 'top' : 'bottom';
            const arr = ensureRunArray(runs[team], state.inning); arr[state.inning - 1] = (arr[state.inning - 1] || 0) + 1; runs[team] = arr;
            // 打球・送球間での生還は自責点に数える(盗塁・暴投など従来の理由は据え置き)
            const reason = (res.split(' ')[1] || '').split('で')[0];
            if (isEarnedAdvanceReason(reason)) {
              const er = ensureRunArray(earnedRuns[team], state.inning); er[state.inning - 1] = Math.min(arr[state.inning - 1], (er[state.inning - 1] || 0) + 1); earnedRuns[team] = er;
            }
          }
          return normalizeGameState({ ...state, runners: newRunners, runs, earnedRuns });
        }
        return state;
      };
      const rebuildGameStateFromPitches = (records) => {
        let state = makeInitialGameState();
        let lastAtBatKey = null;
        records.forEach(p => {
          state = normalizeGameState({ ...state, inning: p.inning || state.inning, isTop: p.isTop, ...(p.isTop ? { batterTop: p.batter || state.batterTop } : { batterBottom: p.batter || state.batterBottom }) });
          if (!p.isEvent) {
            // 打順修正などで途中から打者が変わった場合は新しい打席としてカウントをリセットする
            const atBatKey = `${p.inning}-${p.isTop}-${p.batter}`;
            if (lastAtBatKey !== null && atBatKey !== lastAtBatKey) state = { ...state, balls: 0, strikes: 0 };
            lastAtBatKey = atBatKey;
          }
          if (p.isEvent) {
            state = applyRunnerEventToState(state, p.result);
            return;
          }
          const res = p.result || '';
          if (['ボール','ウエスト'].includes(res)) state = state.balls >= 3 ? advanceGameState(state, 'walk', 0) : { ...state, balls: state.balls + 1 };
          else if (res === '死球' || res === 'その他出塁') state = advanceGameState(state, res === 'その他出塁' ? 'other' : 'walk', 0);
          else if (['ストライク','空振り','バント空振り'].includes(res)) state = state.strikes >= 2 ? advanceGameState(state, 'out', 1) : { ...state, strikes: state.strikes + 1 };
          else if (['ファウル','バントファウル'].includes(res)) state = state.strikes < 2 ? { ...state, strikes: state.strikes + 1 } : state;
          else if (res === 'スリーバント失敗' || res === '三振' || res === '振り逃げアウト') state = advanceGameState(state, 'out', 1);
          else if (res === '振り逃げ') state = advanceGameState(state, 'error', 0);
          else if (!res?.startsWith('牽制')) state = advanceGameState(state, resultToEventType(res), resultToEventType(res) === 'out' ? 1 : 0);
        });
        return normalizeGameState(state);
      };
      const [gameState, setGameState] = useState(() => {
        return normalizeGameState(loadStored('baseball_gameState_v2', makeInitialGameState()));
      });
      const [gameInfo, setGameInfo] = useState(() => {
        return loadStored('baseball_gameInfo_v2', { date: new Date().toLocaleDateString('ja-JP').replace(/\//g, '-'), gameType: '練習試合', teamTop: '先攻チーム', teamBottom: '後攻チーム' });
      });
      const [lineups, setLineups] = useState(() => {
        return loadStored('baseball_lineups_v2', makeInitialLineups());
      });
      const [pitches, setPitches] = useState(() => {
        return loadStored('baseball_pitches_v2', []);
      });
      const [undoStack, setUndoStack] = useState([]);
      const [redoStack, setRedoStack] = useState([]);
      const [savedGames, setSavedGames] = useState(() => loadStored('baseball_savedGames_v2', []));
      const [registeredTeams, setRegisteredTeams] = useState(() => {
        return loadStored('baseball_registeredTeams_v2', []);
      });
      const [showArchiveModal, setShowArchiveModal] = useState(false);
      const [showTeamManager, setShowTeamManager] = useState(false);
      const [editingTeamIndex, setEditingTeamIndex] = useState(null);
      const [playerPicker, setPlayerPicker] = useState(null); // {side, index}: オーダーの選手選択ポップアップ
      const [mergeMode, setMergeMode] = useState(false); // チーム編集の選手統合モード
      const [mergeSelection, setMergeSelection] = useState([]); // 統合対象の選手インデックス
      const [mergeKeepIdx, setMergeKeepIdx] = useState(null); // 統合後に残す選手インデックス
      const [showSettings, setShowSettings] = useState(false);
      const [orderSnapshot, setOrderSnapshot] = useState(null); // オーダー設定を開いた時点の選手名(試合途中の登録し直し検出用)
      const [scoreEdit, setScoreEdit] = useState(null); // スコア修正モーダル: {source:'current'|'saved', gameId, top:[], bottom:[]}
      const [showRecordEditor, setShowRecordEditor] = useState(false); // 全記録修正モーダル: 一球ごとの記録を一覧して修正
      const [showExport, setShowExport] = useState(false);
      const [showScorebookPrintSettings, setShowScorebookPrintSettings] = useState(false);
      const [scorebookPrintOptions, setScorebookPrintOptions] = useState({ includeCharts: true, includeStats: true });
      const [showInPlayResult, setShowInPlayResult] = useState(false);
      const [showErrorTypeSelect, setShowErrorTypeSelect] = useState(false);
      const [showAdvanceModal, setShowAdvanceModal] = useState(false);
      const [advanceData, setAdvanceData] = useState({ runner: '', reason: '', to: '', countAsPitch: null });
      // 打席結果の直後に出す「走者はどこまで進んだか」の確認シート
      const [advanceSheet, setAdvanceSheet] = useState(null);
      const [askAdvanceAfterHit, setAskAdvanceAfterHit] = useState(() => loadStored('baseball_askAdvanceAfterHit_v1', true));
      const [showOutRunnerModal, setShowOutRunnerModal] = useState(false);
      const [showPickoffModal, setShowPickoffModal] = useState(false);
      const [showFurinigeModal, setShowFurinigeModal] = useState(false);
      const [outRunnerData, setOutRunnerData] = useState({ runner: '', reason: '盗塁死' });
      
      // 選手交代モーダル用ステート
      const [showSubstitutionModal, setShowSubstitutionModal] = useState(false);
      // 選手を入れ替えず守備位置だけ動かす交代タイプ
      const POSITION_CHANGE_TYPE = '位置変更';
      // insertIndex: null なら現在時点の交代、数値なら記録のその位置へさかのぼって挿入する
      const [subData, setSubData] = useState({ team: 'top', type: '代打', order: 1, newName: '', newPos: '打', newThrows: '右', newBats: '右', shiftOrder: null, shiftNewPos: '', insertIndex: null });

      const [showPostGameAnalysis, setShowPostGameAnalysis] = useState(false);
      const [showAnalystReport, setShowAnalystReport] = useState(false);
      const [showShareModal, setShowShareModal] = useState(false);
      const [shareTextData, setShareTextData] = useState(null);
      const [showImportTextModal, setShowImportTextModal] = useState(false);
      const [importText, setImportText] = useState('');
      const [heatmapTab, setHeatmapTab] = useState('all');
      const [heatmapCountTab, setHeatmapCountTab] = useState('all');
      const [rightPanelMode, setRightPanelMode] = useState('current');
      const [printMode, setPrintMode] = useState(false);
      const [expandedPitcherId, setExpandedPitcherId] = useState(null);
      const [expandedBatterId, setExpandedBatterId] = useState(null);
      const [selectedHitCoord, setSelectedHitCoord] = useState(null);
      const [selectedPosition, setSelectedPosition] = useState(null);
      const [analysisFilter, setAnalysisFilter] = useState({ pitcher: 'ALL', batterSide: 'ALL' });
      const [currentPitch, setCurrentPitch] = useState({ course: null, type: 'ストレート' });
      // 入力時の視点: 'catcher'=バックネット裏(捕手目線) / 'pitcher'=バックスクリーン側。データは常に捕手目線で保存し、入力グリッドの表示のみ左右反転する
      const [pitchView, setPitchView] = useState(() => loadStored('baseball_pitchView_v2', 'catcher'));
      const [editingPitchIndex, setEditingPitchIndex] = useState(null);
      const [editPitchData, setEditPitchData] = useState(null);
      const [toast, setToast] = useState(null);
      const [confirmDialog, setConfirmDialog] = useState(null);

      // 累計成績モーダル用ステート
      const [showCumulativeStats, setShowCumulativeStats] = useState(false);
      const [cumulativeTeam, setCumulativeTeam] = useState('');
      const [cumulativeDateFrom, setCumulativeDateFrom] = useState('');
      const [cumulativeDateTo, setCumulativeDateTo] = useState('');
      const [cumulativeTab, setCumulativeTab] = useState('batter');
      const [expandedCumKey, setExpandedCumKey] = useState(null);
      const [showAnalyticsHub, setShowAnalyticsHub] = useState(false);
      const [homeTeamName, setHomeTeamName] = useState(() => loadStored('baseball_homeTeam_v3', ''));
      const [playerNotes, setPlayerNotes] = useState(() => loadStored('baseball_playerNotes_v3', {}));

      useEffect(() => { storage.setItem('baseball_gameState_v2', JSON.stringify(gameState)); }, [gameState]);
      useEffect(() => { storage.setItem('baseball_homeTeam_v3', JSON.stringify(homeTeamName)); }, [homeTeamName]);
      useEffect(() => { storage.setItem('baseball_playerNotes_v3', JSON.stringify(playerNotes)); }, [playerNotes]);
      useEffect(() => { storage.setItem('baseball_gameInfo_v2', JSON.stringify(gameInfo)); }, [gameInfo]);
      useEffect(() => { storage.setItem('baseball_lineups_v2', JSON.stringify(lineups)); }, [lineups]);
      useEffect(() => { storage.setItem('baseball_pitches_v2', JSON.stringify(pitches)); }, [pitches]);
      useEffect(() => { storage.setItem('baseball_pitchView_v2', JSON.stringify(pitchView)); }, [pitchView]);
      useEffect(() => { storage.setItem('baseball_askAdvanceAfterHit_v1', JSON.stringify(askAdvanceAfterHit)); }, [askAdvanceAfterHit]);
      useEffect(() => { storage.setItem('baseball_savedGames_v2', JSON.stringify(savedGames)); }, [savedGames]);
      useEffect(() => { storage.setItem('baseball_registeredTeams_v2', JSON.stringify(registeredTeams)); }, [registeredTeams]);


      const showToast = (text, type = 'success') => { setToast({ text, type }); setTimeout(() => setToast(null), 3000); };
      const findRegisteredTeam = (name) => registeredTeams.find(t => t.name === name);
      const addPlayerToTeam = (teamName, playerName, throws = '右', bats = '右') => {
        setRegisteredTeams(prev => prev.map(t => t.name === teamName ? {...t, players: [...(t.players||[]), {name: playerName, throws, bats}]} : t));
        showToast(`${playerName}を${teamName}に追加しました`);
      };
      const compressData = (obj) => btoa(encodeURIComponent(JSON.stringify(obj)));
      const decompressData = (str) => { try { return JSON.parse(decodeURIComponent(atob(str))); } catch(e) { return null; } };

      const hitsAndErrors = useMemo(() => {
        const stats = { top: { hits: 0, errors: 0 }, bottom: { hits: 0, errors: 0 } };
        pitches.forEach(p => {
          if (p.isEvent) return;
          const isHit = ['安', '塁打', '本塁打'].some(w => p.result.includes(w));
          const isError = ['エラー', '敵失', '野手選択'].some(w => p.result.includes(w));
          if (isHit) stats[p.isTop ? 'top' : 'bottom'].hits++;
          if (isError) stats[p.isTop ? 'bottom' : 'top'].errors++;
        });
        return stats;
      }, [pitches]);

      const createSnapshot = useCallback(() => ({ gameState: JSON.parse(JSON.stringify(gameState)), gameInfo: JSON.parse(JSON.stringify(gameInfo)), lineups: JSON.parse(JSON.stringify(lineups)), pitches: JSON.parse(JSON.stringify(pitches)), showInPlayResult, showFurinigeModal, selectedPosition, selectedHitCoord }), [gameState, gameInfo, lineups, pitches, showInPlayResult, showFurinigeModal, selectedPosition, selectedHitCoord]);
      const recordAction = useCallback(() => { setUndoStack(prev => [...prev, createSnapshot()].slice(-30)); setRedoStack([]); }, [createSnapshot]);

      const handleUndo = () => {
        if (undoStack.length === 0) return;
        setRedoStack(prev => [...prev, createSnapshot()]);
        const last = undoStack[undoStack.length - 1];
        setGameState(last.gameState); setGameInfo(last.gameInfo); setLineups(last.lineups); setPitches(last.pitches); setShowInPlayResult(last.showInPlayResult); setShowFurinigeModal(last.showFurinigeModal || false); setSelectedPosition(last.selectedPosition); setSelectedHitCoord(last.selectedHitCoord);
        setUndoStack(prev => prev.slice(0, -1));
      };
      const handleRedo = () => {
        if (redoStack.length === 0) return;
        setUndoStack(prev => [...prev, createSnapshot()]);
        const next = redoStack[redoStack.length - 1];
        setGameState(next.gameState); setGameInfo(next.gameInfo); setLineups(next.lineups); setPitches(next.pitches); setShowInPlayResult(next.showInPlayResult); setShowFurinigeModal(next.showFurinigeModal || false); setSelectedPosition(next.selectedPosition); setSelectedHitCoord(next.selectedHitCoord);
        setRedoStack(prev => prev.slice(0, -1));
      };

      const handleNewGame = () => {
        setConfirmDialog({
          title: '🔄 新試合の開始', message: '現在の試合データをすべて消去して、新しい試合を開始しますか？', subMessage: '※この操作は取り消せません', isDanger: true,
          onConfirm: () => {
            setGameState(makeInitialGameState());
            setGameInfo({ date: new Date().toLocaleDateString('ja-JP').replace(/\//g, '-'), gameType: '練習試合', teamTop: '先攻チーム', teamBottom: '後攻チーム' });
            setLineups(makeInitialLineups());
            setPitches([]); setUndoStack([]); setRedoStack([]); setConfirmDialog(null); showToast('新しい試合を開始しました');
          }
        });
      };

      const handleTieBreak = () => {
        setConfirmDialog({
          title: '⚡ 特別延長', message: '特別延長（0アウト1,2塁）をセットしますか？', isDanger: false,
          onConfirm: () => { recordAction(); setGameState(prev => ({ ...prev, outs: 0, balls: 0, strikes: 0, runners: { first: true, second: true, third: false } })); setConfirmDialog(null); }
        });
      };

      const isPlaceholderName = (name) => {
        if (!name || !name.trim()) return true;
        const t = name.trim();
        return /^(先攻|後攻)\d+番$/.test(t) || t === '先発投手' || /^選手\d+$/.test(t);
      };
      const isPlaceholderTeam = (name) => !name || !name.trim() || name === '先攻チーム' || name === '後攻チーム';
      const parseGameDate = (s) => { const m = (s||'').match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };

      // 試合保存時、オーダーと対戦相手のメンバーを登録チームへ自動反映
      const autoRegisterFromGame = (gi, lns) => {
        const collectFromPitches = (isTopSide) => {
          // 対戦相手の投手名を該当チームの選手として拾う
          const key = isTopSide ? 'Top' : 'Bottom';
          const result = [];
          pitches.forEach(p => {
            if (p.isEvent) return;
            // 投手は守備側＝打者の反対サイド
            const pitcherTeamIsTop = !p.isTop;
            if (pitcherTeamIsTop === isTopSide && p.pitcherName && !isPlaceholderName(p.pitcherName)) {
              if (!result.find(x => x.name === p.pitcherName)) {
                result.push({ name: p.pitcherName, throws: p.pitcherThrows || '右', bats: '右' });
              }
            }
          });
          return result;
        };
        setRegisteredTeams(prev => {
          let updated = [...prev];
          ['top','bottom'].forEach(side => {
            const teamName = side === 'top' ? gi.teamTop : gi.teamBottom;
            if (isPlaceholderTeam(teamName)) return;
            const fromLineup = (lns[side] || [])
              .filter(p => !isPlaceholderName(p.name))
              .map(p => ({ name: p.name.trim(), throws: p.throws || '右', bats: p.bats || '右' }));
            const fromPitchers = collectFromPitches(side === 'top');
            const merged = [...fromLineup];
            fromPitchers.forEach(fp => { if (!merged.find(m => m.name === fp.name)) merged.push(fp); });
            if (merged.length === 0) return;
            const idx = updated.findIndex(t => t.name === teamName);
            if (idx < 0) {
              updated.push({ name: teamName, players: merged });
            } else {
              const existing = updated[idx];
              const existingPl = (existing.players || []).map(pl => typeof pl === 'string' ? { name: pl, throws: '右', bats: '右' } : pl);
              const names = new Set(existingPl.map(pl => pl.name));
              const adds = merged.filter(m => !names.has(m.name));
              if (adds.length > 0) {
                updated[idx] = { ...existing, players: [...existingPl, ...adds] };
              }
            }
          });
          return updated;
        });
      };

      // アーカイブ保存用の共通スナップショット(埋め込むgameInfoからは読込元IDを除く)
      const buildGameSnapshot = () => {
        const { sourceGameId, ...giClean } = gameInfo;
        return { date: gameInfo.date, teamTop: gameInfo.teamTop, teamBottom: gameInfo.teamBottom, scoreTop: gameState.runs.top.reduce((a,b)=>a+b,0), scoreBottom: gameState.runs.bottom.reduce((a,b)=>a+b,0), pitchesCount: pitches.filter(p=>!p.isEvent||p.countAsPitch).length, data: { gameState, gameInfo: giClean, lineups, pitches } };
      };

      const saveCurrentGame = () => {
        setConfirmDialog({
          title: '💾 アーカイブに保存', message: '現在の試合状態を新しい試合としてアーカイブに保存しますか？', isDanger: false,
          onConfirm: () => {
            const newGame = { id: Date.now().toString(), ...buildGameSnapshot() };
            setSavedGames([newGame, ...savedGames]);
            autoRegisterFromGame(gameInfo, lineups);
            setConfirmDialog(null); showToast('試合を保存しました！チーム/選手を自動登録しました');
          }
        });
      };

      // 読み込み元の保存済み試合を、修正後の現在の内容で上書きする(試合後の記録修正用)
      const overwriteSourceGame = () => {
        const target = savedGames.find(g => g.id === gameInfo.sourceGameId);
        if (!target) return;
        setConfirmDialog({
          title: '💾 読み込み元へ上書き保存', message: `保存済みの試合「${target.date} ${target.teamTop} vs ${target.teamBottom}」を、現在の内容(修正後)で上書きしますか？`, subMessage: '※元の保存データは置き換えられます', isDanger: false,
          onConfirm: () => {
            setSavedGames(prev => prev.map(g => g.id === gameInfo.sourceGameId ? { ...g, ...buildGameSnapshot() } : g));
            autoRegisterFromGame(gameInfo, lineups);
            setConfirmDialog(null); showToast('保存済みの試合を上書きしました');
          }
        });
      };

      // openRecordEditor: 試合後の記録修正(選手交代のさかのぼり挿入など)へそのまま進む
      const loadGame = (gameId, { openRecordEditor = false } = {}) => {
        setConfirmDialog({
          title: '📂 データの読み込み', message: '現在の作業中データは上書きされます。本当に読み込みますか？', isDanger: true,
          onConfirm: () => {
            const target = savedGames.find(g => g.id === gameId);
            if (target) {
              setGameState(normalizeGameState(target.data.gameState)); setGameInfo({ ...target.data.gameInfo, sourceGameId: target.id }); setLineups(target.data.lineups || makeInitialLineups()); setPitches(target.data.pitches || []); setUndoStack([]); setRedoStack([]); setShowArchiveModal(false); setConfirmDialog(null);
              if (openRecordEditor) { setShowRecordEditor(true); showToast('記録を読み込みました。交代を入れる場面の🔄をタップしてください'); }
              else showToast('試合データを読み込みました。修正後は「読み込み元へ上書き保存」で反映できます');
            }
          }
        });
      };

      const deleteGame = (gameId) => { setConfirmDialog({ title: '🗑️ アーカイブの削除', message: 'この保存データを完全に削除しますか？', isDanger: true, onConfirm: () => { setSavedGames(savedGames.filter(g => g.id !== gameId)); setConfirmDialog(null); } }); };

      // オーダー設定を開くとき、選手名のスナップショットを取り、試合途中の登録し直し(改名)を検出できるようにする
      const openOrderSettings = () => {
        setOrderSnapshot({ top: lineups.top.map(p => p.name), bottom: lineups.bottom.map(p => p.name) });
        setShowSettings(true);
      };

      // オーダー設定を閉じるとき、入力済み選手を登録チームへ自動反映する
      const closeOrderSettings = () => {
        let added = 0;
        ['top', 'bottom'].forEach(side => {
          const teamName = side === 'top' ? gameInfo.teamTop : gameInfo.teamBottom;
          if (isPlaceholderTeam(teamName)) return;
          const rosterNames = new Set(getRosterPlayers(teamName).map(p => p.name));
          lineups[side].forEach(p => { if (!isPlaceholderName(p.name) && !rosterNames.has(p.name.trim())) added++; });
        });
        const renames = detectLineupRenames(orderSnapshot, lineups, pitches);
        autoRegisterFromGame(gameInfo, lineups);
        setShowSettings(false);
        setOrderSnapshot(null);
        if (added > 0) showToast(`チーム管理に選手${added}名を自動登録しました`);
        // 試合途中に選手名を登録し直した場合、入力済みの記録(打席・投球)にも新しい名前を反映できるようにする
        if (renames.length > 0) {
          const total = renames.reduce((a, r) => a + r.count, 0);
          setConfirmDialog({
            title: '📝 選手名の変更を記録に反映',
            message: `選手名を変更しました:\n${renames.map(r => `「${r.from}」→「${r.to}」(記録${r.count}件)`).join('\n')}\n\n入力済みの打席・投球記録も新しい名前に書き換えますか？`,
            subMessage: '※別の選手に交代した場合は「キャンセル」してください(過去の記録は元の選手のまま残ります)',
            isDanger: false,
            onConfirm: () => {
              recordAction();
              let cur = { lineups, pitches };
              renames.forEach(r => { const res = renamePlayersInGame(cur, r.side, [r.from], r.to); cur = { lineups: res.lineups, pitches: res.pitches }; });
              setLineups(cur.lineups);
              setPitches(cur.pitches);
              setConfirmDialog(null);
              showToast(`過去の記録${total}件の選手名を更新しました`);
            }
          });
        }
      };

      // チーム編集画面: 選択した選手を1人に統合し、過去試合の記録も改名する
      const executeMergePlayers = () => {
        const team = registeredTeams[editingTeamIndex];
        if (!team || mergeSelection.length < 2 || mergeKeepIdx === null) return;
        const players = (team.players || []).map(asPlayerObj);
        const keep = players[mergeKeepIdx];
        if (!keep || !keep.name) return;
        const fromNames = [...new Set(mergeSelection.filter(i => i !== mergeKeepIdx).map(i => players[i]?.name).filter(n => n && n !== keep.name))];
        if (fromNames.length === 0) { showToast('統合する名前がありません', 'error'); return; }
        setConfirmDialog({
          title: '🔀 選手の統合',
          message: `${fromNames.map(n => `「${n}」`).join('')}を「${keep.name}」に統合しますか？`,
          subMessage: '※名簿の重複を削除し、現在の試合と保存済みの全試合の記録(打席・投球)も書き換えます。この操作は取り消せません',
          isDanger: true,
          onConfirm: () => {
            // 1) 名簿から統合元を削除
            setRegisteredTeams(prev => prev.map((t, i) => i === editingTeamIndex ? { ...t, players: mergeRosterPlayers(t.players, mergeSelection, mergeKeepIdx) } : t));
            // 2) 現在の試合の記録を改名
            let cur = { lineups, pitches };
            let curChanged = 0;
            ['top', 'bottom'].forEach(side => {
              const curName = side === 'top' ? gameInfo.teamTop : gameInfo.teamBottom;
              if (curName !== team.name) return;
              const r = renamePlayersInGame(cur, side, fromNames, keep.name);
              cur = { lineups: r.lineups, pitches: r.pitches };
              curChanged += r.changed;
            });
            if (curChanged > 0) { setLineups(cur.lineups); setPitches(cur.pitches); }
            // 3) 保存済み試合の記録を改名
            let gamesUpdated = 0;
            const newSavedGames = savedGames.map(g => {
              if (g.teamTop !== team.name && g.teamBottom !== team.name) return g;
              let data = g.data || {};
              let changed = 0;
              ['top', 'bottom'].forEach(side => {
                const gName = side === 'top' ? g.teamTop : g.teamBottom;
                if (gName !== team.name) return;
                const r = renamePlayersInGame(data, side, fromNames, keep.name);
                changed += r.changed;
                data = { ...data, lineups: r.lineups, pitches: r.pitches };
              });
              if (changed === 0) return g;
              gamesUpdated++;
              return { ...g, data };
            });
            setSavedGames(newSavedGames);
            setMergeMode(false); setMergeSelection([]); setMergeKeepIdx(null); setConfirmDialog(null);
            showToast(`「${keep.name}」に統合しました${gamesUpdated > 0 ? `(過去${gamesUpdated}試合の記録も更新)` : ''}`);
          }
        });
      };

      const applyTeamToLineup = (teamData, side) => {
        if (!teamData?.players || teamData.players.length === 0) return;
        recordAction();
        const players = teamData.players.map(p => typeof p === 'string' ? { name: p, throws: '右', bats: '右' } : p);
        const newLineup = lineups[side].map((slot, i) => i < players.length ? { ...slot, name: players[i].name, throws: players[i].throws, bats: players[i].bats } : slot);
        setLineups(prev => ({ ...prev, [side]: newLineup }));
        setGameInfo(prev => ({ ...prev, [side === 'top' ? 'teamTop' : 'teamBottom']: teamData.name }));
      };

      const swapTopAndBottom = () => {
        setConfirmDialog({
          title: '⇅ 先攻/後攻の入替', message: '先攻と後攻のチーム名・オーダーを入れ替えますか？', isDanger: false,
          onConfirm: () => { recordAction(); setGameInfo(prev => ({...prev, teamTop: prev.teamBottom, teamBottom: prev.teamTop})); setLineups(prev => ({...prev, top: prev.bottom, bottom: prev.top})); setOrderSnapshot(prev => prev ? { top: prev.bottom, bottom: prev.top } : prev); setConfirmDialog(null); showToast("先攻と後攻を入れ替えました！"); }
        });
      };

      const jumpToInning = (inning, isTop) => {
        recordAction();
        const inningPitches = pitches.filter(p => p.inning === inning && p.isTop === isTop);
        let targetBatter = isTop ? gameState.batterTop : gameState.batterBottom;
        let newRunners = { first: false, second: false, third: false }, newOuts = 0, newBalls = 0, newStrikes = 0;
        if (inningPitches.length > 0) {
          const lastPitch = inningPitches[inningPitches.length - 1];
          targetBatter = lastPitch.batter; newRunners = lastPitch.runners || newRunners; newOuts = lastPitch.outs || 0;
          for (let p of inningPitches.filter(p => p.batter === targetBatter && !p.isEvent)) {
            if (p.result === 'ボール' || p.result === 'ウエスト') newBalls++; else if (p.result === 'ストライク' || p.result === '空振り' || p.result === 'バント空振り') newStrikes++; else if (['ファウル','バントファウル'].includes(p.result) && newStrikes < 2) newStrikes++;
          }
        }
        setGameState(prev => ({ ...prev, inning, isTop, ...(isTop ? { batterTop: targetBatter } : { batterBottom: targetBatter }), runners: newRunners, outs: newOuts, balls: newBalls, strikes: newStrikes }));
        setShowInPlayResult(false); setSelectedPosition(null); setSelectedHitCoord(null); setShowErrorTypeSelect(false);
      };

      const manuallyChangeBatter = (newBatterNum) => {
        recordAction();
        const targetPitches = pitches.filter(p => p.inning === gameState.inning && p.isTop === gameState.isTop && p.batter === newBatterNum);
        setGameState(prev => {
          let newRunners = { first: false, second: false, third: false }, newOuts = prev.outs, newBalls = 0, newStrikes = 0;
          if (targetPitches.length > 0) {
            const lastPitch = targetPitches[targetPitches.length - 1]; newRunners = lastPitch.runners || newRunners; newOuts = lastPitch.outs || 0;
            for (let p of targetPitches.filter(p => !p.isEvent)) { if (p.result === 'ボール' || p.result === 'ウエスト') newBalls++; else if (p.result === 'ストライク' || p.result === '空振り' || p.result === 'バント空振り') newStrikes++; else if (['ファウル','バントファウル'].includes(p.result) && newStrikes < 2) newStrikes++; }
          }
          return { ...prev, ...(prev.isTop ? { batterTop: newBatterNum } : { batterBottom: newBatterNum }), runners: newRunners, outs: newOuts, balls: newBalls, strikes: newStrikes };
        });
        setShowInPlayResult(false); setSelectedPosition(null); setSelectedHitCoord(null); setShowErrorTypeSelect(false);
      };

      const toggleRunner = (base) => { recordAction(); setGameState(prev => ({ ...prev, runners: { ...prev.runners, [base]: !prev.runners[base] } })); };
      const changeScore = (team, delta) => {
        recordAction();
        setGameState(prev => { const newRuns = ensureRunArray(prev.runs[team], prev.inning); const newEarned = ensureRunArray(prev.earnedRuns?.[team] || prev.runs[team], prev.inning); newRuns[prev.inning - 1] = Math.max(0, (newRuns[prev.inning - 1] || 0) + delta); newEarned[prev.inning - 1] = Math.min(newRuns[prev.inning - 1], Math.max(0, (newEarned[prev.inning - 1] || 0) + delta)); return { ...prev, runs: { ...prev.runs, [team]: newRuns }, earnedRuns: { ...prev.earnedRuns, [team]: newEarned } }; });
      };

      // スコア修正モーダル: 試合中(現在の試合)・試合後(保存済み試合)どちらでも回別スコアを直接修正できる
      const openScoreEdit = (source, gameId = null) => {
        let runs = gameState.runs, earnedRuns = gameState.earnedRuns || gameState.runs;
        if (source === 'saved') {
          const g = savedGames.find(x => x.id === gameId);
          if (!g) return;
          runs = g.data?.gameState?.runs || { top: [], bottom: [] };
          earnedRuns = g.data?.gameState?.earnedRuns || runs;
        }
        const len = Math.max(9, runs.top?.length || 0, runs.bottom?.length || 0);
        const toArr = (a) => Array.from({ length: len }, (_, i) => Math.max(0, Number(a?.[i]) || 0));
        setScoreEdit({ source, gameId, top: toArr(runs.top), bottom: toArr(runs.bottom), earnedTop: toArr(earnedRuns.top).map((v,i)=>Math.min(v,toArr(runs.top)[i])), earnedBottom: toArr(earnedRuns.bottom).map((v,i)=>Math.min(v,toArr(runs.bottom)[i])) });
      };
      const setScoreEditCell = (team, idx, val) => {
        const n = Math.max(0, Math.min(99, Math.floor(Number(val) || 0)));
        setScoreEdit(prev => { const next={ ...prev, [team]: prev[team].map((v, i) => i === idx ? n : v) }; const erKey=team==='top'?'earnedTop':'earnedBottom'; next[erKey]=prev[erKey].map((v,i)=>i===idx?Math.min(v,n):v); return next; });
      };
      const setEarnedRunCell = (team, idx, val) => { const key=team==='top'?'earnedTop':'earnedBottom', runKey=team; const n=Math.max(0,Math.floor(Number(val)||0)); setScoreEdit(prev=>({...prev,[key]:prev[key].map((v,i)=>i===idx?Math.min(n,prev[runKey][i]):v)})); };
      const addScoreEditInning = () => setScoreEdit(prev => ({ ...prev, top: [...prev.top, 0], bottom: [...prev.bottom, 0], earnedTop:[...prev.earnedTop,0], earnedBottom:[...prev.earnedBottom,0] }));
      const saveScoreEdit = () => {
        const { source, gameId, top, bottom, earnedTop, earnedBottom } = scoreEdit;
        if (source === 'saved') {
          setSavedGames(prev => prev.map(g => {
            if (g.id !== gameId) return g;
            const gs = { ...(g.data?.gameState || {}), runs: { top: [...top], bottom: [...bottom] }, earnedRuns:{top:[...earnedTop],bottom:[...earnedBottom]} };
            return { ...g, scoreTop: top.reduce((a, b) => a + b, 0), scoreBottom: bottom.reduce((a, b) => a + b, 0), data: { ...g.data, gameState: gs } };
          }));
          showToast('保存済み試合のスコアを修正しました');
        } else {
          recordAction();
          setGameState(prev => ({ ...prev, runs: { top: ensureRunArray(top, prev.inning), bottom: ensureRunArray(bottom, prev.inning) }, earnedRuns:{top:ensureRunArray(earnedTop,prev.inning),bottom:ensureRunArray(earnedBottom,prev.inning)} }));
          showToast('スコアを修正しました');
        }
        setScoreEdit(null);
      };

      const handleAdvanceAndNextBatter = (eventType, addedOuts = 0) => {
        setGameState(prev => advanceGameState(prev, eventType, addedOuts));
        setShowInPlayResult(false); setSelectedPosition(null); setSelectedHitCoord(null); setShowErrorTypeSelect(false);
      };

      const recordPitch = (result, detailedResult = '') => {
        if (!result?.startsWith('牽制') && !['その他出塁','ウエスト','死球'].includes(result) && currentPitch.course === null) { showToast("先にコースを選択してください！", "error"); return; }
        recordAction();
        const currentBatterIndex = (gameState.isTop ? gameState.batterTop : gameState.batterBottom) - 1;
        const currentPitcherObj = lineups[gameState.isTop ? 'bottom' : 'top'].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①') || { name: '投手未設定', throws: '右' };
        const currentBatterObj = lineups[gameState.isTop ? 'top' : 'bottom'][currentBatterIndex] || { name: '打者未設定', bats: '右' };
        const currentBatterPitches = pitches.filter(p => p.inning === gameState.inning && p.isTop === gameState.isTop && p.batter === currentBatterIndex + 1 && (!p.isEvent || p.countAsPitch));
        const isThreeBunt = result === 'バントファウル' && gameState.strikes === 2;
        const actualResult = isThreeBunt ? 'スリーバント失敗' : detailedResult || result;
        setPitches([...pitches, {
          ...currentPitch, course: result?.startsWith('牽制') || ['その他出塁','ウエスト'].includes(result) ? null : currentPitch.course, type: result?.startsWith('牽制') || result === 'その他出塁' ? '-' : currentPitch.type, result: actualResult, inning: gameState.inning, isTop: gameState.isTop, batter: currentBatterIndex + 1, pitchNumber: currentBatterPitches.length + 1, pitcherName: currentPitcherObj.name, pitcherThrows: currentPitcherObj.throws, batterName: currentBatterObj.name, batterBats: currentBatterObj.bats, batterThrows: currentBatterObj.throws, batterPos: currentBatterObj.pos, isEvent: false, runners: { ...gameState.runners }, outs: gameState.outs
        }]);
        if (result?.startsWith('牽制')) { setCurrentPitch(p => ({ ...p, course: null })); return; }
        if (isThreeBunt) { handleAdvanceAndNextBatter('out', 1); }
        else if (result === 'ストライク' || result === '空振り' || result === 'バント空振り') { if (gameState.strikes === 2) setShowFurinigeModal(true); else setGameState(prev => ({ ...prev, strikes: prev.strikes + 1 })); }
        else if (result === 'ファウル' || result === 'バントファウル') { if (gameState.strikes < 2) setGameState(prev => ({ ...prev, strikes: prev.strikes + 1 })); }
        else if (result === 'ボール' || result === 'ウエスト') { if (gameState.balls === 3) handleAdvanceAndNextBatter('walk', 0); else setGameState(prev => ({ ...prev, balls: prev.balls + 1 })); }
        else if (result === '死球' || result === 'その他出塁') { handleAdvanceAndNextBatter(result === 'その他出塁' ? 'other' : 'walk', 0); }
        else if (result === 'インプレー' || result === 'バント') { setShowInPlayResult(true); }
        setCurrentPitch(p => ({ ...p, course: null }));
      };

      const handleFieldClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * 240;
        const y = (e.clientY - rect.top) / rect.height * 200;
        recordAction();
        setSelectedHitCoord({ x, y });
        setSelectedPosition(null);
        setShowErrorTypeSelect(false);
      };

      const handleInPlayFinalResult = (typeLabel, outCount) => {
        recordAction();
        setPitches(prev => {
          const newPitches = [...prev];
          if (newPitches.length > 0) {
            const lastIdx = newPitches.length - 1;
            newPitches[lastIdx] = { ...newPitches[lastIdx], result: `${selectedPosition}${typeLabel}`, hitX: selectedHitCoord ? selectedHitCoord.x : newPitches[lastIdx].hitX, hitY: selectedHitCoord ? selectedHitCoord.y : newPitches[lastIdx].hitY };
          }
          return newPitches;
        });
        let eventType = 'out';
        if (typeLabel.includes('本塁打')) eventType = 'homerun'; else if (typeLabel.includes('三塁打')) eventType = 'triple'; else if (typeLabel.includes('二塁打')) eventType = 'double'; else if (typeLabel.includes('安')) eventType = 'single'; else if (['エラー','敵失(エラー)','野手選択'].includes(typeLabel) || typeLabel.includes('エラー')) eventType = 'error'; else if (typeLabel === '犠打') eventType = 'sac_bunt'; else if (typeLabel === '犠飛') eventType = 'sac_fly';
        // 走者がいる打席で打者が出塁したときは、自動進塁のままでよいかを確認する
        // (1死2塁の単打が必ず1・3塁になってしまうのを防ぐ)
        const hasRunner = gameState.runners.first || gameState.runners.second || gameState.runners.third;
        if (askAdvanceAfterHit && hasRunner && isAdjustableEventType(eventType) && gameState.outs + outCount < 3) {
          openAdvanceSheet(eventType, outCount, `${selectedPosition}${typeLabel}`);
          setShowInPlayResult(false); setSelectedPosition(null); setSelectedHitCoord(null); setShowErrorTypeSelect(false);
          return;
        }
        handleAdvanceAndNextBatter(eventType, outCount);
        setSelectedHitCoord(null);
      };

      // ---- 打席直後の進塁確認シート ----
      const openAdvanceSheet = (eventType, addedOuts, resultText) => {
        const runnersBefore = { ...gameState.runners };
        setAdvanceSheet({
          eventType, addedOuts, resultText, runnersBefore,
          outsBefore: gameState.outs,
          batter: gameState.isTop ? gameState.batterTop : gameState.batterBottom,
          plan: autoPositions(runnersBefore, eventType),
        });
      };

      // 進塁シートの内容を記録に反映する。
      // データ構造は増やさず、既存の走者イベント記録として書き出すことで
      // 記録の再構築・速報・スコアブックのすべてに反映される。
      const applyAdvanceSheet = (planOverride = null) => {
        if (!advanceSheet) return;
        const { eventType, addedOuts, runnersBefore, batter } = advanceSheet;
        const plan = planOverride || advanceSheet.plan;
        const { pre, post } = buildAdvanceEvents(runnersBefore, eventType, plan);
        const inning = gameState.inning, isTop = gameState.isTop;
        const pitcherObj = lineups[isTop ? 'bottom' : 'top'].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①') || { name: '投手未設定', throws: '右' };
        // イベント記録の打順は、記録の再構築(rebuildGameStateFromPitches)が
        // 打順を巻き戻さないよう、その記録の時点で打席に立っている打者に合わせる。
        // 打席結果の前に差し込む記録はこの打者、後ろに続く記録は次の打者。
        const mkEvent = (result, batterNum, runners, outs) => {
          const b = lineups[isTop ? 'top' : 'bottom'][batterNum - 1] || { name: '打者未設定', bats: '右' };
          return {
            course: null, type: '-', result, inning, isTop, batter: batterNum, pitchNumber: '-',
            pitcherName: pitcherObj.name, pitcherThrows: pitcherObj.throws,
            batterName: b.name, batterBats: b.bats,
            isEvent: true, runners: { ...runners }, outs
          };
        };

        // 状況を1件ずつ進めながら、各イベント記録にその時点の塁状況・アウト数を持たせる
        let st = normalizeGameState(gameState);
        const preRecords = pre.map(text => { const rec = mkEvent(text, batter, st.runners, st.outs); st = applyRunnerEventToState(st, text); return rec; });
        st = advanceGameState(st, eventType, addedOuts);
        const nextBatter = isTop ? st.batterTop : st.batterBottom;
        const postRecords = post.map(text => { const rec = mkEvent(text, nextBatter, st.runners, st.outs); st = applyRunnerEventToState(st, text); return rec; });

        if (preRecords.length > 0 || postRecords.length > 0) {
          setPitches(prev => {
            const arr = [...prev];
            // 事前イベント(自動進塁だと生還してしまう走者のアウト)は打席結果の直前へ差し込む
            arr.splice(Math.max(0, arr.length - 1), 0, ...preRecords);
            return [...arr, ...postRecords];
          });
        }
        setGameState(st);
        setAdvanceSheet(null);
      };

      const handleAdvanceRecord = () => {
        if (!advanceData.runner || !advanceData.reason || !advanceData.to) { showToast("全ての項目を選択してください", "error"); return; }
        if (advanceData.reason === 'ボーク' && advanceData.countAsPitch === null) { showToast("投球の有無を選択してください", "error"); return; }
        recordAction();
        const runnerName = advanceData.runner === 'first' ? '1塁走者' : advanceData.runner === 'second' ? '2塁走者' : '3塁走者';
        const toName = advanceData.to === 'second' ? '2塁' : advanceData.to === 'third' ? '3塁' : advanceData.to === 'same' ? 'そのまま' : '本塁';
        let resultText = `${runnerName} ${advanceData.reason}で${toName}へ`;
        if (advanceData.reason === '代走') resultText = `${runnerName} に代走`; else if (advanceData.to === 'same') resultText = `${runnerName} ${advanceData.reason}`;
        const currentBatterIndex = (gameState.isTop ? gameState.batterTop : gameState.batterBottom) - 1;
        const currentPitcherObj = lineups[gameState.isTop ? 'bottom' : 'top'].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①') || { name: '投手未設定', throws: '右' };
        const currentBatterObj = lineups[gameState.isTop ? 'top' : 'bottom'][currentBatterIndex] || { name: '打者未設定', bats: '右' };
        const isBalkWithPitch = advanceData.reason === 'ボーク' && advanceData.countAsPitch === true;
        const balkPitchNum = isBalkWithPitch ? pitches.filter(p => p.inning === gameState.inning && p.isTop === gameState.isTop && p.batter === currentBatterIndex + 1 && (!p.isEvent || p.countAsPitch)).length + 1 : '-';
        setPitches([...pitches, { course: null, type: '-', result: resultText, inning: gameState.inning, isTop: gameState.isTop, batter: currentBatterIndex + 1, pitchNumber: balkPitchNum, pitcherName: currentPitcherObj.name, pitcherThrows: currentPitcherObj.throws, batterName: currentBatterObj.name, batterBats: currentBatterObj.bats, isEvent: true, countAsPitch: isBalkWithPitch || undefined, runners: { ...gameState.runners }, outs: gameState.outs }]);
        setGameState(prev => {
          const newRunners = { ...prev.runners }, newRuns = { ...prev.runs };
          if (advanceData.to !== 'same') { newRunners[advanceData.runner] = false; if (advanceData.to !== 'home') newRunners[advanceData.to] = true; }
          if (advanceData.to === 'home') { const team = prev.isTop ? 'top' : 'bottom'; const newRunsArray = ensureRunArray(newRuns[team], prev.inning); newRunsArray[prev.inning - 1] = (newRunsArray[prev.inning - 1] || 0) + 1; newRuns[team] = newRunsArray; }
          return { ...prev, runners: newRunners, runs: newRuns };
        });
        setShowAdvanceModal(false); setAdvanceData({ runner: '', reason: '', to: '', countAsPitch: null });
      };

      const handleOutRunnerRecord = () => {
        if (!outRunnerData.runner || !outRunnerData.reason) { showToast("走者を選択してください", "error"); return; }
        recordAction();
        const runnerName = outRunnerData.runner === 'first' ? '1塁走者' : outRunnerData.runner === 'second' ? '2塁走者' : '3塁走者';
        const currentBatterIndex = (gameState.isTop ? gameState.batterTop : gameState.batterBottom) - 1;
        const currentPitcherObj = lineups[gameState.isTop ? 'bottom' : 'top'].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①') || { name: '投手未設定', throws: '右' };
        const currentBatterObj = lineups[gameState.isTop ? 'top' : 'bottom'][currentBatterIndex] || { name: '打者未設定', bats: '右' };
        setPitches([...pitches, { course: null, type: '-', result: `${runnerName}が${outRunnerData.reason}`, inning: gameState.inning, isTop: gameState.isTop, batter: currentBatterIndex + 1, pitchNumber: '-', pitcherName: currentPitcherObj.name, pitcherThrows: currentPitcherObj.throws, batterName: currentBatterObj.name, batterBats: currentBatterObj.bats, isEvent: true, runners: { ...gameState.runners }, outs: gameState.outs }]);
        setGameState(prev => {
          let newOuts = prev.outs + 1, newRunners = { ...prev.runners, [outRunnerData.runner]: false }, newInning = prev.inning, newIsTop = prev.isTop;
          if (newOuts >= 3) { newOuts = 0; newRunners = { first: false, second: false, third: false }; if (prev.isTop) newIsTop = false; else { newIsTop = true; newInning++; } }
          const isChange = newOuts === 0 && prev.outs + 1 >= 3;
          return { ...prev, outs: newOuts, inning: newInning, isTop: newIsTop, runners: newRunners, balls: isChange ? 0 : prev.balls, strikes: isChange ? 0 : prev.strikes };
        });
        setShowOutRunnerModal(false); setOutRunnerData({ runner: '', reason: '盗塁死' });
      };

      const handleFurinigeResult = (type) => {
        setShowFurinigeModal(false);
        if (type === '三振') {
          handleAdvanceAndNextBatter('out', 1);
        } else if (type === 'セーフ') {
          setPitches(prev => { const np = [...prev]; if (np.length > 0) np[np.length - 1] = { ...np[np.length - 1], result: '振り逃げ' }; return np; });
          handleAdvanceAndNextBatter('error', 0);
        } else {
          setPitches(prev => { const np = [...prev]; if (np.length > 0) np[np.length - 1] = { ...np[np.length - 1], result: '振り逃げアウト' }; return np; });
          handleAdvanceAndNextBatter('out', 1);
        }
      };

      // 交代モーダルを開く(insertIndex を渡すと、その記録の直前へさかのぼって挿入するモードになる)
      const openSubstitutionModal = (insertIndex = null, overrides = {}) => {
        const team = overrides.team || (gameState.isTop ? 'top' : 'bottom');
        setSubData({
          team, type: '代打', order: gameState.isTop ? gameState.batterTop : gameState.batterBottom,
          newName: '', newPos: '打', newThrows: '右', newBats: '右', shiftOrder: null, shiftNewPos: '',
          insertIndex, ...overrides
        });
        setShowSubstitutionModal(true);
      };

      // 記録修正画面から「この記録の直前」に交代を挿入する
      const openRetroSubstitution = (index) => {
        const target = pitches[index];
        const team = target ? (target.isTop ? 'top' : 'bottom') : (gameState.isTop ? 'top' : 'bottom');
        setShowRecordEditor(false);
        openSubstitutionModal(index, { team, order: target?.batter || 1 });
      };

      // 交代モーダルが対象とするオーダー(さかのぼり時はその場面のオーダーを記録から復元)
      const subLineup = useMemo(() => {
        const base = lineups[subData.team] || [];
        if (subData.insertIndex === null || subData.insertIndex === undefined) return base;
        return lineupSnapshotAt(pitches, subData.insertIndex, base, subData.team);
      }, [lineups, pitches, subData.team, subData.insertIndex]);

      // 選手交代実行
      const handleSubstitution = () => {
        const { team, type, order, newName, newPos, newThrows, newBats, shiftOrder, shiftNewPos, insertIndex } = subData;
        // 位置変更は選手が入れ替わらず守備位置だけを動かす(入る選手の入力は不要)
        const positionOnly = type === POSITION_CHANGE_TYPE;
        const targetIndex = order - 1;
        const baseLineup = subLineup;
        const oldPlayer = baseLineup[targetIndex] || { name: '不明' };
        if (positionOnly) {
          if (!oldPlayer.name || isPlaceholderName(oldPlayer.name)) { showToast('動かす選手を選んでください', 'error'); return; }
          if (oldPlayer.pos === newPos && !shiftOrder) { showToast('今と違う守備位置を選んでください', 'error'); return; }
        } else if (!newName.trim()) { showToast('新しい選手名を入力してください', 'error'); return; }
        recordAction();

        const shiftPlayer = shiftOrder ? baseLineup[shiftOrder - 1] : null;
        const shift = shiftOrder ? { order: shiftOrder, name: shiftPlayer?.name || '?', toPos: shiftNewPos, throws: shiftPlayer?.throws } : null;
        const newPlayer = positionOnly
          ? { name: oldPlayer.name, pos: newPos, throws: oldPlayer.throws || newThrows, bats: oldPlayer.bats || newBats }
          : { name: newName.trim(), pos: newPos, throws: newThrows, bats: newBats };

        if (insertIndex !== null && insertIndex !== undefined) {
          // さかのぼって挿入: 交代イベントを差し込み、それ以降の記録の選手名も書き換える
          const oldPitcher = findPitcherAt(pitches, insertIndex, team, lineups[team].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①'));
          const res = insertSubstitution(pitches, insertIndex, {
            side: team, type, order,
            oldPlayer: { name: oldPlayer.name, pos: oldPlayer.pos },
            newPlayer, shift, oldPitcherName: oldPitcher?.name || null, positionOnly
          });
          setPitches(renumberPitchNumbers(res.records));
          // 現在のオーダーにまだ退いた選手が残っていれば(=以降に別の交代が無ければ)ここも差し替える
          const applied = applySubstitutionToLineup(lineups[team], { order, oldPlayer, newPlayer, shift });
          if (applied.applied) setLineups(prev => ({ ...prev, [team]: dropBenchEntry(applied.lineup, newPlayer.name) }));
          setShowSubstitutionModal(false);
          const changed = res.battingUpdated + res.pitchingUpdated;
          const label = positionOnly ? `${oldPlayer.name} ${oldPlayer.pos || '?'}→${newPos}` : newPlayer.name;
          showToast(changed > 0 ? `${type}: ${label} を挿入し、以降の記録${changed}件を書き換えました` : `${type}: ${label} を挿入しました`);
          return;
        }

        // ラインナップの更新（退く選手 → 新選手）
        const currentLineup = [...lineups[team]];
        currentLineup[targetIndex] = { ...oldPlayer, ...newPlayer };
        // ポジション移動がある場合（例: ショートがサードへ）
        if (shift) currentLineup[shift.order - 1] = { ...currentLineup[shift.order - 1], pos: shiftNewPos };
        // 控え欄から出場した選手はオーダーに二重で並ばないよう控え欄から外す
        setLineups(prev => ({ ...prev, [team]: dropBenchEntry(currentLineup, newPlayer.name) }));

        // イベントとして履歴に記録
        const eventText = buildSubstitutionEventText({ order, oldPos: oldPlayer.pos, oldName: oldPlayer.name, newPos, newName: newPlayer.name, type, shift, positionOnly });

        const dummyPitcher = lineups[gameState.isTop ? 'bottom' : 'top'].find(p => p.pos === '投' || p.pos === '1' || p.pos === '①') || { name: '投手未設定', throws: '右' };
        const dummyBatterIndex = (gameState.isTop ? gameState.batterTop : gameState.batterBottom) - 1;
        const dummyBatter = lineups[gameState.isTop ? 'top' : 'bottom'][dummyBatterIndex] || { name: '打者未設定', bats: '右' };

        setPitches(prev => [...prev, {
          course: null, type: '-', result: eventText, inning: gameState.inning, isTop: gameState.isTop,
          batter: dummyBatterIndex + 1, pitchNumber: '-', pitcherName: dummyPitcher.name, pitcherThrows: dummyPitcher.throws,
          batterName: dummyBatter.name, batterBats: dummyBatter.bats, isEvent: true,
          runners: { ...gameState.runners }, outs: gameState.outs
        }]);

        setShowSubstitutionModal(false);
        showToast(positionOnly ? `${type}: ${oldPlayer.name} ${oldPlayer.pos || '?'}→${newPos}` : `${type}: ${newPlayer.name} を登録しました`);
      };

      const handleEditPitchClick = (pitch) => { const globalIndex = pitches.indexOf(pitch); if (globalIndex !== -1) { setEditingPitchIndex(globalIndex); setEditPitchData({ ...pitch, runners: pitch.runners || { first: false, second: false, third: false } }); } };
      const savePitchEdit = () => {
        recordAction();
        const orig = pitches[editingPitchIndex];
        const { applyBatterToAtBat, ...edited } = editPitchData;
        let newPitches = [...pitches];
        // 打者以外の修正を先に反映し、打順の変更は付け替え処理(球数の振り直し込み)で行う
        newPitches[editingPitchIndex] = { ...edited, batter: orig.batter, batterName: orig.batterName, batterBats: orig.batterBats, batterThrows: orig.batterThrows, batterPos: orig.batterPos };
        if (!orig.isEvent && edited.batter !== orig.batter) {
          newPitches = reassignPitchBatter(newPitches, editingPitchIndex, edited.batter, { name: edited.batterName, bats: edited.batterBats, throws: edited.batterThrows, pos: edited.batterPos }, applyBatterToAtBat !== false);
        } else {
          newPitches = renumberPitchNumbers(newPitches);
        }
        setPitches(newPitches);
        setGameState(rebuildGameStateFromPitches(newPitches));
        setEditingPitchIndex(null);
        setEditPitchData(null);
      };
      const cancelPitchEdit = () => { setEditingPitchIndex(null); setEditPitchData(null); };
      const toggleEditRunner = (base) => { setEditPitchData(prev => ({ ...prev, runners: { ...prev.runners, [base]: !prev.runners[base] } })); };

      const deletePitchRecord = () => {
        setConfirmDialog({
          title: '🗑️ 記録の削除', message: 'この記録を削除しますか？', subMessage: '※ランナーやアウト数を履歴から再計算します。', isDanger: true,
          onConfirm: () => {
            recordAction();
            const newPitches = [...pitches]; newPitches.splice(editingPitchIndex, 1);
            const renumbered = renumberPitchNumbers(newPitches);
            setPitches(renumbered); setGameState(rebuildGameStateFromPitches(renumbered)); setEditingPitchIndex(null); setEditPitchData(null); setConfirmDialog(null); showToast("記録を削除しました");
          }
        });
      };

      const applyLineupToPast = () => {
        setConfirmDialog({
          title: '💡 過去の記録に一括反映', message: `現在表示している【${gameState.inning}回${gameState.isTop?'表':'裏'}】以降のすべての記録を現在のオーダーで書き換えますか？`, isDanger: false,
          onConfirm: () => {
            recordAction();
            const newPitches = pitches.map(p => {
              let isAfter = p.inning > gameState.inning || (p.inning === gameState.inning && (gameState.isTop || (!gameState.isTop && !p.isTop)));
              if (isAfter) {
                const batterObj = (p.isTop ? lineups.top : lineups.bottom)[p.batter - 1] || { name: '打者未設定', bats: '右' };
                const pitcherObj = (p.isTop ? lineups.bottom : lineups.top).find(pl => pl.pos === '投' || pl.pos === '1' || pl.pos === '①') || { name: '投手未設定', throws: '右' };
                return { ...p, batterName: batterObj.name, batterBats: batterObj.bats, pitcherName: pitcherObj.name, pitcherThrows: pitcherObj.throws };
              }
              return p;
            });
            setPitches(newPitches); setConfirmDialog(null); showToast(`記録を上書きしました！`); setShowSettings(false);
          }
        });
      };

      const handleShareData = (type) => {
        let data, shareType;
        if (type === 'teams') { data = registeredTeams; shareType = 'teams'; }
        else if (type === 'all') { data = { teams: registeredTeams, games: savedGames }; shareType = 'games'; }
        else if (typeof type === 'string' && type.startsWith('game:')) {
          const gameId = type.replace('game:', ''); const game = savedGames.find(g => g.id === gameId);
          if (!game) { showToast('試合が見つかりません', 'error'); return; }
          data = game; shareType = 'game1';
        }
        setShareTextData(`BASEBALL_SHARE:${shareType}:${compressData(data)}`); setShowShareModal(true);
      };

      const handleImportText = () => {
        if (isScorerGdf(importText)) { importScorerGdf(importText); return; }
        if (!importText || !importText.startsWith('BASEBALL_SHARE:')) { showToast('無効なテキストです。', 'error'); return; }
        const parts = importText.split(':');
        if (parts.length < 3) { showToast('データ形式が不正です', 'error'); return; }
        const incoming = decompressData(importText.substring(`BASEBALL_SHARE:${parts[1]}:`.length));
        if (!incoming) { showToast('復元に失敗しました', 'error'); return; }
        if (parts[1] === 'teams') {
          if (Array.isArray(incoming)) { setRegisteredTeams(prev => { const names = prev.map(t => t.name); return [...prev, ...incoming.filter(t => !names.includes(t.name))]; }); showToast(`${incoming.length}チームを受信しました！`); }
        } else if (parts[1] === 'games') {
          if (incoming.teams) setRegisteredTeams(prev => { const names = prev.map(t => t.name); return [...prev, ...incoming.teams.filter(t => !names.includes(t.name))]; });
          if (incoming.games) setSavedGames(prev => { const ids = prev.map(g => g.id); return [...prev, ...incoming.games.filter(g => !ids.includes(g.id))]; });
          showToast(`データを受信しました！`);
        } else if (parts[1] === 'game1') {
          if (incoming.id) { setSavedGames(prev => prev.some(g => g.id === incoming.id) ? prev : [incoming, ...prev]); showToast(`試合を受信しました！`); }
        }
        setShowImportTextModal(false); setImportText('');
      };

      const exportCSV = () => {
        const rows = pitches.map(p => [p.inning, p.isTop ? '表' : '裏', p.pitcherName, p.pitcherThrows, p.batterName, p.batterBats, p.pitchNumber, p.type, p.course !== null ? p.course : '', p.result, p.isEvent ? 'イベント' : ''].join(','));
        const link = document.createElement("a"); link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8,\uFEFF" + ["回,表裏,投手,投,打者,打,球数,球種,コース,結果,備考", ...rows].join('\n'))); link.setAttribute("download", `試合データ_${gameInfo.date}.csv`); link.click();
      };

      const copyForAI = () => {
        let text = `あなたはプロの野球データアナリストです。以下の試合データを分析し、相手チームの特徴と攻略法を提案してください。\n\n【試合】${gameInfo.date} ${gameInfo.teamTop} ${gameState.runs.top.reduce((a,b)=>a+b,0)} - ${gameState.runs.bottom.reduce((a,b)=>a+b,0)} ${gameInfo.teamBottom}\n\n【全プレー】\n`;
        pitches.forEach(p => text += `${p.inning}回${p.isTop?'表':'裏'}, 投:${p.pitcherName}, 打:${p.batterName}(${p.batterBats}), ${p.pitchNumber}球目, ${p.type||'-'}, コース:${p.course!==null?p.course:'-'}, ${p.result}\n`);
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('AI分析用データをコピーしました！');
      };

      const exportData = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ gameState, gameInfo, lineups, pitches })], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `配球データ_${gameInfo.date}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); showToast('ファイルを保存しました！');
      };

      // スコアラーアプリ(GDF形式)の試合データをアーカイブへ取り込む
      const importScorerGdf = (text) => {
        try {
          const { savedGame, warnings } = convertScorerGame(text);
          if (warnings.length > 0) console.warn('スコアラー取込の注意点:\n' + warnings.join('\n'));
          const exists = savedGames.some(g => g.id === savedGame.id);
          setSavedGames(prev => exists ? prev.map(g => g.id === savedGame.id ? savedGame : g) : [savedGame, ...prev]);
          showToast(`スコアラーの試合を${exists ? '更新' : '取り込み'}ました: ${savedGame.teamTop} ${savedGame.scoreTop}-${savedGame.scoreBottom} ${savedGame.teamBottom}${warnings.length > 0 ? ` (注意${warnings.length}件はコンソール参照)` : ''}`);
          setShowExport(false); setShowImportTextModal(false); setImportText('');
          setShowArchiveModal(true);
          return true;
        } catch (err) {
          console.error('スコアラー取込に失敗:', err);
          showToast('スコアラーデータの解析に失敗しました', 'error');
          return false;
        }
      };

      const importData = (event) => {
        const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
        reader.onload = (e) => {
          try {
            if (isScorerGdf(e.target.result)) { importScorerGdf(e.target.result); return; }
            const data = JSON.parse(e.target.result);
            if (data.gameState && data.lineups && data.pitches) {
              setGameState(normalizeGameState(data.gameState)); setGameInfo(data.gameInfo || { date: new Date().toLocaleDateString('ja-JP').replace(/\//g, '-'), teamTop: '先攻チーム', teamBottom: '後攻チーム' }); setLineups(data.lineups); setPitches(data.pitches);
              setUndoStack([]); setRedoStack([]); showToast('データを復元しました！'); setShowArchiveModal(false); setShowExport(false);
            } else showToast('無効なデータ形式です。', 'error');
          } catch (error) { showToast('読み込みに失敗しました。', 'error'); }
        };
        reader.readAsText(file);
      };

      const handlePrintDashboard = () => {
        if (!advancedStats) return;
        const ok = window.generatePdfReport({
          gameInfo,
          gameState,
          advancedStats,
          analystInsights,
          pitches,
          hitsAndErrors,
          playByPlay: playByPlayData,
        });
        if (!ok) showToast('ポップアップをブロックしていると印刷できません', 'error');
      };

      const handleScorebookPrint = () => {
        const scorebook = buildScorebookData(pitches, lineups, gameInfo, gameState);
        const ok = window.generateScorebookReport({ scorebook, gameInfo, gameState, options: scorebookPrintOptions });
        if (!ok) showToast('ポップアップをブロックしていると印刷できません', 'error');
      };

      const copyShareText = () => {
        try {
          const topTotal = gameState.runs.top.reduce((a,b)=>a+b,0), bottomTotal = gameState.runs.bottom.reduce((a,b)=>a+b,0);
          let text = `【結果】${gameInfo.date} ${gameInfo.teamTop} ${topTotal} - ${bottomTotal} ${gameInfo.teamBottom}\n\n`;
          let pStats = {}, bStats = { top: {}, bottom: {} };
          lineups.top.forEach((p, i) => bStats.top[i+1] = { name: p.name, pos: p.pos, res: [] });
          lineups.bottom.forEach((p, i) => bStats.bottom[i+1] = { name: p.name, pos: p.pos, res: [] });
          const abs = {};
          pitches.forEach(p => { if (!p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result))) { const pName = p.pitcherName || '不明'; if (!pStats[pName]) pStats[pName] = { p: 0, k: 0, bb: 0, h: 0 }; pStats[pName].p++; } const key = `${p.inning}-${p.isTop}-${p.batter}`; if (!abs[key]) abs[key] = []; abs[key].push(p); });
          Object.values(abs).forEach(ab => {
            const noEv = ab.filter(p => !p.isEvent); if (noEv.length === 0) return;
            const last = noEv[noEv.length-1]; const pName = last.pitcherName || '不明'; if (!pStats[pName]) pStats[pName] = { p: 0, k: 0, bb: 0, h: 0 };
            let s=0, b=0; noEv.forEach(p => { if(['ボール','ウエスト'].includes(p.result)) b++; else if(['ストライク','空振り','バント空振り'].includes(p.result)) s++; else if(['ファウル','バントファウル'].includes(p.result)&&s<2) s++; });
            const res = last.result; let finalRes = res;
            if (['安','塁打','本塁打'].some(w=>res.includes(w))) { pStats[pName].h++; }
            else if (['死球','四球','ウエスト'].includes(res) || b>=4) { pStats[pName].bb++; finalRes = res==='死球'?'死球':'四球'; }
            else if (res==='三振' || res==='スリーバント失敗' || res==='振り逃げ' || res==='振り逃げアウト' || s>=3) { pStats[pName].k++; finalRes = res==='スリーバント失敗'?'スリーバント失敗':res==='振り逃げ'?'振り逃げ':res==='振り逃げアウト'?'振り逃げアウト':'三振'; }
            if (!(finalRes?.startsWith('牽制') || finalRes === '盗塁死')) { const tk = last.isTop ? 'top' : 'bottom'; if(bStats[tk][last.batter]) bStats[tk][last.batter].res.push(finalRes); }
          });
          text += `【投手】\n`; Object.entries(pStats).forEach(([n, s]) => text += `${n}: ${s.p}球 / 奪三振${s.k} / 与四死${s.bb} / 被安打${s.h}\n`);
          text += `\n【打席: ${gameInfo.teamTop}】\n`; Object.entries(bStats.top).forEach(([o, b]) => text += `${o}番(${b.pos}) ${b.name}: ${b.res.length>0?b.res.join('、'):'-'}\n`);
          text += `\n【打席: ${gameInfo.teamBottom}】\n`; Object.entries(bStats.bottom).forEach(([o, b]) => text += `${o}番(${b.pos}) ${b.name}: ${b.res.length>0?b.res.join('、'):'-'}\n`);
          const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          showToast('結果をコピーしました！');
        } catch (e) { showToast('コピーに失敗しました', 'error'); }
      };

      // --- 分析用データ ---
      const pitchesWithCountState = useMemo(() => {
         const result = []; let currentAbKey = null, b = 0, s = 0;
         pitches.forEach(p => {
             if (p.isEvent || p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)) { result.push({...p, countState: 'even'}); return; }
             const key = `${p.inning}-${p.isTop}-${p.batter}`;
             if (currentAbKey !== key) { currentAbKey = key; b = 0; s = 0; }
             let countState = 'even'; if (s > b) countState = 'ahead'; else if (b > s) countState = 'behind';
             result.push({...p, countState});
             if (['ボール','ウエスト'].includes(p.result)) b++; else if (['ストライク','空振り','バント空振り'].includes(p.result)) s++; else if (['ファウル','バントファウル'].includes(p.result) && s < 2) s++;
         });
         return result;
      }, [pitches]);

      const analysisData = useMemo(() => {
        const valid = pitchesWithCountState.filter(p => !p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)) && (analysisFilter.pitcher === 'ALL' || p.pitcherName === analysisFilter.pitcher) && (analysisFilter.batterSide === 'ALL' || p.batterBats === analysisFilter.batterSide));
        const makeBucket = () => ({ all: {}, ahead: {}, even: {}, behind: {}, max: {all:0, ahead:0, even:0, behind:0} });
        const heatmaps = { all: makeBucket(), fastball: makeBucket(), breaking: makeBucket() };
        const pitchTypeHeatmaps = {};
        const typeCount = {};
        valid.forEach(p => {
          if (p.course !== null) {
            const c = p.course, cs = p.countState, isFast = p.type && (p.type.includes('ストレート') || p.type.includes('シュート'));
            const tk = isFast ? 'fastball' : 'breaking', nt = p.type ? p.type.replace(/系$/, '') : '不明';
            [heatmaps.all, heatmaps[tk]].forEach(b => {
              b.all[c] = (b.all[c] || 0) + 1; if (b.all[c] > b.max.all) b.max.all = b.all[c];
              b[cs][c] = (b[cs][c] || 0) + 1; if (b[cs][c] > b.max[cs]) b.max[cs] = b[cs][c];
            });
            if (!pitchTypeHeatmaps[nt]) pitchTypeHeatmaps[nt] = makeBucket();
            const ptb = pitchTypeHeatmaps[nt];
            ptb.all[c] = (ptb.all[c] || 0) + 1; if (ptb.all[c] > ptb.max.all) ptb.max.all = ptb.all[c];
            ptb[cs][c] = (ptb[cs][c] || 0) + 1; if (ptb[cs][c] > ptb.max[cs]) ptb.max[cs] = ptb[cs][c];
          }
          const nt = p.type ? p.type.replace(/系$/, '') : '不明'; typeCount[nt] = (typeCount[nt] || 0) + 1;
        });
        const strikeRate = valid.length === 0 ? 0 : Math.round((valid.filter(p => p.result !== 'ボール' && p.result !== 'ウエスト').length / valid.length) * 100);
        return { heatmaps, pitchTypeHeatmaps, typeCount, strikeRate, totalPitches: valid.length };
      }, [pitchesWithCountState, analysisFilter]);

      const advancedStats = useMemo(() => {
        if (!showPostGameAnalysis) return null;
        const sprayCoordMap = {
          '左翼線':{x:30,y:85,out:true},'レフト':{x:60,y:70,out:true},'左中間':{x:90,y:55,out:true},
          'センター':{x:120,y:50,out:true},'右中間':{x:150,y:55,out:true},'ライト':{x:180,y:70,out:true},'右翼線':{x:210,y:85,out:true},
          '三遊間':{x:80,y:125,out:false},'ショート':{x:95,y:115,out:false},'二遊間':{x:120,y:105,out:false},
          'セカンド':{x:145,y:115,out:false},'一二間':{x:160,y:125,out:false},
          'サード':{x:88,y:138,out:false},'ピッチャー':{x:120,y:135,out:false},'ファースト':{x:152,y:138,out:false},'キャッチャー':{x:120,y:178,out:false}
        };
        const getSprayPosition = (res) => {
          let basePos = null;
          if (res.includes('サード➡') || res.includes('ショート⬅')) basePos = sprayCoordMap['三遊間'];
          else if (res.includes('ショート➡') || res.includes('セカンド⬅')) basePos = sprayCoordMap['二遊間'];
          else if (res.includes('セカンド➡') || res.includes('ファースト⬅')) basePos = sprayCoordMap['一二間'];
          else if (res.includes('左ファウル')) basePos = {x:40, y:150, out:false};
          else if (res.includes('右ファウル')) basePos = {x:200, y:150, out:false};
          else { for(const [k,v] of Object.entries(sprayCoordMap)){ if(res.includes(k)) { basePos = v; break; } } }
          if(!basePos) { if(res.match(/左/)) basePos = sprayCoordMap['レフト']; else if(res.match(/右/)) basePos = sprayCoordMap['ライト']; else if(res.match(/中/)) basePos = sprayCoordMap['センター']; }
          if(!basePos) return null;
          let scale = 1.0; const hx = 120, hy = 185, isOut = basePos.out;
          if (res.includes('本塁打')) scale = isOut ? 1.3 : 2.2; else if (res.includes('三塁打') || res.includes('二塁打')) scale = isOut ? 1.15 : 1.8; else if (res.includes('安')) scale = isOut ? 0.9 : 1.4;
          let tx = hx + (basePos.x - hx) * scale, ty = hy + (basePos.y - hy) * scale;
          tx = Math.max(10, Math.min(230, tx)); ty = Math.max(10, Math.min(190, ty));
          return { x: tx, y: ty };
        };
        const getSprayResultType = (res) => ['安','塁打','本塁打'].some(w=>res.includes(w))?'hit':['エラー','野手選択'].some(w=>res.includes(w))?'error':res.includes('ファウル')?'foul':'out';
        const getBallFlight = (res) => res.includes('本塁打')?'hr':['ゴロ','併殺打','バント'].some(w=>res.includes(w))?'grounder':['直','ライナー','安','二塁打','三塁打'].some(w=>res.includes(w))?'liner':'fly';
        const calcBatting = (isTopQuery) => {
          const teamPitches = pitchesWithCountState.filter(p => p.isTop === isTopQuery && !p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)));
          const abs = []; let currentAb = [];
          teamPitches.forEach(p => { if (p.pitchNumber === 1 && currentAb.length > 0) { abs.push(currentAb); currentAb = []; } currentAb.push(p); });
          if (currentAb.length > 0) abs.push(currentAb);
          const teamStats = { PA:0, AB:0, H:0, TB:0, BB_HBP:0, K:0, sprayHits: [] };
          const playerStats = {};
          (isTopQuery?lineups.top:lineups.bottom).forEach((p,i) => playerStats[`${i+1}-${p.name}`] = { order: i+1, name: p.name, pos: p.pos, throws: p.throws, bats: p.bats, posSeq: [], PA:0, AB:0, H:0, TB:0, BB_HBP:0, K:0, results: [], sprayHits: [], atBats: [] });
          abs.forEach(ab => {
            const lastPitch = ab[ab.length - 1]; if (!lastPitch) return;
            const bKey = `${lastPitch.batter}-${lastPitch.batterName}`;
            if (!playerStats[bKey]) playerStats[bKey] = { order: lastPitch.batter, name: lastPitch.batterName, pos: '途中', throws: lastPitch.batterThrows, bats: lastPitch.batterBats, posSeq: [], PA:0, AB:0, H:0, TB:0, BB_HBP:0, K:0, results: [], sprayHits: [], atBats: [] };
            const pStat = playerStats[bKey], res = lastPitch.result;
            if (lastPitch.batterPos) pStat.posSeq.push(lastPitch.batterPos);
            teamStats.PA++; pStat.PA++;
            let s=0, b=0; ab.forEach(p => { if(['ボール','ウエスト'].includes(p.result)) b++; else if(['ストライク','空振り','バント空振り'].includes(p.result)) s++; else if(['ファウル','バントファウル'].includes(p.result)&&s<2) s++; });
            const isHitPlay = ['安','塁打','本塁打'].some(w=>res.includes(w));
            let isAB = true, tbAdded = 0;
            if (isHitPlay) { teamStats.H++; pStat.H++; tbAdded = res.includes('二塁打')?2:res.includes('三塁打')?3:res.includes('本塁打')?4:1; teamStats.TB+=tbAdded; pStat.TB+=tbAdded; }
            else if (['死球','四球','ウエスト'].includes(res)||b>=4) { teamStats.BB_HBP++; pStat.BB_HBP++; isAB = false; }
            else if (['犠打','犠飛'].some(w=>res.includes(w))) { isAB = false; }
            else if (res==='三振'||res==='スリーバント失敗'||res==='振り逃げ'||res==='振り逃げアウト'||s>=3) { teamStats.K++; pStat.K++; }
            if (isAB) { teamStats.AB++; pStat.AB++; }
            let sprayHit = null;
            if (isHitPlay || ['ゴロ','飛','直','エラー','バント'].some(w=>res.includes(w))) {
              let sp = { x: 120, y: 100 };
              if (lastPitch.hitX !== undefined && lastPitch.hitY !== undefined) { sp = { x: lastPitch.hitX, y: lastPitch.hitY }; } else { sp = getSprayPosition(res) || { x: 120, y: 100 }; }
              const sEnt = { x: sp.x, y: sp.y, type: getSprayResultType(res), flight: getBallFlight(res), result: res, isManual: lastPitch.hitX !== undefined };
              sprayHit = sEnt;
              teamStats.sprayHits.push(sEnt); pStat.sprayHits.push(sEnt);
            }
            if (!(res?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(res))) pStat.results.push(res);
            if (!pStat.atBats) pStat.atBats = [];
            pStat.atBats.push({ pitches: ab, result: res, inning: lastPitch.inning, isTop: lastPitch.isTop, sprayHit });
          });
          const calcRates = (st) => ({ AVG: st.AB>0?(st.H/st.AB).toFixed(3).replace(/^0/, ''):'.000', OPS: ((st.AB>0?st.TB/st.AB:0) + (st.PA>0?(st.H+st.BB_HBP)/st.PA:0)).toFixed(3).replace(/^0/, ''), KPct: st.PA>0?Math.round((st.K/st.PA)*100):0, BBPct: st.PA>0?Math.round((st.BB_HBP/st.PA)*100):0 });
          Object.assign(teamStats, calcRates(teamStats));
          const playersArray = Object.values(playerStats).map(p => {
            // 守備位置: 各打席時点の位置から、連続重複を除いて「投→捕」のように変遷表示。記録が無い場合は現ラインナップの位置にフォールバック。
            const seq = (p.posSeq || []).filter(Boolean).filter((v, i, a) => i === 0 || a[i - 1] !== v);
            const pos = seq.length ? seq.join('→') : p.pos;
            return {...p, ...calcRates(p), pos};
          }).sort((a,b) => a.order - b.order);
          return { team: teamStats, players: playersArray };
        };
        const calcTeamPitching = (isTopQuery) => {
          const vP = pitchesWithCountState.filter(p => p.isTop === isTopQuery && !p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)));
          const pStats = {};
          vP.forEach(p => {
              const pName = p.pitcherName || '不明';
              if (!pStats[pName]) pStats[pName] = { name: pName, total: 0, calledStrikes: 0, whiffs: 0, swings: 0, strikes: 0, firstPitches: 0, firstStrikes: 0, PA: 0, H: 0, K: 0, BB: 0, throws: p.pitcherThrows || '右', typeStats: {},
                  heatmaps: { fastball: { all: {}, ahead: {}, even: {}, behind: {}, max: {all:0, ahead:0, even:0, behind:0} }, breaking: { all: {}, ahead: {}, even: {}, behind: {}, max: {all:0, ahead:0, even:0, behind:0} } },
                  pitchTypeHeatmaps: {},
                  counts: { vsRight: { ahead: { total: 0, strikes: 0, types: {} }, even: { total: 0, strikes: 0, types: {} }, behind: { total: 0, strikes: 0, types: {} } }, vsLeft: { ahead: { total: 0, strikes: 0, types: {} }, even: { total: 0, strikes: 0, types: {} }, behind: { total: 0, strikes: 0, types: {} } } },
                  sideStats: { right: { total:0, strikes:0, PA:0, AB:0, H:0, K:0, BB:0 }, left: { total:0, strikes:0, PA:0, AB:0, H:0, K:0, BB:0 } },
                  orderStats: { top: { total:0, strikes:0, PA:0, AB:0, H:0, K:0, BB:0 }, bottom: { total:0, strikes:0, PA:0, AB:0, H:0, K:0, BB:0 } }
              };
          });
          const abArr = []; let cAb = [];
          vP.forEach(p => { if (p.pitchNumber === 1 && cAb.length > 0) { abArr.push(cAb); cAb = []; } cAb.push(p); });
          if (cAb.length > 0) abArr.push(cAb);
          abArr.forEach(ab => {
            ab.forEach(p => {
              const st = pStats[p.pitcherName || '不明']; st.total++;
              const type = p.type ? p.type.replace(/系$/, '') : '不明';
              if (!st.typeStats[type]) st.typeStats[type] = { total: 0, calledStrikes: 0, whiffs: 0, swings: 0, strikes: 0 };
              const tSt = st.typeStats[type]; tSt.total++;
              const batterSide = p.batterBats === '左' ? 'vsLeft' : 'vsRight';
              const countState = p.countState || 'even';
              const targetCountObj = st.counts[batterSide][countState];
              targetCountObj.total++;
              if (!targetCountObj.types[type]) targetCountObj.types[type] = 0;
              targetCountObj.types[type]++;
              if (!['ボール','ウエスト','死球'].includes(p.result)) { st.strikes++; tSt.strikes++; targetCountObj.strikes++; }
              const _sideKey = p.batterBats === '左' ? 'left' : 'right';
              const _orderKey = (p.batter >= 1 && p.batter <= 5) ? 'top' : 'bottom';
              st.sideStats[_sideKey].total++;
              st.orderStats[_orderKey].total++;
              if (!['ボール','ウエスト','死球'].includes(p.result)) { st.sideStats[_sideKey].strikes++; st.orderStats[_orderKey].strikes++; }
              let isSwing = false, isStrike = false;
              if (p.result.includes('見逃し') || p.result === 'ストライク') { st.calledStrikes++; tSt.calledStrikes++; isStrike = true; }
              else if (p.result.includes('空振り') || p.result === 'バント空振り') { st.whiffs++; tSt.whiffs++; isSwing = true; isStrike = true; }
              else if (['ファウル','バントファウル','スリーバント失敗','インプレー','バント','ゴロ','飛','安','塁打','エラー','犠','直'].some(w => p.result.includes(w))) { isSwing = true; isStrike = true; }
              if (isSwing) { st.swings++; tSt.swings++; }
              if (p.pitchNumber === 1) { st.firstPitches++; if (isStrike) st.firstStrikes++; }
              if (p.course !== null) {
                 const isFast = p.type && (p.type.includes('ストレート') || p.type.includes('シュート'));
                 const typeKey = isFast ? 'fastball' : 'breaking';
                 st.heatmaps[typeKey].all[p.course] = (st.heatmaps[typeKey].all[p.course] || 0) + 1;
                 if (st.heatmaps[typeKey].all[p.course] > st.heatmaps[typeKey].max.all) st.heatmaps[typeKey].max.all = st.heatmaps[typeKey].all[p.course];
                 st.heatmaps[typeKey][countState][p.course] = (st.heatmaps[typeKey][countState][p.course] || 0) + 1;
                 if (st.heatmaps[typeKey][countState][p.course] > st.heatmaps[typeKey].max[countState]) st.heatmaps[typeKey].max[countState] = st.heatmaps[typeKey][countState][p.course];
                 if (!st.pitchTypeHeatmaps[type]) st.pitchTypeHeatmaps[type] = { all: {}, ahead: {}, even: {}, behind: {}, max: {all:0, ahead:0, even:0, behind:0} };
                 const ptH = st.pitchTypeHeatmaps[type];
                 ptH.all[p.course] = (ptH.all[p.course] || 0) + 1; if (ptH.all[p.course] > ptH.max.all) ptH.max.all = ptH.all[p.course];
                 ptH[countState][p.course] = (ptH[countState][p.course] || 0) + 1; if (ptH[countState][p.course] > ptH.max[countState]) ptH.max[countState] = ptH[countState][p.course];
              }
            });
            const lastP = ab[ab.length - 1]; if (!lastP) return;
            const st = pStats[lastP.pitcherName || '不明'];
            st.PA++; const res = lastP.result;
            let fB=0, fS=0; ab.forEach(p => { if(['ボール','ウエスト'].includes(p.result)) fB++; else if(['ストライク','空振り','バント空振り'].includes(p.result)) fS++; else if(['ファウル','バントファウル'].includes(p.result)&&fS<2) fS++; });
            const _isH = ['安','塁打','本塁打'].some(w=>res.includes(w));
            const _isBB = ['死球','四球','ウエスト'].includes(res) || fB>=4;
            const _isK = res==='三振' || res==='スリーバント失敗' || res==='振り逃げ' || res==='振り逃げアウト' || fS>=3;
            const _isSac = ['犠打','犠飛'].some(w=>res.includes(w));
            if (_isH) st.H++; else if (_isBB) st.BB++; else if (_isK) st.K++;
            const _abSide = lastP.batterBats === '左' ? 'left' : 'right';
            const _abOrder = (lastP.batter >= 1 && lastP.batter <= 5) ? 'top' : 'bottom';
            [st.sideStats[_abSide], st.orderStats[_abOrder]].forEach(sp => {
              sp.PA++;
              if (!_isBB && !_isSac) sp.AB++;
              if (_isH) sp.H++; else if (_isBB) sp.BB++; else if (_isK) sp.K++;
            });
          });
          const calcSplitRates = (sp) => ({ ...sp,
            sPct: sp.total>0?Math.round(sp.strikes/sp.total*100):0,
            AVG: sp.AB>0?(sp.H/sp.AB).toFixed(3).replace(/^0/,''):'---',
            KPct: sp.PA>0?Math.round(sp.K/sp.PA*100):0,
            BBPct: sp.PA>0?Math.round(sp.BB/sp.PA*100):0,
          });
          return { pitchers: Object.values(pStats).map(st => ({
              ...st, csw: st.total>0?Math.round(((st.calledStrikes+st.whiffs)/st.total)*100):0, whiff: st.swings>0?Math.round((st.whiffs/st.swings)*100):0,
              fStrikePct: st.firstPitches>0?Math.round((st.firstStrikes/st.firstPitches)*100):0, pPa: st.PA>0?(st.total/st.PA).toFixed(1):'0.0',
              types: Object.entries(st.typeStats).map(([t, tSt]) => ({ type: t, total: tSt.total, csw: tSt.total>0?Math.round(((tSt.calledStrikes+tSt.whiffs)/tSt.total)*100):0, whiff: tSt.swings>0?Math.round((tSt.whiffs/tSt.swings)*100):0, strikeRate: tSt.total>0?Math.round((tSt.strikes/tSt.total)*100):0 })).sort((a, b) => b.total - a.total),
              sideStats: { right: calcSplitRates(st.sideStats.right), left: calcSplitRates(st.sideStats.left) },
              orderStats: { top: calcSplitRates(st.orderStats.top), bottom: calcSplitRates(st.orderStats.bottom) },
            })).sort((a, b) => b.total - a.total)
          };
        };
        return { topBatting: calcBatting(true), bottomBatting: calcBatting(false), pitchingTop: calcTeamPitching(false), pitchingBottom: calcTeamPitching(true) };
      }, [pitchesWithCountState, showPostGameAnalysis, lineups]);

      // アナリスト指標（試合後レポート・独立画面の両方で利用）
      const analystInsights = useMemo(() => {
        if (!showPostGameAnalysis && !showAnalystReport) return null;
        return buildAnalystInsights(pitchesWithCountState, lineups, gameInfo);
      }, [pitchesWithCountState, lineups, gameInfo, showPostGameAnalysis, showAnalystReport]);

      // ---------- 累計成績（複数試合横断集計） ----------
      const cumulativeStats = useMemo(() => {
        if (!showCumulativeStats || !cumulativeTeam) return { games: [], batters: [], pitchers: [] };
        const fromD = cumulativeDateFrom ? parseGameDate(cumulativeDateFrom) : null;
        const toD = cumulativeDateTo ? parseGameDate(cumulativeDateTo) : null;
        const games = savedGames.filter(g => {
          if (g.teamTop !== cumulativeTeam && g.teamBottom !== cumulativeTeam) return false;
          const d = parseGameDate(g.date);
          if (fromD && d && d < fromD) return false;
          if (toD && d && d > toD) return false;
          return true;
        });
        const batters = {}; // key: playerName
        const pitchers = {}; // key: pitcherName
        const mkBatter = (nm) => ({ name: nm, games: new Set(), PA:0, AB:0, H:0, _2B:0, _3B:0, HR:0, BB_HBP:0, K:0, TB:0, SF:0, results: [], gameLog: [] });
        const mkPitcher = (nm, throwsSide) => ({ name: nm, throws: throwsSide || '右', games: new Set(), pitches:0, PA:0, H:0, BB:0, K:0, strikes:0, calledStrikes:0, whiffs:0, swings:0, firstPitches:0, firstStrikes:0, typeStats: {}, gameLog: [] });
        games.forEach(g => {
          const gpitches = (g.data && g.data.pitches) || [];
          const targetIsTop = g.teamTop === cumulativeTeam;
          const battingIsTop = targetIsTop ? true : false;
          // ---- 打者集計 ----
          const batPitches = gpitches.filter(p => p.isTop === battingIsTop && !p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)));
          const abs = []; let cur = [];
          batPitches.forEach(p => { if (p.pitchNumber === 1 && cur.length > 0) { abs.push(cur); cur = []; } cur.push(p); });
          if (cur.length > 0) abs.push(cur);
          const perGameBatter = {};
          abs.forEach(ab => {
            const last = ab[ab.length - 1]; if (!last) return;
            const nm = last.batterName || '不明';
            if (!batters[nm]) batters[nm] = mkBatter(nm);
            const b = batters[nm]; b.games.add(g.id);
            if (!perGameBatter[nm]) perGameBatter[nm] = { PA:0, AB:0, H:0, BB_HBP:0, K:0, TB:0, results: [] };
            const pg = perGameBatter[nm];
            let s=0,bb=0; ab.forEach(p => { if(['ボール','ウエスト'].includes(p.result)) bb++; else if(['ストライク','空振り','バント空振り'].includes(p.result)) s++; else if(['ファウル','バントファウル'].includes(p.result)&&s<2) s++; });
            const res = last.result;
            const isHit = ['安','塁打','本塁打'].some(w=>res.includes(w));
            let isAB = true, tbAdd = 0;
            b.PA++; pg.PA++;
            if (isHit) {
              b.H++; pg.H++;
              if (res.includes('本塁打')) { b.HR++; tbAdd = 4; }
              else if (res.includes('三塁打')) { b._3B++; tbAdd = 3; }
              else if (res.includes('二塁打')) { b._2B++; tbAdd = 2; }
              else tbAdd = 1;
              b.TB += tbAdd; pg.TB += tbAdd;
            } else if (['死球','四球','ウエスト'].includes(res) || bb >= 4) {
              b.BB_HBP++; pg.BB_HBP++; isAB = false;
            } else if (['犠打','犠飛'].some(w=>res.includes(w))) {
              if (res.includes('犠飛')) b.SF++;
              isAB = false;
            } else if (res === '三振' || res === 'スリーバント失敗' || res === '振り逃げ' || res === '振り逃げアウト' || s >= 3) {
              b.K++; pg.K++;
            }
            if (isAB) { b.AB++; pg.AB++; }
            b.results.push(res); pg.results.push(res);
          });
          Object.entries(perGameBatter).forEach(([nm, pg]) => {
            batters[nm].gameLog.push({ gameId: g.id, date: g.date, opponent: targetIsTop ? g.teamBottom : g.teamTop, ...pg });
          });

          // ---- 投手集計 ----
          const pitchingIsTop = !battingIsTop;
          const pitPitches = gpitches.filter(p => p.isTop === pitchingIsTop && !p.isEvent && !(p.result?.startsWith('牽制') || ['盗塁死','その他出塁'].includes(p.result)));
          const pAbs = []; cur = [];
          pitPitches.forEach(p => { if (p.pitchNumber === 1 && cur.length > 0) { pAbs.push(cur); cur = []; } cur.push(p); });
          if (cur.length > 0) pAbs.push(cur);
          const perGamePitcher = {};
          pAbs.forEach(ab => {
            ab.forEach(p => {
              const nm = p.pitcherName || '不明';
              if (!pitchers[nm]) pitchers[nm] = mkPitcher(nm, p.pitcherThrows);
              const ps = pitchers[nm]; ps.games.add(g.id); ps.pitches++;
              if (!perGamePitcher[nm]) perGamePitcher[nm] = { pitches:0, PA:0, H:0, BB:0, K:0, strikes:0 };
              const pg = perGamePitcher[nm]; pg.pitches++;
              const type = p.type ? p.type.replace(/系$/, '') : '不明';
              if (!ps.typeStats[type]) ps.typeStats[type] = { total:0, strikes:0, whiffs:0, swings:0, calledStrikes:0 };
              const tSt = ps.typeStats[type]; tSt.total++;
              const isStrikeCount = !['ボール','ウエスト','死球'].includes(p.result);
              if (isStrikeCount) { ps.strikes++; tSt.strikes++; pg.strikes++; }
              let isSwing = false, isStrikeType = false;
              if (p.result.includes('見逃し') || p.result === 'ストライク') { ps.calledStrikes++; tSt.calledStrikes++; isStrikeType = true; }
              else if (p.result.includes('空振り') || p.result === 'バント空振り') { ps.whiffs++; tSt.whiffs++; isSwing = true; isStrikeType = true; }
              else if (['ファウル','バントファウル','スリーバント失敗','インプレー','バント','ゴロ','飛','安','塁打','エラー','犠','直'].some(w=>p.result.includes(w))) { isSwing = true; isStrikeType = true; }
              if (isSwing) { ps.swings++; tSt.swings++; }
              if (p.pitchNumber === 1) { ps.firstPitches++; if (isStrikeType || isSwing || isStrikeCount) ps.firstStrikes++; }
            });
            const last = ab[ab.length - 1]; if (!last) return;
            const nm = last.pitcherName || '不明';
            const ps = pitchers[nm]; const pg = perGamePitcher[nm];
            ps.PA++; pg.PA++;
            const res = last.result;
            let fB=0,fS=0; ab.forEach(p => { if(['ボール','ウエスト'].includes(p.result)) fB++; else if(['ストライク','空振り','バント空振り'].includes(p.result)) fS++; else if(['ファウル','バントファウル'].includes(p.result)&&fS<2) fS++; });
            const isHit = ['安','塁打','本塁打'].some(w=>res.includes(w));
            const isBB = ['死球','四球','ウエスト'].includes(res) || fB>=4;
            const isK = res==='三振' || res==='スリーバント失敗' || res==='振り逃げ' || res==='振り逃げアウト' || fS>=3;
            if (isHit) { ps.H++; pg.H++; } else if (isBB) { ps.BB++; pg.BB++; } else if (isK) { ps.K++; pg.K++; }
          });
          Object.entries(perGamePitcher).forEach(([nm, pg]) => {
            pitchers[nm].gameLog.push({ gameId: g.id, date: g.date, opponent: targetIsTop ? g.teamBottom : g.teamTop, ...pg });
          });
        });
        const battersArr = Object.values(batters).map(b => {
          const AB = b.AB, PA = b.PA;
          const AVG = AB>0 ? (b.H/AB).toFixed(3).replace(/^0/,'') : '.000';
          const OBP = PA>0 ? ((b.H + b.BB_HBP) / PA).toFixed(3).replace(/^0/,'') : '.000';
          const SLG = AB>0 ? (b.TB/AB).toFixed(3).replace(/^0/,'') : '.000';
          const OPS = ((AB>0?(b.TB/AB):0) + (PA>0?((b.H+b.BB_HBP)/PA):0)).toFixed(3).replace(/^0/,'');
          return { ...b, G: b.games.size, AVG, OBP, SLG, OPS, KPct: PA>0?Math.round(b.K/PA*100):0, BBPct: PA>0?Math.round(b.BB_HBP/PA*100):0 };
        }).sort((a,b) => b.PA - a.PA);
        const pitchersArr = Object.values(pitchers).map(p => ({
          ...p, G: p.games.size,
          csw: p.pitches>0 ? Math.round(((p.calledStrikes + p.whiffs) / p.pitches) * 100) : 0,
          whiffPct: p.swings>0 ? Math.round((p.whiffs / p.swings) * 100) : 0,
          strikePct: p.pitches>0 ? Math.round((p.strikes / p.pitches) * 100) : 0,
          fStrikePct: p.firstPitches>0 ? Math.round((p.firstStrikes / p.firstPitches) * 100) : 0,
          AVG: (p.PA - p.BB) > 0 ? (p.H / (p.PA - p.BB)).toFixed(3).replace(/^0/,'') : '.000',
          KPct: p.PA>0 ? Math.round(p.K/p.PA*100) : 0,
          BBPct: p.PA>0 ? Math.round(p.BB/p.PA*100) : 0,
          types: Object.entries(p.typeStats).map(([t, ts]) => ({ type: t, total: ts.total, strikePct: ts.total>0?Math.round(ts.strikes/ts.total*100):0, whiffPct: ts.swings>0?Math.round(ts.whiffs/ts.swings*100):0 })).sort((a,b) => b.total - a.total),
        })).sort((a,b) => b.pitches - a.pitches);
        return { games, batters: battersArr, pitchers: pitchersArr };
      }, [showCumulativeStats, cumulativeTeam, cumulativeDateFrom, cumulativeDateTo, savedGames]);

      // v2の試合スナップショットは変更せず、分析時に正規化テーブルへ再構築する。
      const analyticsDb = useMemo(() => normalizeArchive(savedGames, registeredTeams, homeTeamName), [savedGames, registeredTeams, homeTeamName]);

      const playByPlayData = useMemo(() => {
        const innings = {}; let currentAbKey = null, currentAb = [];
        const flushAb = () => {
          if (currentAb.length === 0) return;
          const first = currentAb[0], key = `${first.inning}-${first.isTop}`;
          if (!innings[key]) innings[key] = { inning: first.inning, isTop: first.isTop, atBats: [] };
          const nonEvent = currentAb.filter(p => !p.isEvent), events = currentAb.filter(p => p.isEvent), lastPitch = nonEvent.length > 0 ? nonEvent[nonEvent.length - 1] : null;
          let result = '';
          if (lastPitch) {
            const res = lastPitch.result;
            if (['安', '塁打', '本塁打', 'インプレー', 'バント'].some(w => res.includes(w))) result = res;
            else { let b = 0, s = 0; nonEvent.forEach(p => { if (['ボール','ウエスト'].includes(p.result)) b++; else if (['ストライク','空振り','バント空振り'].includes(p.result)) s++; else if (['ファウル','バントファウル'].includes(p.result) && s < 2) s++; }); if (res === '振り逃げ') result = '振り逃げ'; else if (res === '振り逃げアウト') result = '振り逃げアウト'; else if (s >= 3 || res === '三振' || res === 'スリーバント失敗') result = res === 'スリーバント失敗' ? 'スリーバント失敗' : '三振'; else if (b >= 4 || ['四球','ウエスト'].includes(res)) result = '四球'; else if (res === '死球') result = '死球'; else result = res; }
          }
          // イベント記録も独立して追加する処理に変更可能ですが、今回は打席履歴とマージ
          innings[key].atBats.push({ batter: first.batter, batterName: first.batterName, pitcherName: first.pitcherName, pitchCount: nonEvent.length, result, events: events.map(e => e.result), pitches: currentAb });
        };
        pitches.forEach(p => { const abKey = `${p.inning}-${p.isTop}-${p.batter}`; if (p.isEvent) { currentAb.push(p); return; } if (abKey !== currentAbKey) { flushAb(); currentAbKey = abKey; currentAb = []; } currentAb.push(p); });
        flushAb();
        return Object.values(innings).sort((a, b) => a.inning !== b.inning ? a.inning - b.inning : a.isTop ? -1 : 1);
      }, [pitches]);

      const playByPlayReport = useMemo(() => buildPlayByPlayReport(pitches), [pitches]);
      const [pbpScrollTarget, setPbpScrollTarget] = useState(null);
      const scrollToPlay = (inning, isTop, batter) => {
        setPbpScrollTarget(`${inning}-${isTop}-${batter}-`);
        setShowPostGameAnalysis(true);
      };

      const courses = Array.from({ length: 49 }, (_, i) => i);
      const isStrikeZone = (i) => { const row = Math.floor(i / 7); const col = i % 7; return row >= 2 && row <= 4 && col >= 2 && col <= 4; };
      // 視点切り替え用ヘルパー。バックスクリーン側表示では左右を反転する（データは捕手目線で保持）
      const isBackscreen = pitchView === 'pitcher';
      const flipCourse = (c) => { const row = Math.floor(c / 7), col = c % 7; return row * 7 + (6 - col); };
      // 画面上のセル位置 i に対応する論理コース番号（保存値）
      const dispCourse = (i) => isBackscreen ? flipCourse(i) : i;
      // 球種グリッドの左右配置。バックスクリーン側では投手の左右を反転させたレイアウトと同じになる
      const layoutRight = (throwsRight) => isBackscreen ? !throwsRight : throwsRight;
      const viewLabel = isBackscreen ? 'バックスクリーン目線' : '捕手目線';
      const togglePitchView = () => setPitchView(v => v === 'catcher' ? 'pitcher' : 'catcher');
      const uniquePitchers = useMemo(() => Array.from(new Set(pitches.map(p => p.pitcherName).filter(Boolean))), [pitches]);
      const currentBatterIndex = (gameState.isTop ? gameState.batterTop : gameState.batterBottom) - 1;
      const currentBatterObj = lineups[gameState.isTop ? 'top' : 'bottom'][currentBatterIndex] || { name: '打者未設定', bats: '右' };
      const currentPitcherIdx = lineups[gameState.isTop ? 'bottom' : 'top'].findIndex(p => p.pos === '投' || p.pos === '1' || p.pos === '①');
      const currentPitcherObj = currentPitcherIdx !== -1 ? lineups[gameState.isTop ? 'bottom' : 'top'][currentPitcherIdx] : { name: '投手未設定', throws: '右' };
      const currentAtBatPitches = pitches.filter(p => p.inning === gameState.inning && p.isTop === gameState.isTop && p.batter === currentBatterIndex + 1);

      const posOptions = ['未','投','捕','一','二','三','遊','左','中','右','指','打','走','控'];
      const throwBatOptions = ['右投右打','右投左打','右投両打','左投右打','左投左打','左投両打'];
      const parseThrowBat = (bats, throws) => `${throws || '右'}投${bats || '右'}打`;
      const splitThrowBat = (val) => { const m = val.match(/^(右|左)投(右|左|両)打$/); return m ? { bats: m[2], throws: m[1] } : { bats: '右', throws: '右' }; };
      // 登録チームから選手を検索し、投打情報も自動反映するためのヘルパー
      const getRosterPlayers = (teamName) => {
        const t = findRegisteredTeam(teamName);
        if (!t || !t.players) return [];
        return t.players.map(pl => typeof pl === 'string' ? { name: pl, throws: '右', bats: '右' } : pl);
      };
      // dropBench: 控え欄にいる選手を先発オーダーへ入れたとき、控え欄の重複を外す
      // (入力中に行が消えないよう、選手選択ポップアップからの確定時のみ true)
      const onLineupNameChange = (side, i, newName, { dropBench = false } = {}) => {
        const roster = getRosterPlayers(side === 'top' ? gameInfo.teamTop : gameInfo.teamBottom);
        const match = roster.find(pl => pl.name === newName);
        const nl = [...lineups[side]];
        nl[i] = match ? { ...nl[i], name: newName, throws: match.throws || '右', bats: match.bats || '右' } : { ...nl[i], name: newName };
        setLineups(prev => ({...prev, [side]: dropBench && i < STARTING_SLOTS ? dropBenchEntry(nl, newName) : nl}));
      };

      // 交代で入れる選手の候補: オーダーの控え欄 → 名簿で出場していない選手 → 出場中の選手 の順。
      // 出場中でも選択自体はできる(記録の付け方はスコアラーの判断に任せる)。
      const subCandidates = useMemo(() => {
        const lineup = lineups[subData.team] || [];
        const teamName = subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom;
        const onField = new Set(lineup.slice(0, STARTING_SLOTS).map(p => p.name?.trim()).filter(n => n && !isPlaceholderName(n)));
        const list = [];
        const push = (name, throws, bats, fromBench) => {
          const trimmed = (name || '').trim();
          if (!trimmed || isPlaceholderName(trimmed) || list.some(c => c.name === trimmed)) return;
          list.push({ name: trimmed, throws: throws || '右', bats: bats || '右', fromBench, onField: onField.has(trimmed) });
        };
        lineup.slice(STARTING_SLOTS).forEach(p => push(p.name, p.throws, p.bats, true));
        getRosterPlayers(teamName).forEach(pl => push(pl.name, pl.throws, pl.bats, false));
        return list.sort((a, b) => (a.onField ? 1 : 0) - (b.onField ? 1 : 0) || (b.fromBench ? 1 : 0) - (a.fromBench ? 1 : 0));
      }, [lineups, subData.team, gameInfo.teamTop, gameInfo.teamBottom, registeredTeams]);

      const getPitchTypes = (throwsRight) => [
        { name: 'ストレート', icon: '↑', colorClass: 'border-rose-500 bg-rose-50 text-rose-700' },
        { name: 'スライダー', icon: throwsRight ? '→' : '←', colorClass: 'border-blue-500 bg-blue-50 text-blue-700' },
        { name: 'シュート', icon: throwsRight ? '←' : '→', colorClass: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
        { name: 'カーブ', icon: throwsRight ? '↘' : '↙', colorClass: 'border-amber-500 bg-amber-50 text-amber-700' },
        { name: '落ちる球', icon: '↓', colorClass: 'border-indigo-500 bg-indigo-50 text-indigo-700' },
        { name: 'シンカー', icon: throwsRight ? '↙' : '↘', colorClass: 'border-cyan-500 bg-cyan-50 text-cyan-700' }
      ];

      return (
        <div className="min-h-screen flex flex-col h-screen overflow-hidden bg-slate-50">
          {toast && <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full font-bold shadow-2xl z-[600] flex items-center gap-3 ${toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white border border-slate-700'}`}><span>{toast.type === 'error' ? '⚠️' : '✅'}</span>{toast.text}</div>}

          {confirmDialog && (
            <div className="fixed inset-0 bg-slate-900/60 z-[600] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col p-6 text-center border border-slate-200">
                <h3 className="text-xl font-black text-slate-800 mb-3">{confirmDialog.title}</h3>
                <p className="text-slate-600 font-bold mb-2 whitespace-pre-wrap">{confirmDialog.message}</p>
                {confirmDialog.subMessage && <p className="text-xs text-rose-500 font-bold mb-6 bg-rose-50 py-2 rounded-lg">{confirmDialog.subMessage}</p>}
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setConfirmDialog(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                  <button onClick={confirmDialog.onConfirm} className={`flex-1 text-white py-3 rounded-xl font-black shadow-md active:scale-95 ${confirmDialog.isDanger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>実行する</button>
                </div>
              </div>
            </div>
          )}

          {/* ===== HEADER ===== */}
          <header className="bg-white shadow-sm border-b border-slate-200 p-2 md:p-3 xl:p-4 flex flex-col md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] xl:flex xl:flex-row md:items-center md:justify-between shrink-0 gap-3 z-10 relative">
            <div className="flex flex-col gap-2 md:w-auto w-full">
              <div className="flex items-center justify-between md:justify-start gap-4">
                <div className="flex items-center gap-2 text-xl md:text-2xl font-black text-blue-700 tracking-tighter whitespace-nowrap"><span className="text-2xl">⚾</span>配球スコア <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full uppercase tracking-widest ml-1 font-bold border border-blue-200">Pro</span></div>
                <button onClick={()=>openScoreEdit('current')} className="flex md:hidden items-center gap-2 text-xs font-bold bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-200">
                  <span className="text-slate-600">{gameState.inning}回{gameState.isTop?'表':'裏'}</span>
                  <span className="text-slate-800 ml-1">{gameInfo.teamTop} <span className="text-blue-700 font-black text-sm">{gameState.runs.top.reduce((a,b)=>a+b,0)}</span> - <span className="text-blue-700 font-black text-sm">{gameState.runs.bottom.reduce((a,b)=>a+b,0)}</span> {gameInfo.teamBottom}</span>
                  <span className="text-[10px] text-slate-400">✏️</span>
                </button>
              </div>
              <div className="md:hidden horizontal-scroll custom-scrollbar flex gap-2 w-full pt-1 pb-1">
                <button onClick={openOrderSettings} className="whitespace-nowrap shrink-0 bg-white text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 shadow-sm">⚙️ オーダー</button>
                <button onClick={()=>openSubstitutionModal()} className="whitespace-nowrap shrink-0 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-blue-200 shadow-sm">🔄 交代</button>
                <button onClick={()=>setShowRecordEditor(true)} className="whitespace-nowrap shrink-0 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-indigo-200 shadow-sm">📝 記録修正</button>
                <button onClick={()=>openScoreEdit('current')} className="whitespace-nowrap shrink-0 bg-white text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 shadow-sm">✏️ スコア修正</button>
                <button onClick={()=>{ setEditingTeamIndex(null); setShowTeamManager(true); }} className="whitespace-nowrap shrink-0 bg-white text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 shadow-sm">👥 チーム</button>
                <button onClick={()=>setShowAnalyticsHub(true)} className="whitespace-nowrap shrink-0 bg-cyan-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📊 分析ハブ</button>
                <button onClick={()=>setShowArchiveModal(true)} className="whitespace-nowrap shrink-0 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📂 保存/読込</button>
                <button onClick={()=>setShowExport(true)} className="whitespace-nowrap shrink-0 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📤 出力</button>
                <button onClick={handleTieBreak} className="whitespace-nowrap shrink-0 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-purple-200 shadow-sm">⚡ 特延</button>
                <button onClick={handleNewGame} className="whitespace-nowrap shrink-0 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-rose-200 shadow-sm">🔄 リセット</button>
                <button onClick={() => setShowPostGameAnalysis(true)} className="whitespace-nowrap shrink-0 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">🏁 分析レポート</button>
                <button onClick={() => setShowAnalystReport(true)} className="whitespace-nowrap shrink-0 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📈 アナリスト分析</button>
              </div>
            </div>

            {/* Desktop scoreboard */}
            <div className="hidden md:flex md:justify-self-center xl:justify-self-auto flex-col bg-white border border-slate-300 rounded-xl overflow-hidden text-sm shadow-sm">
              <div className="flex bg-slate-100 border-b border-slate-300 font-bold text-[10px] text-slate-500">
                <div className="w-28 shrink-0 border-r border-slate-300 flex items-center justify-between py-1 px-1.5"><span>TEAM</span><button onClick={()=>openScoreEdit('current')} title="回別スコアを修正" className="text-[9px] text-blue-500 hover:text-blue-700 font-bold bg-blue-50 border border-blue-200 rounded px-1 py-0.5">✏️ 修正</button></div>
                {[1,2,3,4,5,6,7,8,9].map(i => <div key={i} className={`w-8 shrink-0 border-r border-slate-300 flex items-center justify-center py-1 ${gameState.inning === i ? 'bg-blue-200 text-blue-800' : ''}`}>{i}</div>)}
                <div className="w-10 shrink-0 flex items-center justify-center py-1 bg-slate-200 border-r border-slate-300">R</div>
                <div className="w-8 shrink-0 flex items-center justify-center py-1 bg-slate-200 border-r border-slate-300">H</div>
                <div className="w-8 shrink-0 flex items-center justify-center py-1 bg-slate-200">E</div>
              </div>
              <div className="flex">
                <div className="flex flex-col bg-white font-bold border-r border-slate-300 w-28 shrink-0">
                  <div className="h-8 border-b border-slate-200 flex items-center px-2"><input type="text" value={gameInfo.teamTop} onChange={e=>setGameInfo({...gameInfo, teamTop: e.target.value})} className="flex-1 h-full bg-transparent text-left outline-none font-bold text-xs min-w-0" /></div>
                  <div className="h-8 flex items-center px-2"><input type="text" value={gameInfo.teamBottom} onChange={e=>setGameInfo({...gameInfo, teamBottom: e.target.value})} className="flex-1 h-full bg-transparent text-left outline-none font-bold text-xs min-w-0" /></div>
                </div>
                <div className="flex shrink-0">
                  {[1,2,3,4,5,6,7,8,9].map(i => (
                    <div key={i} className="flex flex-col border-r border-slate-300 text-center w-8 shrink-0 bg-white">
                      <div onClick={() => jumpToInning(i, true)} className={`h-8 border-b border-slate-200 flex items-center justify-center font-bold text-xs cursor-pointer hover:bg-blue-50 ${gameState.inning === i && gameState.isTop ? 'bg-blue-100 text-blue-800' : 'text-slate-600'}`}>{gameState.runs.top[i-1] > 0 ? gameState.runs.top[i-1] : (gameState.inning > i || (gameState.inning === i && !gameState.isTop) ? '0' : '')}</div>
                      <div onClick={() => jumpToInning(i, false)} className={`h-8 flex items-center justify-center font-bold text-xs cursor-pointer hover:bg-blue-50 ${gameState.inning === i && !gameState.isTop ? 'bg-blue-100 text-blue-800' : 'text-slate-600'}`}>{gameState.runs.bottom[i-1] > 0 ? gameState.runs.bottom[i-1] : (gameState.inning > i ? '0' : '')}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col text-center w-10 shrink-0 font-black bg-blue-50 text-blue-800 border-r border-slate-300">
                  <div className="h-8 border-b border-slate-300 flex items-center justify-center text-sm">{gameState.runs.top.reduce((a,b)=>a+b,0)}</div>
                  <div className="h-8 flex items-center justify-center text-sm">{gameState.runs.bottom.reduce((a,b)=>a+b,0)}</div>
                </div>
                <div className="flex flex-col text-center w-8 shrink-0 font-bold bg-slate-50 border-r border-slate-300">
                  <div className="h-8 border-b border-slate-300 flex items-center justify-center">{hitsAndErrors.top.hits}</div>
                  <div className="h-8 flex items-center justify-center">{hitsAndErrors.bottom.hits}</div>
                </div>
                <div className="flex flex-col text-center w-8 shrink-0 font-bold bg-slate-50">
                  <div className="h-8 border-b border-slate-300 flex items-center justify-center">{hitsAndErrors.top.errors}</div>
                  <div className="h-8 flex items-center justify-center">{hitsAndErrors.bottom.errors}</div>
                </div>
              </div>
            </div>

            <div className="hidden md:flex gap-2 items-center min-w-0 md:justify-self-end xl:justify-self-auto">
              <div className="flex flex-col gap-1 items-start px-2 border-l border-r border-slate-200 font-mono w-auto shrink-0">
                <div className="flex items-center gap-2 w-full"><span className="text-[13px] font-black text-emerald-600 w-3">B</span><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className={`w-4 h-4 rounded-full border-2 border-emerald-600 ${i<gameState.balls?'bg-emerald-500':'bg-slate-100'}`}></div>)}</div></div>
                <div className="flex items-center gap-2 w-full"><span className="text-[13px] font-black text-amber-500 w-3">S</span><div className="flex gap-1">{[0,1].map(i=><div key={i} className={`w-4 h-4 rounded-full border-2 border-amber-500 ${i<gameState.strikes?'bg-amber-400':'bg-slate-100'}`}></div>)}</div></div>
                <div className="flex items-center gap-2 w-full"><span className="text-[13px] font-black text-rose-600 w-3">O</span><div className="flex gap-1">{[0,1].map(i=><div key={i} className={`w-4 h-4 rounded-full border-2 border-rose-600 ${i<gameState.outs?'bg-rose-500':'bg-slate-100'}`}></div>)}</div></div>
              </div>
              <details className="relative group xl:contents">
                <summary className="xl:hidden list-none cursor-pointer whitespace-nowrap bg-slate-800 text-white px-3 py-2 rounded-lg text-[11px] font-black shadow-sm active:bg-slate-950">☰ 操作</summary>
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[34rem] max-w-[calc(100vw-2rem)] grid grid-cols-4 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl font-sans xl:static xl:w-auto xl:max-w-none xl:flex xl:flex-col xl:gap-2 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
                <div className="contents xl:flex xl:gap-1.5 xl:flex-wrap xl:justify-end">
                  <button onClick={openOrderSettings} className="bg-white hover:bg-slate-50 text-slate-700 px-2 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 shadow-sm">⚙️ オーダー</button>
                  <button onClick={()=>openSubstitutionModal()} className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1.5 rounded-lg text-[11px] font-bold border border-blue-200 shadow-sm">🔄 交代</button>
                  <button onClick={()=>setShowRecordEditor(true)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-1.5 rounded-lg text-[11px] font-bold border border-indigo-200 shadow-sm">📝 記録修正</button>
                  <button onClick={()=>{ setEditingTeamIndex(null); setShowTeamManager(true); }} className="bg-white hover:bg-slate-50 text-slate-700 px-2 py-1.5 rounded-lg text-[11px] font-bold border border-slate-300 shadow-sm">👥 チーム</button>
                  <button onClick={()=>setShowArchiveModal(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📂 保存/読込</button>
                  <button onClick={()=>setShowAnalyticsHub(true)} className="bg-cyan-600 hover:bg-cyan-700 text-white px-2 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📊 分析ハブ</button>
                  <button onClick={()=>setShowExport(true)} className="bg-slate-800 hover:bg-black text-white px-2 py-1.5 rounded-lg text-[11px] font-bold shadow-sm">📤 出力</button>
                </div>
                <div className="contents xl:flex xl:gap-1.5 xl:flex-wrap xl:justify-end">
                  <button onClick={handleTieBreak} className="bg-purple-50 text-purple-700 px-2 py-1.5 rounded-lg text-[10px] font-bold border border-purple-200">⚡ 特延</button>
                  <button onClick={handleNewGame} className="bg-rose-50 text-rose-700 px-2 py-1.5 rounded-lg text-[10px] font-bold border border-rose-200">🔄 リセット</button>
                  <button onClick={() => setShowPostGameAnalysis(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md">🏁 試合分析へ</button>
                  <button onClick={() => setShowAnalystReport(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md">📈 アナリスト分析</button>
                </div>
                </div>
              </details>
            </div>
          </header>

          {/* Mobile BSO + runner bar */}
          <div className="md:hidden bg-white border-b border-slate-200 px-3 py-2 flex flex-col gap-2 shrink-0 shadow-sm z-0">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1 font-mono shrink-0 items-start">
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-black text-emerald-600 w-2.5">B</span><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className={`w-3.5 h-3.5 rounded-full border-[1.5px] border-emerald-600 ${i<gameState.balls?'bg-emerald-500':'bg-slate-100'}`}></div>)}</div></div>
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-black text-amber-500 w-2.5">S</span><div className="flex gap-1">{[0,1].map(i=><div key={i} className={`w-3.5 h-3.5 rounded-full border-[1.5px] border-amber-500 ${i<gameState.strikes?'bg-amber-400':'bg-slate-100'}`}></div>)}</div></div>
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-black text-rose-600 w-2.5">O</span><div className="flex gap-1">{[0,1].map(i=><div key={i} className={`w-3.5 h-3.5 rounded-full border-[1.5px] border-rose-600 ${i<gameState.outs?'bg-rose-500':'bg-slate-100'}`}></div>)}</div></div>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-slate-400 mb-1">ランナー</span>
                <div className="relative w-8 h-8">
                  <button onClick={() => toggleRunner('second')} className={`absolute top-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.second ? 'bg-blue-500' : 'bg-white'}`}></button>
                  <button onClick={() => toggleRunner('third')} className={`absolute top-1/2 left-0 -translate-y-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.third ? 'bg-blue-500' : 'bg-white'}`}></button>
                  <button onClick={() => toggleRunner('first')} className={`absolute top-1/2 right-0 -translate-y-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.first ? 'bg-blue-500' : 'bg-white'}`}></button>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 transform rotate-45 border border-slate-400 bg-slate-200"></div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={() => setShowAdvanceModal(true)} className="text-[10px] bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-bold border border-blue-200 w-full">進塁</button>
                <button onClick={() => { setOutRunnerData({ runner: '', reason: '盗塁死' }); setShowOutRunnerModal(true); }} className="text-[10px] bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg font-bold border border-rose-200 w-full">走者ｱｳﾄ</button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
               <div className="flex-1 flex items-center gap-1.5 text-[11px] font-bold truncate bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200">
                  <span className="text-rose-600 shrink-0">投:</span><span className="truncate">{currentPitcherObj.name}</span>
                  <span className="text-slate-300 mx-1">|</span>
                  <span className="text-blue-600 shrink-0">打:</span>
                  <select value={gameState.isTop ? gameState.batterTop : gameState.batterBottom} onChange={(e) => manuallyChangeBatter(Number(e.target.value))} className="bg-white border border-blue-300 text-blue-700 rounded px-1 py-0.5 outline-none font-black text-[11px] shrink-0">
                    {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n}番</option>)}
                  </select>
                  <span className="truncate text-blue-700">{currentBatterObj.name}</span>
               </div>
               <button onClick={handleUndo} disabled={undoStack.length === 0} className={`text-[11px] px-3 py-1.5 rounded-lg font-bold border shrink-0 ${undoStack.length > 0 ? 'bg-white border-slate-400 text-slate-700' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>↩️</button>
            </div>
          </div>

          {/* ===== MAIN CONTENT ===== */}
          <main className="flex-1 flex flex-col md:flex-row p-2 md:p-4 gap-3 md:gap-5 max-w-[1400px] mx-auto w-full overflow-hidden">
            {/* Left: Pitch input */}
            <div className="w-full md:w-[60%] flex flex-col gap-3 md:gap-4 overflow-y-auto md:pr-2 flex-1 md:flex-none">
              <div className="hidden md:flex bg-white rounded-2xl shadow-sm p-4 justify-between items-center border border-slate-200 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="text-2xl font-black text-slate-800">{gameState.inning}回{gameState.isTop?'表':'裏'}</div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-slate-400 mr-2 uppercase">Runner</span>
                    <div className="relative w-8 h-8 mr-2">
                      <button onClick={() => toggleRunner('second')} className={`absolute top-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.second ? 'bg-blue-500' : 'bg-white'}`}></button>
                      <button onClick={() => toggleRunner('third')} className={`absolute top-1/2 left-0 -translate-y-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.third ? 'bg-blue-500' : 'bg-white'}`}></button>
                      <button onClick={() => toggleRunner('first')} className={`absolute top-1/2 right-0 -translate-y-1/2 w-3.5 h-3.5 transform rotate-45 border-2 border-slate-400 ${gameState.runners.first ? 'bg-blue-500' : 'bg-white'}`}></button>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3.5 h-3.5 transform rotate-45 border border-slate-400 bg-slate-200"></div>
                    </div>
                    <button onClick={() => setShowAdvanceModal(true)} className="text-[10px] bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-bold border border-blue-200">＋進塁</button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs font-bold bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 flex items-center gap-4">
                    <div className="flex items-center gap-1.5"><span className="text-rose-600 font-black">投</span> <span>{currentPitcherObj.name}</span></div>
                    <div className="w-px h-4 bg-slate-300"></div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-600 font-black">打</span>
                      <select value={gameState.isTop ? gameState.batterTop : gameState.batterBottom} onChange={(e) => manuallyChangeBatter(Number(e.target.value))} className="bg-white border border-blue-300 text-blue-700 rounded px-1.5 py-0.5 outline-none font-black cursor-pointer shadow-sm">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}番</option>)}
                      </select>
                      <span className="text-blue-700">{currentBatterObj.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center bg-blue-50 rounded-xl border border-blue-200 p-1">
                    <button onClick={()=>changeScore(gameState.isTop?'top':'bottom', -1)} className="p-1 text-blue-600 font-black w-8 rounded-lg text-lg">－</button>
                    <span className="px-2 text-[10px] font-bold text-blue-800 uppercase">Score</span>
                    <button onClick={()=>changeScore(gameState.isTop?'top':'bottom', 1)} className="p-1 text-blue-600 font-black w-8 rounded-lg text-lg">＋</button>
                  </div>
                </div>
              </div>

              {!showInPlayResult ? (
                <div className="bg-white rounded-3xl shadow-sm p-4 md:p-6 border border-slate-200 flex-1 flex flex-col min-h-fit">
                  <div className="flex flex-col md:flex-row gap-5 md:gap-8 flex-1">
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <div className="grid grid-cols-7 grid-rows-7 w-[200px] h-[200px] md:w-[280px] md:h-[280px] gap-px md:gap-0.5 relative bg-slate-300 p-1.5 md:p-2 rounded-xl border border-slate-300 shadow-inner">
                        <div className="absolute top-[28.6%] left-[28.6%] w-[42.8%] h-[42.8%] border-[3px] md:border-4 border-slate-800 pointer-events-none rounded-md z-10 shadow-sm"></div>
                        {courses.map(i => {
                          const logical = dispCourse(i);
                          const isZone = isStrikeZone(logical); const isSelected = currentPitch.course === logical;
                          return <button key={i} onClick={() => setCurrentPitch({ ...currentPitch, course: logical })} className={`rounded-md relative transition-all ${isZone ? 'bg-white' : 'bg-slate-100/80'} ${isSelected ? 'ring-2 md:ring-4 ring-blue-500 bg-blue-100 z-20 scale-110 shadow-lg' : isZone ? 'hover:bg-blue-50 hover:scale-105' : 'hover:bg-slate-200 hover:scale-105'}`}>{isSelected && <div className="absolute inset-0 bg-blue-500 opacity-20 rounded-md"></div>}</button>;
                        })}
                      </div>
                      <button onClick={togglePitchView} className={`mt-4 flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-black uppercase border-2 shadow-sm transition-all active:scale-95 ${isBackscreen ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-slate-100 border-slate-300 text-slate-500'}`}><span className="text-sm">🔄</span>{viewLabel}<span className="text-[9px] font-bold opacity-70">タップで切替</span></button>
                    </div>
                    <div className="flex-1 flex flex-col justify-between py-2 w-full max-w-sm mx-auto">
                      <div className="space-y-4">
                        
                        {/* 球種グリッド */}
                        <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-[260px] mx-auto mb-4">
                          <div></div>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: getPitchTypes(true)[0].name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === getPitchTypes(true)[0].name ? `${getPitchTypes(true)[0].colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{getPitchTypes(true)[0].icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{getPitchTypes(true)[0].name}</span>
                          </button>
                          <div></div>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name ? `${(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name}</span>
                          </button>
                          <div className="flex flex-col items-center justify-center text-[10px] font-bold text-slate-400 bg-slate-100 rounded-xl border border-slate-300 shadow-inner">
                            <span className={currentPitcherObj.throws.includes('右') ? "text-rose-600 text-sm font-black" : "text-blue-600 text-sm font-black"}>{currentPitcherObj.throws.includes('右') ? "右投" : "左投"}</span><span className="text-slate-500 tracking-widest mt-0.5">{viewLabel}</span>
                          </div>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name ? `${(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name}</span>
                          </button>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name ? `${(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name}</span>
                          </button>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: getPitchTypes(true)[4].name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === getPitchTypes(true)[4].name ? `${getPitchTypes(true)[4].colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{getPitchTypes(true)[4].icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{getPitchTypes(true)[4].name}</span>
                          </button>
                          <button onClick={() => setCurrentPitch({...currentPitch, type: (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${currentPitch.type === (layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name ? `${(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <span className="text-xl font-black leading-none mt-1">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(currentPitcherObj.throws.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name}</span>
                          </button>
                        </div>

                        <div className="space-y-3">
                          <div className="grid grid-cols-4 gap-2">
                            <button onClick={() => recordPitch('ボール')} className="col-span-2 bg-emerald-500 text-white py-4 rounded-xl font-black text-lg shadow-md active:scale-95">ボール</button>
                            <button onClick={() => recordPitch('ストライク')} className="col-span-1 bg-slate-800 text-white py-4 rounded-xl font-bold text-sm shadow-md active:scale-95">見逃しS</button>
                            <button onClick={() => recordPitch('空振り')} className="col-span-1 bg-slate-600 text-white py-4 rounded-xl font-bold text-sm shadow-md active:scale-95">空振りS</button>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <button onClick={() => recordPitch('ファウル')} className="col-span-2 bg-amber-500 text-white py-3 rounded-xl font-bold text-base shadow-md active:scale-95">ファウル</button>
                            <button onClick={() => recordPitch('バントファウル')} className="col-span-1 bg-amber-600 text-white py-3 rounded-xl font-bold text-[11px] shadow-md active:scale-95 leading-tight">バント<br/>ﾌｧｳﾙ</button>
                            <button onClick={() => recordPitch('バント空振り')} className="col-span-1 bg-slate-500 text-white py-3 rounded-xl font-bold text-[11px] shadow-md active:scale-95 leading-tight">バント<br/>空振S</button>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            <button onClick={() => recordPitch('インプレー')} className="col-span-2 bg-blue-600 text-white py-4 rounded-xl font-black text-xl shadow-lg active:scale-95">打った！</button>
                            <button onClick={() => recordPitch('バント')} className="col-span-1 bg-indigo-600 text-white py-4 rounded-xl font-black text-lg shadow-lg active:scale-95">バント</button>
                          </div>
                          <div className="grid grid-cols-5 gap-1.5 pt-2 border-t border-slate-200">
                            <button onClick={() => recordPitch('死球')} className="bg-purple-600 text-white py-2.5 rounded-lg font-bold text-[10px] shadow-sm active:scale-95">死球</button>
                            <button onClick={() => recordPitch('ウエスト')} className="bg-teal-600 text-white py-2.5 rounded-lg font-bold text-[10px] shadow-sm active:scale-95">ｳｴｽﾄ</button>
                            <button onClick={() => setShowPickoffModal(true)} className="bg-orange-500 text-white py-2.5 rounded-lg font-bold text-[10px] shadow-sm active:scale-95">牽制</button>
                            <button onClick={() => { setOutRunnerData({ runner: '', reason: '盗塁死' }); setShowOutRunnerModal(true); }} className="bg-rose-600 text-white py-2.5 rounded-lg font-bold text-[10px] shadow-sm active:scale-95">走者ｱｳﾄ</button>
                            <button onClick={() => recordPitch('その他出塁')} className="bg-cyan-600 text-white py-2.5 rounded-lg font-bold text-[10px] shadow-sm active:scale-95">他出塁</button>
                          </div>
                        </div>
                        <div className="hidden md:grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
                          <button onClick={handleUndo} disabled={undoStack.length === 0} className={`py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 ${undoStack.length > 0 ? 'bg-white border-2 border-slate-300 text-slate-600' : 'bg-slate-50 border-2 border-transparent text-slate-300 cursor-not-allowed'}`}>↩️ 戻る {undoStack.length > 0 && <span className="bg-slate-200 text-slate-600 text-[10px] px-2 rounded-full">{undoStack.length}</span>}</button>
                          <button onClick={handleRedo} disabled={redoStack.length === 0} className={`py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 ${redoStack.length > 0 ? 'bg-blue-50 border-2 border-blue-200 text-blue-700' : 'bg-slate-50 border-2 border-transparent text-slate-300 cursor-not-allowed'}`}>進む ↪️ {redoStack.length > 0 && <span className="bg-blue-200 text-blue-800 text-[10px] px-2 rounded-full">{redoStack.length}</span>}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50/50 rounded-3xl shadow-inner p-4 md:p-6 border border-blue-200 flex-1 flex flex-col min-h-[450px]">
                  <div className="flex justify-between items-center mb-4 border-b border-blue-200 pb-3">
                    <h2 className="text-lg font-black text-blue-800">🎯 打撃結果の入力</h2>
                    <button onClick={() => { handleUndo(); setSelectedHitCoord(null); setSelectedPosition(null); }} className="text-xs bg-white px-4 py-2 rounded-full border border-slate-300 shadow-sm font-bold text-slate-600">↩️ 取消して戻る</button>
                  </div>
                  {/* Step indicator */}
                  <div className="flex items-center gap-1 mb-4 px-2">
                    <div className={`flex items-center gap-1 text-xs font-black ${!selectedHitCoord ? 'text-blue-700' : 'text-emerald-600'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] ${!selectedHitCoord ? 'bg-blue-600' : 'bg-emerald-500'}`}>{selectedHitCoord ? '✓' : '1'}</span>位置
                    </div>
                    <div className="flex-1 h-px bg-slate-300"></div>
                    <div className={`flex items-center gap-1 text-xs font-black ${selectedHitCoord && !selectedPosition ? 'text-blue-700' : selectedPosition ? 'text-emerald-600' : 'text-slate-300'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] ${selectedHitCoord && !selectedPosition ? 'bg-blue-600' : selectedPosition ? 'bg-emerald-500' : 'bg-slate-200'}`}>{selectedPosition ? '✓' : '2'}</span>野手
                    </div>
                    <div className="flex-1 h-px bg-slate-300"></div>
                    <div className={`flex items-center gap-1 text-xs font-black ${selectedPosition ? 'text-blue-700' : 'text-slate-300'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] ${selectedPosition ? 'bg-blue-600' : 'bg-slate-200'}`}>3</span>結果
                    </div>
                  </div>

                  {/* STEP 1: 打球の落下点 */}
                  {!selectedHitCoord && (
                    <div className="flex-1 flex flex-col items-center justify-center w-full">
                      <p className="text-slate-600 font-bold text-sm mb-3">打球の落下点・処理位置をタップ</p>
                      <div className="relative w-full max-w-[360px] aspect-[1.2] mb-2 mx-auto bg-white p-2 rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex items-center justify-center">
                        <svg viewBox="0 0 240 200" preserveAspectRatio="xMidYMid meet" className="w-full h-full cursor-crosshair rounded-2xl" onClick={handleFieldClick} style={{ touchAction: 'none' }}>
                          <path d="M 120 185 L 0 65 L 0 0 L 240 0 L 240 65 Z" fill="#f8fafc" />
                          <path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7" />
                          <path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.8" />
                          <polygon points="120,185 80,145 120,110 160,145" fill="none" stroke="#94a3b8" strokeWidth="1" />
                          <text x="55" y="60" textAnchor="middle" fontSize="9" fontWeight="700" fill="#64748b" opacity="0.6">左</text>
                          <text x="88" y="42" textAnchor="middle" fontSize="8" fontWeight="600" fill="#64748b" opacity="0.5">左中</text>
                          <text x="120" y="35" textAnchor="middle" fontSize="9" fontWeight="700" fill="#64748b" opacity="0.6">中</text>
                          <text x="152" y="42" textAnchor="middle" fontSize="8" fontWeight="600" fill="#64748b" opacity="0.5">右中</text>
                          <text x="185" y="60" textAnchor="middle" fontSize="9" fontWeight="700" fill="#64748b" opacity="0.6">右</text>
                          <text x="82" y="130" textAnchor="middle" fontSize="8" fontWeight="600" fill="#94a3b8" opacity="0.7">三</text>
                          <text x="100" y="112" textAnchor="middle" fontSize="8" fontWeight="600" fill="#94a3b8" opacity="0.7">遊</text>
                          <text x="140" y="112" textAnchor="middle" fontSize="8" fontWeight="600" fill="#94a3b8" opacity="0.7">二</text>
                          <text x="158" y="130" textAnchor="middle" fontSize="8" fontWeight="600" fill="#94a3b8" opacity="0.7">一</text>
                          <text x="120" y="145" textAnchor="middle" fontSize="7" fontWeight="600" fill="#94a3b8" opacity="0.5">投</text>
                          <path d="M 55 120 Q 120 70 185 120" fill="none" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: 処理した野手 */}
                  {selectedHitCoord && !selectedPosition && (
                    <div className="flex-1 flex flex-col items-center w-full">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="relative w-16 h-14 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
                          <svg viewBox="0 0 240 200" className="w-full h-full">
                            <path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7" />
                            <path d="M 120 185 L 55 120 Q 120 70 185 120 Z" fill="#fef3c7" opacity="0.6" />
                            <circle cx={selectedHitCoord.x} cy={selectedHitCoord.y} r="8" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-slate-700 font-black text-base">処理した野手は？</p>
                          <button onClick={() => setSelectedHitCoord(null)} className="text-[10px] text-slate-400 underline">← 位置を選びなおす</button>
                        </div>
                      </div>
                      <div className="w-full max-w-xs mx-auto">
                        <div className="relative bg-gradient-to-b from-emerald-50 to-amber-50/50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{aspectRatio: '1'}}>
                          {/* Outfielders */}
                          <button onClick={() => setSelectedPosition('レフト')} className="absolute bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'5%',top:'5%',width:'26%',height:'22%'}}>左</button>
                          <button onClick={() => setSelectedPosition('センター')} className="absolute bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'37%',top:'2%',width:'26%',height:'22%'}}>中</button>
                          <button onClick={() => setSelectedPosition('ライト')} className="absolute bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'69%',top:'5%',width:'26%',height:'22%'}}>右</button>
                          {/* Infielders */}
                          <button onClick={() => setSelectedPosition('サード')} className="absolute bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'5%',top:'38%',width:'22%',height:'20%'}}>三</button>
                          <button onClick={() => setSelectedPosition('ショート')} className="absolute bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'28%',top:'32%',width:'20%',height:'18%'}}>遊</button>
                          <button onClick={() => setSelectedPosition('セカンド')} className="absolute bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'52%',top:'32%',width:'20%',height:'18%'}}>二</button>
                          <button onClick={() => setSelectedPosition('ファースト')} className="absolute bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'73%',top:'38%',width:'22%',height:'20%'}}>一</button>
                          {/* Battery */}
                          <button onClick={() => setSelectedPosition('ピッチャー')} className="absolute bg-slate-600 hover:bg-slate-700 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'37%',top:'58%',width:'26%',height:'18%'}}>投</button>
                          <button onClick={() => setSelectedPosition('キャッチャー')} className="absolute bg-slate-600 hover:bg-slate-700 text-white font-black rounded-xl active:scale-95 shadow-sm flex items-center justify-center text-base" style={{left:'34%',top:'80%',width:'32%',height:'17%'}}>捕</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STEP 3: 結果 */}
                  {selectedHitCoord && selectedPosition && (
                    <div className="flex-1 flex flex-col items-center w-full">
                      <div className="flex items-center gap-3 mb-4 w-full max-w-md">
                        <div className="relative w-14 h-12 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden shrink-0">
                          <svg viewBox="0 0 240 200" className="w-full h-full">
                            <path d="M 120 185 L 8 70 Q 120 -25 232 70 Z" fill="#dcfce7" />
                            <circle cx={selectedHitCoord.x} cy={selectedHitCoord.y} r="8" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-slate-800 font-black text-base">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-lg text-sm mr-1">{selectedPosition}</span>
                            の結果は？
                          </p>
                        </div>
                        <button onClick={() => { setSelectedPosition(null); setShowErrorTypeSelect(false); }} className="text-[10px] bg-slate-100 text-slate-500 border border-slate-200 px-2.5 py-1.5 rounded-lg font-bold shrink-0">← 野手変更</button>
                      </div>
                      <div className="w-full space-y-3 max-w-md">
                        <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm"><div className="grid grid-cols-3 gap-3">
                          <button onClick={() => handleInPlayFinalResult('ゴロ', 1)} className="bg-rose-50 text-rose-700 py-4 rounded-xl font-black text-lg active:scale-95 border border-rose-200">ゴロ</button>
                          <button onClick={() => handleInPlayFinalResult('飛', 1)} className="bg-orange-50 text-orange-700 py-4 rounded-xl font-black text-lg active:scale-95 border border-orange-200">飛/直</button>
                          <button onClick={() => handleInPlayFinalResult('併殺打', 2)} className="bg-rose-600 text-white py-4 rounded-xl font-black text-lg shadow-md active:scale-95">併殺打</button>
                        </div></div>
                        <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm">
                          <div className="grid grid-cols-4 gap-3">
                          <button onClick={() => handleInPlayFinalResult('安', 0)} className="bg-blue-50 text-blue-700 py-4 rounded-xl font-black active:scale-95 border border-blue-200">単打</button>
                          <button onClick={() => handleInPlayFinalResult('二塁打', 0)} className="bg-indigo-50 text-indigo-700 py-4 rounded-xl font-black active:scale-95 border border-indigo-200">二塁打</button>
                          <button onClick={() => handleInPlayFinalResult('三塁打', 0)} className="bg-purple-50 text-purple-700 py-4 rounded-xl font-black active:scale-95 border border-purple-200">三塁打</button>
                          <button onClick={() => handleInPlayFinalResult('本塁打', 0)} className="bg-pink-100 text-pink-700 py-4 rounded-xl font-black shadow-sm active:scale-95 border border-pink-200">本塁打</button>
                          </div>
                          <div className="mt-3 pt-3 border-t border-blue-100">
                            <div className="text-[10px] font-black text-blue-600 mb-2">ヒット＋エラー（ワンヒットワンエラー）</div>
                            <div className="grid grid-cols-3 gap-3">
                              <button onClick={() => handleInPlayFinalResult('安+エラー', 0)} className="bg-blue-50 text-blue-700 py-3 rounded-xl font-bold text-sm active:scale-95 border border-blue-200">単打+E</button>
                              <button onClick={() => handleInPlayFinalResult('二塁打+エラー', 0)} className="bg-indigo-50 text-indigo-700 py-3 rounded-xl font-bold text-sm active:scale-95 border border-indigo-200">二塁打+E</button>
                              <button onClick={() => handleInPlayFinalResult('三塁打+エラー', 0)} className="bg-purple-50 text-purple-700 py-3 rounded-xl font-bold text-sm active:scale-95 border border-purple-200">三塁打+E</button>
                            </div>
                          </div>
                        </div>
                        {!showErrorTypeSelect ? (
                          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><div className="grid grid-cols-4 gap-3">
                            <button onClick={() => setShowErrorTypeSelect(true)} className="bg-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm border border-slate-200">エラー</button>
                            <button onClick={() => handleInPlayFinalResult('野手選択', 0)} className="bg-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm border border-slate-200">野選</button>
                            <button onClick={() => handleInPlayFinalResult('犠打', 1)} className="bg-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm border border-slate-200">犠打</button>
                            <button onClick={() => handleInPlayFinalResult('犠飛', 1)} className="bg-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm border border-slate-200">犠飛</button>
                          </div></div>
                        ) : (
                          <div className="bg-white p-4 rounded-2xl border border-amber-300 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-black text-amber-700">エラーの種類を選択</span>
                              <button onClick={() => setShowErrorTypeSelect(false)} className="text-[10px] bg-slate-100 text-slate-500 border border-slate-200 px-2 py-1 rounded-lg font-bold">← 戻る</button>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <button onClick={() => handleInPlayFinalResult('捕球エラー', 0)} className="bg-amber-50 text-amber-800 py-3 rounded-xl font-bold text-sm border border-amber-200 active:scale-95">捕球</button>
                              <button onClick={() => handleInPlayFinalResult('送球エラー', 0)} className="bg-amber-50 text-amber-800 py-3 rounded-xl font-bold text-sm border border-amber-200 active:scale-95">送球</button>
                              <button onClick={() => handleInPlayFinalResult('落球エラー', 0)} className="bg-amber-50 text-amber-800 py-3 rounded-xl font-bold text-sm border border-amber-200 active:scale-95">落球</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right panel: history / play-by-play */}
            <div className="w-full md:w-[40%] flex flex-col gap-3 md:gap-4 overflow-hidden">
              <div className="flex bg-slate-200 rounded-xl p-1 shrink-0 shadow-inner">
                <button onClick={() => setRightPanelMode('current')} className={`flex-1 text-xs font-bold py-2 rounded-lg ${rightPanelMode === 'current' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500'}`}>📋 打席分析</button>
                <button onClick={() => setRightPanelMode('playByPlay')} className={`flex-1 text-xs font-bold py-2 rounded-lg ${rightPanelMode === 'playByPlay' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500'}`}>📰 速報</button>
              </div>

              {rightPanelMode === 'current' ? (
              <>
              <div className="hidden md:flex flex-col bg-white rounded-3xl shadow-sm p-5 border border-slate-200 shrink-0">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-black text-slate-700 flex items-center gap-2">📊 投球分析 <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-500 ml-1">{analysisData.totalPitches}球</span></h2>
                  <div className="flex gap-2">
                    <select value={analysisFilter.pitcher} onChange={e => setAnalysisFilter({...analysisFilter, pitcher: e.target.value})} className="border border-slate-200 rounded-lg text-xs px-2 py-1.5 bg-slate-50 outline-none">
                      <option value="ALL">全投手</option>{uniquePitchers.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={analysisFilter.batterSide} onChange={e => setAnalysisFilter({...analysisFilter, batterSide: e.target.value})} className="border border-slate-200 rounded-lg text-xs px-2 py-1.5 bg-slate-50 outline-none">
                      <option value="ALL">全打者</option><option value="右">右打者</option><option value="左">左打者</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-6 items-start">
                  <div className="flex flex-col items-center w-[160px] shrink-0">
                    <div className="flex bg-slate-100 rounded-lg p-1 mb-2 w-full gap-1 shadow-inner">
                      {['all','fastball','breaking'].map(tab => <button key={tab} onClick={() => setHeatmapTab(tab)} className={`flex-1 text-[10px] font-bold py-1.5 rounded-md ${heatmapTab === tab ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{tab === 'all' ? '全体' : tab === 'fastball' ? '直球' : '変化'}</button>)}
                    </div>
                    <div className="flex bg-slate-100 rounded-lg p-1 mb-3 w-full gap-1 shadow-inner">
                      {['all','ahead','even','behind'].map(tab => <button key={tab} onClick={() => setHeatmapCountTab(tab)} className={`flex-1 text-[9px] font-bold py-1 rounded-md ${heatmapCountTab === tab ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{tab === 'all' ? '全' : tab === 'ahead' ? '有利' : tab === 'even' ? '平行' : '不利'}</button>)}
                    </div>
                    <div className="grid grid-cols-7 grid-rows-7 w-full aspect-square gap-0.5 relative bg-slate-50 p-1 rounded-xl border border-slate-200 shadow-inner">
                      <div className="absolute top-[28.6%] left-[28.6%] w-[42.8%] h-[42.8%] border-[2px] border-slate-400 pointer-events-none rounded-md z-10"></div>
                      {courses.map(i => {
                        const hData = analysisData.heatmaps[heatmapTab]?.[heatmapCountTab] || {};
                        const hMax = analysisData.heatmaps[heatmapTab]?.max?.[heatmapCountTab] || 0;
                        const count = hData[i] || 0, opacity = hMax === 0 ? 0 : (count / hMax) * 0.85;
                        return (
                          <div key={`heat-${i}`} className="bg-white relative flex items-center justify-center text-[9px] font-black text-slate-700 rounded-sm overflow-hidden border border-slate-100">
                            {count > 0 && <div className={`absolute inset-0 ${heatmapTab === 'fastball' ? 'bg-rose-500' : heatmapTab === 'breaking' ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ opacity }}></div>}
                            <span className="relative z-20" style={{ color: opacity > 0.5 ? 'white' : 'inherit' }}>{count > 0 ? count : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-4 mt-1">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
                      <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">ストライク率</div>
                      <div className="text-4xl font-black text-slate-800 font-mono">{analysisData.strikeRate}<span className="text-lg text-slate-500">%</span></div>
                    </div>
                    <div className="bg-white p-3 rounded-2xl border border-slate-200 flex flex-col gap-2.5">
                      <div className="text-[10px] text-slate-500 font-bold uppercase mb-1 px-1">球種別割合</div>
                      {Object.entries(analysisData.typeCount).sort(([,a], [,b]) => b - a).slice(0, 4).map(([type, count]) => {
                        const pct = Math.round((count / (analysisData.totalPitches || 1)) * 100);
                        return (
                          <div key={type} className="flex items-center gap-3 text-xs">
                            <div className="w-16 truncate font-bold text-slate-600">{type}</div>
                            <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden shadow-inner"><div className="bg-blue-500 h-full rounded-full" style={{ width: `${pct}%` }}></div></div>
                            <div className="w-8 text-right text-slate-500 font-black font-mono">{pct}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* At-bat history */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden max-h-[250px] md:max-h-none">
                 <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
                  <div className="flex flex-col">
                    <h2 className="text-sm font-black text-slate-700">📝 打席履歴</h2>
                    <span className="text-[10px] text-slate-500 font-bold mt-0.5">{currentBatterObj.name} vs {currentPitcherObj.name}</span>
                  </div>
                  <span className="text-xs bg-white border border-slate-300 px-3 py-1 rounded-lg shadow-sm font-mono font-black text-slate-700">{currentAtBatPitches.filter(p => !p.isEvent || p.countAsPitch).length} 球</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-slate-100/50">
                  {currentAtBatPitches.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-xs font-bold uppercase">No Record</div>
                  ) : (
                    currentAtBatPitches.map((p, idx) => (
                      p.isEvent ? (
                        <div key={idx} onClick={() => handleEditPitchClick(p)} className="bg-blue-50/50 p-3 rounded-xl shadow-sm border border-blue-100 flex items-center gap-2 text-blue-800 font-bold text-xs cursor-pointer hover:bg-blue-100">
                          {p.countAsPitch && <span className="font-black text-lg text-slate-400 font-mono w-6 text-center shrink-0">{p.pitchNumber}</span>}
                          <span className="flex-1 text-center">{p.result}</span>
                          {p.countAsPitch && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold shrink-0">球数+1</span>}
                        </div>
                      ) : (
                        <div key={idx} onClick={() => handleEditPitchClick(p)} className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-3 cursor-pointer hover:border-blue-400 group">
                          <div className="font-black text-xl text-slate-300 group-hover:text-blue-400 w-6 text-center font-mono">{p.pitchNumber}</div>
                          <div className="grid grid-cols-7 grid-rows-7 w-12 h-12 gap-[0.5px] bg-slate-200 border border-slate-300 relative rounded shrink-0">
                            <div className="absolute top-[28.6%] left-[28.6%] w-[42.8%] h-[42.8%] border-[1.5px] border-slate-600 z-10 pointer-events-none"></div>
                            {p.course !== null && courses.map(i => { const logical = dispCourse(i); return <div key={i} className={`${p.course === logical ? 'bg-rose-500 z-20 relative ring-1 ring-white/50 scale-110 shadow-sm rounded-sm' : isStrikeZone(logical) ? 'bg-white' : 'bg-slate-50'}`}></div>; })}
                          </div>
                          <div className="flex-1 flex flex-col justify-center min-w-0 pr-2">
                            <div className="truncate font-bold text-xs text-slate-700">{p.type ? p.type.replace(/系$/, '') : ''}</div>
                          </div>
                          <div className={`text-white text-[10px] font-black px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap shrink-0 ${p.result.includes('ストライク')||p.result.includes('空振')||p.result==='スリーバント失敗'?'bg-amber-500':p.result==='振り逃げ'?'bg-cyan-600':p.result==='振り逃げアウト'?'bg-cyan-800':p.result==='ボール'?'bg-emerald-500':p.result==='ウエスト'?'bg-teal-600':p.result==='死球'?'bg-purple-600':['安','塁打','本塁打'].some(w=>p.result.includes(w))?'bg-blue-600':p.result?.startsWith('牽制')?'bg-orange-500':p.result.includes('ファウル')?'bg-orange-400':'bg-rose-500'}`}>{p.result}</div>
                        </div>
                      )
                    ))
                  )}
                </div>
              </div>
              </>
              ) : (
              /* Play by play */
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
                <div className="bg-slate-800 p-4 flex justify-between items-center shrink-0">
                  <h2 className="text-sm font-bold text-white">📰 テキスト速報</h2>
                  <div className="text-xs text-slate-300 font-mono bg-slate-700 px-3 py-1 rounded-lg">{pitches.filter(p => !p.isEvent || p.countAsPitch).length}球</div>
                </div>
                <div className="flex-1 overflow-y-auto bg-slate-900 p-3 md:p-4">
                  {playByPlayData.length === 0 ? <div className="flex h-full items-center justify-center text-slate-500 text-sm font-bold">まだ記録がありません</div> : (
                    playByPlayData.slice().reverse().map((inningData, iIdx) => (
                      <div key={iIdx} className="mb-4 last:mb-0">
                        <div className={`text-xs font-black px-3 py-1.5 rounded-t-xl ${inningData.isTop ? 'bg-blue-900/80 text-blue-200' : 'bg-rose-900/80 text-rose-200'}`}>{inningData.inning}回{inningData.isTop ? '表' : '裏'} {inningData.isTop ? gameInfo.teamTop : gameInfo.teamBottom}の攻撃</div>
                        <div className="bg-slate-800 rounded-b-xl border border-slate-700 border-t-0 overflow-hidden divide-y divide-slate-700/50">
                          {inningData.atBats.map((ab, abIdx) => {
                            const isHit = ['安', '塁打', '本塁打'].some(w => ab.result.includes(w));
                            const isBB = ['四球', '死球'].some(w => ab.result.includes(w));
                            const resultColor = isHit ? 'text-blue-300 bg-blue-900/40' : isBB ? 'text-emerald-300 bg-emerald-900/20' : 'text-slate-300';
                            return (
                              <div key={abIdx} className={`px-3 py-2.5 flex items-center gap-3 text-[11px] cursor-pointer hover:bg-slate-700/50 ${resultColor}`}
                                onClick={() => { jumpToInning(inningData.inning, inningData.isTop); manuallyChangeBatter(ab.batter); setRightPanelMode('current'); }}>
                                <span className="text-slate-500 font-mono w-4 text-right shrink-0">{ab.batter}</span>
                                <span className="text-slate-100 font-bold w-16 truncate shrink-0">{ab.batterName}</span>
                                <span className="text-slate-400 font-mono text-[10px] shrink-0">{ab.pitchCount}球</span>
                                <span className="font-black px-2 py-0.5 rounded flex-1 truncate">{ab.result || '打席中'}</span>
                                <button onClick={(e) => { e.stopPropagation(); scrollToPlay(inningData.inning, inningData.isTop, ab.batter); }} className="shrink-0 text-[9px] bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded-lg font-bold">🔎詳細</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              )}
            </div>
          </main>

          {/* ============================================================ */}
          {showAnalyticsHub && (
            <AnalyticsHub db={analyticsDb} notes={playerNotes} onNotesChange={setPlayerNotes} onClose={() => setShowAnalyticsHub(false)} />
          )}

          {/* ============================================================ */}
          {/* ============= MODAL 1: PITCH EDIT ========================= */}
          {/* ============================================================ */}
          {editingPitchIndex !== null && editPitchData && (
            <div className="fixed inset-0 bg-slate-900/70 z-[400] flex items-center justify-center p-4 backdrop-blur-md">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
                {editPitchData.isEvent ? (
                  <>
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center"><h2 className="font-black text-lg">🏃 イベント記録を修正</h2><button onClick={cancelPitchEdit} className="text-slate-400 hover:text-black font-bold text-xl px-2">✕</button></div>
                    <div className="p-5 flex flex-col gap-3">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">記録内容（進塁・走者アウト・選手交代など）</label>
                      <textarea value={editPitchData.result} onChange={e => setEditPitchData({...editPitchData, result: e.target.value})} rows={3} className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-bold text-sm outline-none resize-none focus:ring-2 focus:ring-blue-400" />
                      <p className="text-[10px] text-slate-400 font-bold leading-relaxed">※「1塁走者 盗塁で2塁へ」「2塁走者が盗塁死」のような走者イベントの文言は、アウト数・得点の自動再計算に使われます。走者イベントは書式を保ったまま修正してください。保存するとスコアは記録全体から再計算されます。</p>
                    </div>
                    <div className="p-4 border-t border-slate-200 flex gap-3 bg-slate-50">
                      <button onClick={deletePitchRecord} className="bg-rose-50 text-rose-600 border border-rose-200 px-4 py-3 rounded-xl font-bold">削除</button>
                      <button onClick={cancelPitchEdit} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold">ｷｬﾝｾﾙ</button>
                      <button onClick={savePitchEdit} className="flex-[1.5] bg-blue-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">上書き保存</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-4 border-b border-blue-200 bg-blue-50 flex justify-between items-center"><h2 className="font-black text-base"><span className="bg-white px-2 py-0.5 rounded shadow-sm text-blue-600 text-sm">第{editPitchData.pitchNumber}球</span> を修正</h2><button onClick={cancelPitchEdit} className="text-blue-400 hover:text-blue-800 font-bold text-xl px-2">✕</button></div>
                    <div className="p-5 flex flex-col gap-6 bg-slate-50/50 overflow-y-auto max-h-[70vh]">
                      {/* 打順違いの修正 */}
                      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-500 uppercase">打者（打順違いの修正）</span>
                        <select value={editPitchData.batter} onChange={e => {
                          const n = Number(e.target.value);
                          const lu = (editPitchData.isTop ? lineups.top : lineups.bottom)[n - 1] || {};
                          setEditPitchData({ ...editPitchData, batter: n, batterName: lu.name || '', batterBats: lu.bats || '右', batterThrows: lu.throws || '右', batterPos: lu.pos || editPitchData.batterPos, applyBatterToAtBat: editPitchData.applyBatterToAtBat ?? true });
                        }} className="w-full border border-slate-300 rounded-lg px-2 py-2.5 text-sm font-bold bg-white outline-none">
                          {[1,2,3,4,5,6,7,8,9].map(n => { const lu = (editPitchData.isTop ? lineups.top : lineups.bottom)[n - 1]; return <option key={n} value={n}>{n}番 {lu?.name || ''}</option>; })}
                        </select>
                        {pitches[editingPitchIndex] && editPitchData.batter !== pitches[editingPitchIndex].batter && (
                          <>
                            <label className="flex items-center gap-2 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 cursor-pointer">
                              <input type="checkbox" checked={editPitchData.applyBatterToAtBat !== false} onChange={e => setEditPitchData({ ...editPitchData, applyBatterToAtBat: e.target.checked })} className="w-4 h-4 accent-amber-600 shrink-0" />
                              この打席（{pitches[editingPitchIndex].batter}番 {pitches[editingPitchIndex].batterName}）の記録をまとめて{editPitchData.batter}番に付け替える
                            </label>
                            <p className="text-[10px] text-slate-400 font-bold leading-relaxed">※打者名は現在のオーダーから自動設定され、球数は打席ごとに振り直されます。保存後はアウト数・走者・得点も再計算されます</p>
                          </>
                        )}
                      </div>
                      <div className="flex flex-col items-center bg-white p-4 rounded-2xl border border-slate-200">
                        <span className="text-xs font-bold text-slate-500 mb-3 uppercase">ランナー</span>
                        <div className="flex gap-4 relative w-20 h-20">
                          <button onClick={() => toggleEditRunner('second')} className={`absolute top-0 left-1/2 -translate-x-1/2 w-6 h-6 transform rotate-45 border-2 ${editPitchData.runners?.second ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-slate-50'}`}></button>
                          <button onClick={() => toggleEditRunner('third')} className={`absolute top-1/2 left-0 -translate-y-1/2 w-6 h-6 transform rotate-45 border-2 ${editPitchData.runners?.third ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-slate-50'}`}></button>
                          <button onClick={() => toggleEditRunner('first')} className={`absolute top-1/2 right-0 -translate-y-1/2 w-6 h-6 transform rotate-45 border-2 ${editPitchData.runners?.first ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-slate-50'}`}></button>
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-6 transform rotate-45 border-2 border-slate-400 bg-slate-200"></div>
                        </div>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-slate-500 uppercase">コース</span>
                          <button onClick={togglePitchView} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black border ${isBackscreen ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>🔄{viewLabel}</button>
                        </div>
                        <div className="grid grid-cols-7 grid-rows-7 w-48 h-48 relative bg-slate-200 p-1.5 rounded-xl border border-slate-300 shadow-inner gap-px">
                          <div className="absolute top-[28.6%] left-[28.6%] w-[42.8%] h-[42.8%] border-[3px] border-slate-700 z-10 pointer-events-none rounded-md"></div>
                          {courses.map(i => { const logical = dispCourse(i); return <button key={i} onClick={() => setEditPitchData({...editPitchData, course: logical})} className={`relative rounded-sm ${isStrikeZone(logical) ? 'bg-white' : 'bg-slate-100/50'} ${editPitchData.course === logical ? 'ring-2 ring-blue-500 bg-blue-400 z-20 scale-110 shadow-lg' : ''}`}></button>; })}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-[260px] mx-auto mb-4">
                        <div></div>
                        <button onClick={() => setEditPitchData({...editPitchData, type: getPitchTypes(true)[0].name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === getPitchTypes(true)[0].name ? `${getPitchTypes(true)[0].colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{getPitchTypes(true)[0].icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{getPitchTypes(true)[0].name}</span>
                        </button>
                        <div></div>
                        <button onClick={() => setEditPitchData({...editPitchData, type: (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name ? `${(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[2] : getPitchTypes(false)[1]).name}</span>
                        </button>
                        <div className="flex flex-col items-center justify-center text-[10px] font-bold text-slate-400 bg-slate-100 rounded-xl border border-slate-300 shadow-inner">
                          <span className={editPitchData.pitcherThrows.includes('右') ? "text-rose-600 text-sm font-black" : "text-blue-600 text-sm font-black"}>{editPitchData.pitcherThrows.includes('右') ? "右投" : "左投"}</span><span className="text-slate-500 tracking-widest mt-0.5">{viewLabel}</span>
                        </div>
                        <button onClick={() => setEditPitchData({...editPitchData, type: (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name ? `${(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[1] : getPitchTypes(false)[2]).name}</span>
                        </button>
                        <button onClick={() => setEditPitchData({...editPitchData, type: (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name ? `${(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[5] : getPitchTypes(false)[3]).name}</span>
                        </button>
                        <button onClick={() => setEditPitchData({...editPitchData, type: getPitchTypes(true)[4].name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === getPitchTypes(true)[4].name ? `${getPitchTypes(true)[4].colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{getPitchTypes(true)[4].icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{getPitchTypes(true)[4].name}</span>
                        </button>
                        <button onClick={() => setEditPitchData({...editPitchData, type: (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name})} className={`flex flex-col items-center justify-center py-2 border-2 rounded-xl transition-all shadow-sm ${editPitchData.type === (layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name ? `${(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).colorClass} shadow-md scale-105` : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
                          <span className="text-xl font-black leading-none mt-1">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).icon}</span><span className="text-[10px] font-bold mt-1 tracking-tighter">{(layoutRight(editPitchData.pitcherThrows.includes('右')) ? getPitchTypes(true)[3] : getPitchTypes(false)[5]).name}</span>
                        </button>
                      </div>

                      <div className="flex flex-col gap-2 w-full">
                        <div className="grid grid-cols-4 gap-2">
                          <button onClick={() => setEditPitchData({...editPitchData, result: 'ボール'})} className="col-span-2 bg-emerald-500 text-white py-3 rounded-xl font-bold text-sm">ボール</button>
                          <button onClick={() => setEditPitchData({...editPitchData, result: 'ストライク'})} className="bg-slate-800 text-white py-3 rounded-xl font-bold text-xs">見逃しS</button>
                          <button onClick={() => setEditPitchData({...editPitchData, result: '空振り'})} className="bg-slate-600 text-white py-3 rounded-xl font-bold text-xs">空振りS</button>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <button onClick={() => setEditPitchData({...editPitchData, result: 'ファウル'})} className="col-span-2 bg-amber-500 text-white py-2.5 rounded-xl font-bold text-sm">ファウル</button>
                          <button onClick={() => setEditPitchData({...editPitchData, result: 'バントファウル'})} className="bg-amber-600 text-white py-2.5 rounded-xl font-bold text-[10px] leading-tight">ﾊﾞﾝﾄﾌｧｳﾙ</button>
                          <button onClick={() => setEditPitchData({...editPitchData, result: 'バント空振り'})} className="bg-slate-500 text-white py-2.5 rounded-xl font-bold text-[10px] leading-tight">ﾊﾞﾝﾄ空振S</button>
                        </div>
                      </div>
                      <div className="flex flex-col bg-white p-4 rounded-2xl border border-slate-200">
                        <span className="text-xs font-bold text-slate-500 mb-2 text-center">結果を直接入力</span>
                        <input type="text" value={editPitchData.result} onChange={e => setEditPitchData({...editPitchData, result: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-center font-black text-lg outline-none" placeholder="結果テキスト" />
                      </div>
                    </div>
                    <div className="p-4 border-t border-slate-200 flex gap-2 bg-white">
                      <button onClick={deletePitchRecord} className="bg-rose-50 text-rose-600 border border-rose-200 px-4 py-3 rounded-xl font-bold">削除</button>
                      <button onClick={cancelPitchEdit} className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-bold">ｷｬﾝｾﾙ</button>
                      <button onClick={savePitchEdit} className="flex-[1.5] bg-blue-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">上書き保存</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL: SUBSTITUTION (選手交代) =============== */}
          {/* ============================================================ */}
          {showSubstitutionModal && (() => {
            const retroIndex = subData.insertIndex;
            const isRetro = retroIndex !== null && retroIndex !== undefined;
            const retroTarget = isRetro ? pitches[retroIndex] : null;
            const isPosChange = subData.type === POSITION_CHANGE_TYPE;
            return (
            <div className="fixed inset-0 bg-slate-900/80 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
                <div className={`p-4 border-b border-slate-200 flex justify-between items-center ${isRetro ? 'bg-amber-600' : 'bg-slate-800'}`}>
                  <h2 className="text-lg font-black text-white">🔄 選手交代{isRetro ? '（さかのぼり）' : ''}</h2>
                  <button onClick={() => setShowSubstitutionModal(false)} className="text-white/60 hover:text-white font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-5 flex flex-col gap-4 overflow-y-auto modal-scroll">
                  {/* さかのぼり挿入の位置表示 */}
                  {isRetro && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <div className="text-[10px] font-black text-amber-700 mb-1">⏪ この場面の直前に交代を挿入します</div>
                      <div className="text-xs font-bold text-slate-700">
                        {retroTarget ? `${retroTarget.inning}回${retroTarget.isTop ? '表' : '裏'} ${retroTarget.batter}番 ${retroTarget.batterName}${retroTarget.isEvent ? '' : ` / ${retroTarget.result}`}` : '記録の最後'}
                      </div>
                      <div className="text-[10px] font-bold text-amber-600 mt-1">※これ以降の打席・投球記録は、交代後の選手の記録として書き換えられます</div>
                    </div>
                  )}
                  {/* チーム選択 */}
                  <div className="flex bg-slate-100 rounded-lg p-1">
                    <button onClick={()=>setSubData({...subData, team: 'top', order: isRetro ? 1 : (gameState.isTop?gameState.batterTop:1)})} className={`flex-1 py-2 text-xs font-bold rounded-md ${subData.team === 'top' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500'}`}>{gameInfo.teamTop}</button>
                    <button onClick={()=>setSubData({...subData, team: 'bottom', order: isRetro ? 1 : (!gameState.isTop?gameState.batterBottom:1)})} className={`flex-1 py-2 text-xs font-bold rounded-md ${subData.team === 'bottom' ? 'bg-white shadow-sm text-rose-700' : 'text-slate-500'}`}>{gameInfo.teamBottom}</button>
                  </div>
                  {/* 交代タイプ */}
                  <div className="grid grid-cols-5 gap-1.5">
                    {['代打', '代走', '守備', '投手', POSITION_CHANGE_TYPE].map(t => (
                      <button key={t} onClick={() => {
                        // 位置変更はその打順の選手をそのまま動かすので、今のポジションを初期値にする
                        if(t === POSITION_CHANGE_TYPE) {
                          const cur = subLineup[subData.order-1] || {};
                          setSubData({...subData, type: t, newPos: cur.pos || '未', newName: cur.name || '', newThrows: cur.throws || '右', newBats: cur.bats || '右', shiftOrder: null, shiftNewPos: ''});
                          return;
                        }
                        let p = '未'; if(t==='代打') p='打'; if(t==='代走') p='走'; if(t==='投手') p='投';
                        let targetOrder = subData.order;
                        if(t==='投手') {
                           // 投手の打順を自動検索
                           const pIdx = subLineup.findIndex(pl => pl.pos === '投' || pl.pos === '1' || pl.pos === '①');
                           if(pIdx !== -1) targetOrder = pIdx + 1;
                        }
                        setSubData({...subData, type: t, newPos: p, order: targetOrder, shiftOrder: null, shiftNewPos: ''});
                      }} className={`py-2 rounded-xl text-[11px] font-bold border-2 ${subData.type === t ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{t}</button>
                    ))}
                  </div>
                  {/* 打順選択と退く選手 */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <label className="text-[10px] font-bold text-slate-500 mb-2 block">対象の選手（{isPosChange ? '動かす選手' : '退く選手'}）</label>
                    {/* 守備位置ショートカット */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {['投','捕','一','二','三','遊','左','中','右'].map(pos => {
                        const idx = subLineup.findIndex(p => p.pos === pos);
                        const active = idx !== -1 && (idx + 1) === subData.order;
                        return (
                          <button key={pos} disabled={idx === -1} onClick={() => { if(idx === -1) return; const updates = {order: idx+1, shiftOrder: null, shiftNewPos: ''}; if(subData.type === '守備' || isPosChange) updates.newPos = pos; setSubData({...subData, ...updates}); }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${active ? 'bg-slate-700 text-white border-slate-700' : idx !== -1 ? 'bg-white border-slate-300 text-slate-600 hover:border-slate-500 hover:bg-slate-50' : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'}`}>
                            {pos}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={subData.order} onChange={e=>{ const n = Number(e.target.value); const cur = subLineup[n-1] || {}; setSubData({...subData, order: n, shiftOrder: null, shiftNewPos: '', ...(isPosChange ? { newPos: cur.pos || '未', newName: cur.name || '', newThrows: cur.throws || '右', newBats: cur.bats || '右' } : {})}); }} className="bg-white border border-slate-300 rounded-lg px-2 py-2 text-sm font-bold">
                        {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n === 10 ? '控/投' : `${n}番`}</option>)}
                      </select>
                      <div className="flex-1 bg-slate-200/50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-600 flex items-center gap-2 min-w-0">
                        <span className="shrink-0 bg-slate-500 text-white text-[10px] font-black rounded px-1.5 py-0.5">{subLineup[subData.order-1]?.pos || '?'}</span>
                        <span className="truncate">{subLineup[subData.order-1]?.name || '未設定'}</span>
                      </div>
                    </div>
                  </div>
                  {/* 新しい選手(位置変更のときは選手を入れ替えないので入力しない) */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-slate-500 block">{isPosChange ? '新しい守備位置' : '入る選手'}</label>
                    {isPosChange && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-2 text-sm">
                        <span className="text-[10px] font-black text-slate-400 shrink-0">動かす</span>
                        <span className="shrink-0 bg-slate-500 text-white text-[10px] font-black rounded px-1.5 py-0.5">{subLineup[subData.order-1]?.pos || '?'}</span>
                        <span className="font-bold truncate">{subLineup[subData.order-1]?.name || '未設定'}</span>
                        <span className="text-slate-400 shrink-0">→</span>
                        <span className="shrink-0 bg-blue-600 text-white text-[10px] font-black rounded px-1.5 py-0.5">{subData.newPos}</span>
                      </div>
                    )}
                    <datalist id="sub-roster-list">
                      {getRosterPlayers(subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom).map((pl, idx) => <option key={idx} value={pl.name} />)}
                    </datalist>
                    {/* 控え選手・登録選手からワンタップで選ぶ(出場中の選手も選択できる) */}
                    {!isPosChange && subCandidates.length > 0 && (
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-400 mb-1.5">控え・登録選手から選ぶ</div>
                        <div className="flex flex-wrap gap-1">
                          {subCandidates.map(c => {
                            const active = subData.newName === c.name;
                            return (
                              <button key={c.name} type="button" onClick={() => setSubData({...subData, newName: c.name, newThrows: c.throws, newBats: c.bats})}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1 ${active ? 'bg-blue-600 text-white border-blue-600' : c.onField ? 'bg-white border-slate-200 text-slate-400' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-500'}`}>
                                <span className="truncate max-w-[7rem]">{c.name}</span>
                                {c.fromBench && <span className={`text-[9px] font-black rounded px-1 ${active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700'}`}>控</span>}
                                {c.onField && <span className={`text-[9px] font-black rounded px-1 ${active ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-500'}`}>出場中</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className={`flex gap-1.5 ${isPosChange ? 'hidden' : ''}`}>
                      <input type="text" list="sub-roster-list" autoComplete="off" value={subData.newName} onChange={e => { const pl = getRosterPlayers(subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom).find(r => r.name === e.target.value); setSubData({...subData, newName: e.target.value, ...(pl ? {newThrows: pl.throws||'右', newBats: pl.bats||'右'} : {})}); }} placeholder="新しい選手名" className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold" />
                      {subData.newName && <button type="button" onClick={() => setSubData({...subData, newName: ''})} className="text-slate-300 hover:text-slate-500 font-bold text-sm px-2 border border-slate-300 rounded-lg bg-white">×</button>}
                    </div>
                    {!isPosChange && subData.newName && findRegisteredTeam(subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom) && !getRosterPlayers(subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom).some(pl => pl.name === subData.newName) && (
                      <button type="button" onClick={() => addPlayerToTeam(subData.team === 'top' ? gameInfo.teamTop : gameInfo.teamBottom, subData.newName, subData.newThrows||'右', subData.newBats||'右')} className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-3 py-1.5 font-bold self-start">＋ チームに追加登録</button>
                    )}
                    {(subData.type === '守備' || isPosChange) ? (
                      <>
                        {/* ポジション選択（守備交代・位置変更で使う） */}
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-400 mb-1.5">{isPosChange ? '移動先のポジション' : '入るポジション'}</div>
                          <div className="flex flex-wrap gap-1">
                            {['投','捕','一','二','三','遊','左','中','右'].map(ePos => {
                              const vacatedPos = subLineup[subData.order-1]?.pos;
                              const occupiedIdx = subLineup.findIndex(p => p.pos === ePos);
                              const isActive = subData.newPos === ePos;
                              return (
                                <button key={ePos} onClick={() => {
                                  if(ePos !== vacatedPos && occupiedIdx !== -1 && occupiedIdx !== subData.order-1) {
                                    setSubData({...subData, newPos: ePos, shiftOrder: occupiedIdx+1, shiftNewPos: vacatedPos || ''});
                                  } else {
                                    setSubData({...subData, newPos: ePos, shiftOrder: null, shiftNewPos: ''});
                                  }
                                }} className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-500'}`}>{ePos}</button>
                              );
                            })}
                          </div>
                        </div>
                        {/* ポジション移動の確認表示 */}
                        {subData.shiftOrder && (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 text-sm">
                            <span className="text-[10px] font-black text-amber-600 shrink-0">移動</span>
                            <span className="shrink-0 bg-amber-500 text-white text-[10px] font-black rounded px-1.5 py-0.5">{subData.newPos}</span>
                            <span className="font-bold truncate">{subLineup[subData.shiftOrder-1]?.name || '?'}</span>
                            <span className="text-slate-400 shrink-0">→</span>
                            <span className="shrink-0 bg-slate-600 text-white text-[10px] font-black rounded px-1.5 py-0.5">{subData.shiftNewPos}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex gap-2 mt-1">
                        <select value={subData.newPos} onChange={e=>setSubData({...subData, newPos: e.target.value})} className="flex-1 bg-white border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold">
                          {posOptions.map(po => <option key={po} value={po}>{po}</option>)}
                        </select>
                        <select value={parseThrowBat(subData.newBats, subData.newThrows)} onChange={e => { const {bats, throws} = splitThrowBat(e.target.value); setSubData({...subData, newBats: bats, newThrows: throws}); }} className="flex-[1.5] bg-white border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold">
                          {throwBatOptions.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 flex gap-3 bg-slate-50 shrink-0">
                  <button onClick={() => { setShowSubstitutionModal(false); if (isRetro) setShowRecordEditor(true); }} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                  <button onClick={handleSubstitution} className={`flex-1 text-white py-3 rounded-xl font-black shadow-md active:scale-95 ${isRetro ? 'bg-amber-600' : 'bg-blue-600'}`}>{isRetro ? 'この場面に挿入' : '交代を実行'}</button>
                </div>
              </div>
            </div>
            );
          })()}

          {/* ============================================================ */}
          {/* ============= MODAL 2: SETTINGS (オーダー設定) ============= */}
          {/* ============================================================ */}
          {showSettings && (
            <div className="fixed inset-0 bg-slate-900/80 z-[200] flex items-center justify-center p-3 backdrop-blur-sm">
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-300">
                <div className="p-4 border-b border-slate-300 bg-gradient-to-r from-slate-700 to-slate-800 flex justify-between items-center shrink-0">
                  <h2 className="text-lg font-black text-white">⚙️ オーダー設定</h2>
                  <button onClick={closeOrderSettings} className="text-slate-300 hover:text-white font-bold text-xl px-2">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 modal-scroll">
                  <div className="mb-4 flex gap-3 flex-wrap items-end">
                    <div className="flex-1 min-w-[120px]"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">日付</label><input type="text" value={gameInfo.date} onChange={e=>setGameInfo({...gameInfo, date: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold bg-white" /></div>
                    <div className="min-w-[140px]"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">試合種別</label><select value={gameInfo.gameType||'練習試合'} onChange={e=>setGameInfo({...gameInfo,gameType:e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold bg-white"><option>公式戦</option><option>練習試合</option><option>紅白戦</option><option>大会</option><option>その他</option></select></div>
                    <div className="min-w-[160px]"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">自チーム</label><select value={homeTeamName} onChange={e=>setHomeTeamName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold bg-white"><option value="">未設定</option>{registeredTeams.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}</select></div>
                    <button onClick={swapTopAndBottom} className="bg-blue-50 text-blue-700 py-2.5 px-4 rounded-xl font-bold text-xs border border-blue-200 whitespace-nowrap">⇅ 先攻/後攻入替</button>
                    <button onClick={applyLineupToPast} className="bg-amber-50 text-amber-700 py-2.5 px-4 rounded-xl font-bold text-xs border border-amber-200 whitespace-nowrap">💡 過去記録に反映</button>
                  </div>
                  <datalist id="roster-top-list">
                    {getRosterPlayers(gameInfo.teamTop).map((pl, idx) => <option key={idx} value={pl.name} />)}
                  </datalist>
                  <datalist id="roster-bottom-list">
                    {getRosterPlayers(gameInfo.teamBottom).map((pl, idx) => <option key={idx} value={pl.name} />)}
                  </datalist>
                  <div className="flex flex-col md:flex-row gap-4">

                    {/* 先攻オーダー */}
                    <div className="flex-1 bg-blue-50/60 rounded-2xl border border-blue-200/70 p-3">
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2 w-full">
                            <h3 className="font-black text-sm text-blue-800 shrink-0">先攻</h3>
                            <input type="text" value={gameInfo.teamTop} onChange={e=>setGameInfo({...gameInfo, teamTop: e.target.value})} className="flex-1 font-black text-sm border border-blue-300 rounded px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-blue-400 text-blue-900" placeholder="先攻チーム名" />
                          </div>
                          {findRegisteredTeam(gameInfo.teamTop) && <button onClick={() => applyTeamToLineup(findRegisteredTeam(gameInfo.teamTop), 'top')} className="text-[10px] bg-blue-600 text-white px-2 py-1.5 rounded-lg font-bold shadow-sm ml-2 shrink-0">登録反映</button>}
                        </div>
                        {registeredTeams.length > 0 && (
                          <select value="" onChange={e => { const t = findRegisteredTeam(e.target.value); if (t) { applyTeamToLineup(t, 'top'); showToast(`${t.name}のオーダーを反映しました`); } }} className="w-full text-[11px] font-bold border border-blue-200 rounded-lg px-2 py-1.5 bg-white text-blue-700 mb-2">
                            <option value="">📋 登録チームから選択して反映...</option>
                            {registeredTeams.map(t => <option key={t.name} value={t.name}>{t.name}（{(t.players||[]).length}人）</option>)}
                          </select>
                        )}
                        <div className="text-[9px] font-bold text-slate-400 flex items-center gap-1 mb-1 px-1">
                          <span className="w-6 text-center">打順</span><span className="w-9 text-center">守備</span><span className="flex-1">氏名</span><span className="w-[70px] text-center">投打</span>
                        </div>
                        <div className="space-y-1">
                          {lineups.top.map((p, i) => (
                            <div key={i} className="flex items-center gap-1 bg-white/80 rounded-lg border border-slate-200 px-1.5 py-1">
                              <span className="w-6 text-center text-xs font-black text-slate-400 shrink-0">{p.order}</span>
                              <select value={p.pos} onChange={e => { const nl = [...lineups.top]; nl[i] = {...nl[i], pos: e.target.value}; setLineups(prev => ({...prev, top: nl})); }} className="w-9 text-[10px] font-bold border border-slate-200 rounded px-0.5 py-1 bg-slate-50 text-center shrink-0">
                                {posOptions.map(po => <option key={po} value={po}>{po}</option>)}
                              </select>
                              {getRosterPlayers(gameInfo.teamTop).length > 0 && (
                                <button type="button" onClick={() => setPlayerPicker({ side: 'top', index: i })} title="登録選手から選択" className="shrink-0 text-[11px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-1 font-bold">📋</button>
                              )}
                              <input type="text" list="roster-top-list" autoComplete="off" value={p.name} onChange={e => onLineupNameChange('top', i, e.target.value)} className="flex-1 text-xs font-bold border border-slate-200 rounded px-2 py-1 min-w-0" placeholder="選手名" />
                              {p.name && <button type="button" onClick={() => onLineupNameChange('top', i, '')} className="shrink-0 text-slate-300 hover:text-slate-500 text-[10px] font-bold px-1.5 py-1 bg-white border border-slate-200 rounded">×</button>}
                              {p.name && findRegisteredTeam(gameInfo.teamTop) && !getRosterPlayers(gameInfo.teamTop).some(pl => pl.name === p.name) && (
                                <button type="button" onClick={() => addPlayerToTeam(gameInfo.teamTop, p.name, p.throws||'右', p.bats||'右')} title="チームに追加登録" className="shrink-0 text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-200 rounded px-1.5 py-1 font-bold">+登録</button>
                              )}
                              <select value={parseThrowBat(p.bats, p.throws)} onChange={e => { const {bats, throws} = splitThrowBat(e.target.value); const nl = [...lineups.top]; nl[i] = {...nl[i], bats, throws}; setLineups(prev => ({...prev, top: nl})); }} className="w-[70px] text-[10px] font-bold border border-slate-200 rounded px-0.5 py-1 bg-slate-50 shrink-0">
                                {throwBatOptions.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setLineups(prev => ({...prev, top: [...prev.top, { order: '控', name: '', pos: '控', throws: '右', bats: '右' }]}))} className="mt-1.5 text-[10px] bg-white/60 text-slate-500 px-3 py-1.5 rounded-lg font-bold border border-slate-200 w-full hover:bg-white">＋ 控え追加</button>
                      </div>
                    </div>

                    {/* 後攻オーダー */}
                    <div className="flex-1 bg-rose-50/60 rounded-2xl border border-rose-200/70 p-3">
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2 w-full">
                            <h3 className="font-black text-sm text-rose-800 shrink-0">後攻</h3>
                            <input type="text" value={gameInfo.teamBottom} onChange={e=>setGameInfo({...gameInfo, teamBottom: e.target.value})} className="flex-1 font-black text-sm border border-rose-300 rounded px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-rose-400 text-rose-900" placeholder="後攻チーム名" />
                          </div>
                          {findRegisteredTeam(gameInfo.teamBottom) && <button onClick={() => applyTeamToLineup(findRegisteredTeam(gameInfo.teamBottom), 'bottom')} className="text-[10px] bg-rose-600 text-white px-2 py-1.5 rounded-lg font-bold shadow-sm ml-2 shrink-0">登録反映</button>}
                        </div>
                        {registeredTeams.length > 0 && (
                          <select value="" onChange={e => { const t = findRegisteredTeam(e.target.value); if (t) { applyTeamToLineup(t, 'bottom'); showToast(`${t.name}のオーダーを反映しました`); } }} className="w-full text-[11px] font-bold border border-rose-200 rounded-lg px-2 py-1.5 bg-white text-rose-700 mb-2">
                            <option value="">📋 登録チームから選択して反映...</option>
                            {registeredTeams.map(t => <option key={t.name} value={t.name}>{t.name}（{(t.players||[]).length}人）</option>)}
                          </select>
                        )}
                        <div className="text-[9px] font-bold text-slate-400 flex items-center gap-1 mb-1 px-1">
                          <span className="w-6 text-center">打順</span><span className="w-9 text-center">守備</span><span className="flex-1">氏名</span><span className="w-[70px] text-center">投打</span>
                        </div>
                        <div className="space-y-1">
                          {lineups.bottom.map((p, i) => (
                            <div key={i} className="flex items-center gap-1 bg-white/80 rounded-lg border border-slate-200 px-1.5 py-1">
                              <span className="w-6 text-center text-xs font-black text-slate-400 shrink-0">{p.order}</span>
                              <select value={p.pos} onChange={e => { const nl = [...lineups.bottom]; nl[i] = {...nl[i], pos: e.target.value}; setLineups(prev => ({...prev, bottom: nl})); }} className="w-9 text-[10px] font-bold border border-slate-200 rounded px-0.5 py-1 bg-slate-50 text-center shrink-0">
                                {posOptions.map(po => <option key={po} value={po}>{po}</option>)}
                              </select>
                              {getRosterPlayers(gameInfo.teamBottom).length > 0 && (
                                <button type="button" onClick={() => setPlayerPicker({ side: 'bottom', index: i })} title="登録選手から選択" className="shrink-0 text-[11px] bg-rose-50 text-rose-600 border border-rose-200 rounded px-1.5 py-1 font-bold">📋</button>
                              )}
                              <input type="text" list="roster-bottom-list" autoComplete="off" value={p.name} onChange={e => onLineupNameChange('bottom', i, e.target.value)} className="flex-1 text-xs font-bold border border-slate-200 rounded px-2 py-1 min-w-0" placeholder="選手名" />
                              {p.name && <button type="button" onClick={() => onLineupNameChange('bottom', i, '')} className="shrink-0 text-slate-300 hover:text-slate-500 text-[10px] font-bold px-1.5 py-1 bg-white border border-slate-200 rounded">×</button>}
                              {p.name && findRegisteredTeam(gameInfo.teamBottom) && !getRosterPlayers(gameInfo.teamBottom).some(pl => pl.name === p.name) && (
                                <button type="button" onClick={() => addPlayerToTeam(gameInfo.teamBottom, p.name, p.throws||'右', p.bats||'右')} title="チームに追加登録" className="shrink-0 text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-200 rounded px-1.5 py-1 font-bold">+登録</button>
                              )}
                              <select value={parseThrowBat(p.bats, p.throws)} onChange={e => { const {bats, throws} = splitThrowBat(e.target.value); const nl = [...lineups.bottom]; nl[i] = {...nl[i], bats, throws}; setLineups(prev => ({...prev, bottom: nl})); }} className="w-[70px] text-[10px] font-bold border border-slate-200 rounded px-0.5 py-1 bg-slate-50 shrink-0">
                                {throwBatOptions.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setLineups(prev => ({...prev, bottom: [...prev.bottom, { order: '控', name: '', pos: '控', throws: '右', bats: '右' }]}))} className="mt-1.5 text-[10px] bg-white/60 text-slate-500 px-3 py-1.5 rounded-lg font-bold border border-slate-200 w-full hover:bg-white">＋ 控え追加</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-300 bg-gradient-to-r from-slate-100 to-slate-200 shrink-0">
                  <button onClick={closeOrderSettings} className="w-full bg-blue-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">閉じる</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* 選手選択ポップアップ (オーダー設定から起動) */}
          {playerPicker && (() => {
            const side = playerPicker.side;
            const teamName = side === 'top' ? gameInfo.teamTop : gameInfo.teamBottom;
            const roster = getRosterPlayers(teamName);
            const currentName = (lineups[side][playerPicker.index] || {}).name;
            // 「出場中」は先発オーダー(打順9人+控/投)に入っている選手のみ。
            // 控え欄に登録しただけの選手は交代要員なので、そのまま選べるようにする
            const usedNames = new Set(lineups[side].slice(0, STARTING_SLOTS).map(p => p.name).filter(n => n && n !== currentName));
            return (
              <div className="fixed inset-0 bg-slate-900/60 z-[400] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPlayerPicker(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs max-h-[70vh] flex flex-col overflow-hidden border border-slate-200" onClick={e => e.stopPropagation()}>
                  <div className="p-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                    <div>
                      <div className="text-sm font-black text-slate-800">📋 登録選手から選択</div>
                      <div className="text-[10px] font-bold text-slate-500">{teamName}</div>
                    </div>
                    <button onClick={() => setPlayerPicker(null)} className="text-slate-400 hover:text-black font-bold text-xl px-2">✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto modal-scroll p-2 space-y-1">
                    {roster.length === 0 && <p className="text-center text-slate-400 text-xs py-6">登録選手がいません</p>}
                    {roster.map((pl, idx) => {
                      const used = usedNames.has(pl.name);
                      return (
                        <button key={idx} disabled={used} onClick={() => { onLineupNameChange(side, playerPicker.index, pl.name, { dropBench: true }); setPlayerPicker(null); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left ${used ? 'bg-slate-50 border-slate-100 text-slate-300' : pl.name === currentName ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-slate-200 text-slate-700 active:bg-blue-50'}`}>
                          <span className="text-xs font-black truncate">{pl.name}</span>
                          <span className="text-[9px] font-bold shrink-0 flex items-center gap-1.5">
                            <span className={used ? '' : 'text-slate-400'}>{pl.throws || '右'}投{pl.bats || '右'}打</span>
                            {used && <span className="bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full">出場中</span>}
                            {pl.name === currentName && <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">選択中</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ============= MODAL 3: TEAM MANAGER (チーム管理) =========== */}
          {/* ============================================================ */}
          {showTeamManager && (
            <div className="fixed inset-0 bg-slate-900/70 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] border border-slate-200">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                  <h2 className="text-lg font-black text-slate-800">👥 チーム管理</h2>
                  <button onClick={() => setShowTeamManager(false)} className="text-slate-400 hover:text-black font-bold text-xl px-2">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 modal-scroll">
                  {editingTeamIndex !== null ? (
                    <div className="space-y-4">
                      <div><label className="text-xs font-bold text-slate-500">チーム名</label>
                        <input type="text" value={(registeredTeams[editingTeamIndex]||{}).name||''} onChange={e => { const t = [...registeredTeams]; const oldName = t[editingTeamIndex]?.name; t[editingTeamIndex] = {...t[editingTeamIndex], name: e.target.value}; setRegisteredTeams(t); if (oldName === homeTeamName) setHomeTeamName(e.target.value); }} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold mt-1" />
                      </div>
                      {(registeredTeams[editingTeamIndex]||{}).name === homeTeamName ? (
                        <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-3 space-y-3">
                          <div className="flex items-center justify-between"><div><div className="text-sm font-black text-blue-800">🏠 自チーム専用設定</div><p className="text-[10px] font-bold text-blue-600">対戦相手とは別に、チーム情報と選手情報を詳しく管理します</p></div><span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black text-white">自チーム</span></div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[10px] font-bold text-slate-500">略称<input value={(registeredTeams[editingTeamIndex]||{}).shortName||''} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],shortName:e.target.value}; setRegisteredTeams(t); }} placeholder="例：駿河C" className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs" /></label>
                            <label className="text-[10px] font-bold text-slate-500">地域・学校<input value={(registeredTeams[editingTeamIndex]||{}).organization||''} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],organization:e.target.value}; setRegisteredTeams(t); }} placeholder="例：静岡市立○○中" className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs" /></label>
                            <label className="text-[10px] font-bold text-slate-500">カテゴリー<select value={(registeredTeams[editingTeamIndex]||{}).category||'中学軟式'} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],category:e.target.value}; setRegisteredTeams(t); }} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs"><option>中学軟式</option><option>中学硬式</option><option>少年野球</option><option>高校野球</option><option>大学野球</option><option>社会人</option><option>その他</option></select></label>
                            <label className="text-[10px] font-bold text-slate-500">年度・シーズン<input value={(registeredTeams[editingTeamIndex]||{}).season||''} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],season:e.target.value}; setRegisteredTeams(t); }} placeholder="例：2026年度" className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs" /></label>
                            <label className="text-[10px] font-bold text-slate-500">監督・責任者<input value={(registeredTeams[editingTeamIndex]||{}).coach||''} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],coach:e.target.value}; setRegisteredTeams(t); }} className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs" /></label>
                            <label className="text-[10px] font-bold text-slate-500">チームカラー<input type="color" value={(registeredTeams[editingTeamIndex]||{}).teamColor||'#2563eb'} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],teamColor:e.target.value}; setRegisteredTeams(t); }} className="mt-1 h-9 w-full rounded-lg border border-blue-100 bg-white p-1" /></label>
                          </div>
                          <label className="block text-[10px] font-bold text-slate-500">チームメモ<textarea value={(registeredTeams[editingTeamIndex]||{}).memo||''} onChange={e => { const t=[...registeredTeams]; t[editingTeamIndex]={...t[editingTeamIndex],memo:e.target.value}; setRegisteredTeams(t); }} placeholder="チーム方針、目標、共有事項など" className="mt-1 h-16 w-full resize-none rounded-lg border border-blue-100 bg-white px-2 py-2 text-xs" /></label>
                        </div>
                      ) : (
                        <button onClick={() => setHomeTeamName((registeredTeams[editingTeamIndex]||{}).name||'')} className="w-full rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-xs font-black text-blue-700">🏠 このチームを自チームに設定</button>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold text-slate-500">選手一覧 (1行1名)</label>
                          <button onClick={() => { setMergeMode(!mergeMode); setMergeSelection([]); setMergeKeepIdx(null); }} className={`text-[10px] px-2.5 py-1 rounded-lg font-bold border ${mergeMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-600 border-indigo-200'}`}>{mergeMode ? '✕ 統合をやめる' : '🔀 選手を統合'}</button>
                        </div>
                        {mergeMode && <p className="text-[10px] text-indigo-700 font-bold bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5">統合したい選手にチェックを入れてください（黄色の行は表記ゆれの可能性があります）</p>}
                        {(() => {
                          const dupSet = findDuplicateNameIndices((registeredTeams[editingTeamIndex]||{}).players||[]);
                          return ((registeredTeams[editingTeamIndex]||{}).players||[]).map((p, i) => (
                          // keyは行番号のみで固定する。選手名をkeyに含めると1文字入力するたびに
                          // keyが変わって行が作り直され、入力欄のフォーカスと日本語の変換途中が失われる。
                          <div key={`player-${i}`} className={`flex items-center gap-1.5 ${dupSet.has(i) ? 'bg-amber-50 border border-amber-200 rounded-lg px-1 py-0.5' : ''}`}>
                            {mergeMode && <input type="checkbox" checked={mergeSelection.includes(i)} onChange={() => { setMergeSelection(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]); setMergeKeepIdx(null); }} className="w-4 h-4 accent-indigo-600 shrink-0" />}
                            <span className="text-[10px] font-bold text-slate-400 w-5 text-right">{i+1}</span>
                            {(registeredTeams[editingTeamIndex]||{}).name === homeTeamName && <input aria-label="背番号" placeholder="#" value={typeof p === 'string' ? '' : (p.number||'')} onChange={e => { const t=[...registeredTeams]; const pl=[...(t[editingTeamIndex].players||[])]; pl[i]={...asPlayerObj(pl[i]),number:e.target.value}; t[editingTeamIndex]={...t[editingTeamIndex],players:pl}; setRegisteredTeams(t); }} className="w-10 rounded border border-blue-100 px-1 py-1.5 text-center text-[10px] font-bold" />}
                            <input type="text" autoComplete="off" value={typeof p === 'string' ? p : p.name} onChange={e => { const t = [...registeredTeams]; const pl = [...(t[editingTeamIndex].players||[])]; pl[i] = typeof p === 'string' ? e.target.value : {...p, name: e.target.value}; t[editingTeamIndex] = {...t[editingTeamIndex], players: pl}; setRegisteredTeams(t); }} className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs font-bold min-w-0" />
                            {(registeredTeams[editingTeamIndex]||{}).name === homeTeamName && <><select aria-label="学年" value={typeof p === 'string' ? '' : (p.grade||'')} onChange={e => { const t=[...registeredTeams]; const pl=[...(t[editingTeamIndex].players||[])]; pl[i]={...asPlayerObj(pl[i]),grade:e.target.value}; t[editingTeamIndex]={...t[editingTeamIndex],players:pl}; setRegisteredTeams(t); }} className="w-12 rounded border border-blue-100 px-1 py-1.5 text-[10px]"><option value="">学年</option><option>1年</option><option>2年</option><option>3年</option><option>その他</option></select><select aria-label="主な守備位置" value={typeof p === 'string' ? '' : (p.primaryPosition||'')} onChange={e => { const t=[...registeredTeams]; const pl=[...(t[editingTeamIndex].players||[])]; pl[i]={...asPlayerObj(pl[i]),primaryPosition:e.target.value}; t[editingTeamIndex]={...t[editingTeamIndex],players:pl}; setRegisteredTeams(t); }} className="w-12 rounded border border-blue-100 px-1 py-1.5 text-[10px]"><option value="">守備</option>{['投','捕','一','二','三','遊','左','中','右','未'].map(x=><option key={x}>{x}</option>)}</select></>}
                            <select value={typeof p === 'string' ? '右' : (p.throws||'右')} onChange={e => { const t = [...registeredTeams]; const pl = [...(t[editingTeamIndex].players||[])]; pl[i] = typeof pl[i] === 'string' ? {name: pl[i], throws: e.target.value, bats: '右'} : {...pl[i], throws: e.target.value}; t[editingTeamIndex] = {...t[editingTeamIndex], players: pl}; setRegisteredTeams(t); }} className="text-[10px] border border-slate-200 rounded px-1 py-1.5 w-10"><option value="右">右投</option><option value="左">左投</option></select>
                            <select value={typeof p === 'string' ? '右' : (p.bats||'右')} onChange={e => { const t = [...registeredTeams]; const pl = [...(t[editingTeamIndex].players||[])]; pl[i] = typeof pl[i] === 'string' ? {name: pl[i], throws: '右', bats: e.target.value} : {...pl[i], bats: e.target.value}; t[editingTeamIndex] = {...t[editingTeamIndex], players: pl}; setRegisteredTeams(t); }} className="text-[10px] border border-slate-200 rounded px-1 py-1.5 w-10"><option value="右">右打</option><option value="左">左打</option><option value="両">両打</option></select>
                            <button onClick={() => { const t = [...registeredTeams]; const pl = [...(t[editingTeamIndex].players||[])]; pl.splice(i, 1); t[editingTeamIndex] = {...t[editingTeamIndex], players: pl}; setRegisteredTeams(t); setMergeSelection([]); setMergeKeepIdx(null); }} className="text-rose-400 hover:text-rose-600 text-xs font-bold px-1">✕</button>
                          </div>
                          ));
                        })()}
                        <button onClick={() => { const t = [...registeredTeams]; const pl = [...(t[editingTeamIndex].players||[]), {name: '', throws: '右', bats: '右'}]; t[editingTeamIndex] = {...t[editingTeamIndex], players: pl}; setRegisteredTeams(t); }} className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg font-bold border border-slate-200 w-full mt-2">＋ 選手を追加</button>
                      </div>
                      {mergeMode && mergeSelection.length >= 2 && (
                        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2">
                          <div className="text-xs font-black text-indigo-800">どの名前に統合しますか？</div>
                          {mergeSelection.map(i => { const pl = asPlayerObj((((registeredTeams[editingTeamIndex]||{}).players)||[])[i] || { name: '' }); return (
                            <label key={i} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white rounded-lg px-2 py-1.5 border border-slate-200">
                              <input type="radio" name="merge-keep" checked={mergeKeepIdx === i} onChange={() => setMergeKeepIdx(i)} className="accent-indigo-600" />
                              {pl.name || '(名前なし)'}
                            </label>
                          ); })}
                          <button onClick={executeMergePlayers} disabled={mergeKeepIdx === null} className={`w-full py-2.5 rounded-xl font-black text-xs ${mergeKeepIdx === null ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white shadow-md active:scale-95'}`}>🔀 選択した{mergeSelection.length}名をこの名前に統合する</button>
                          <p className="text-[9px] text-slate-500 leading-snug">過去の試合記録(打席・投球)もまとめて新しい名前に書き換わるため、累計成績が1人分に合算されます。</p>
                        </div>
                      )}
                      <button onClick={() => { setEditingTeamIndex(null); setMergeMode(false); setMergeSelection([]); setMergeKeepIdx(null); }} className="w-full bg-blue-600 text-white py-3 rounded-xl font-black mt-4 shadow-md active:scale-95">保存して戻る</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {registeredTeams.length === 0 && <p className="text-center text-slate-400 text-sm py-8">登録チームがありません</p>}
                      {registeredTeams.map((team, i) => ({team,i})).sort((a,b) => Number(b.team.name===homeTeamName)-Number(a.team.name===homeTeamName)).map(({team,i}, orderIndex, ordered) => (
                        <React.Fragment key={i}>
                        {(orderIndex === 0 || ordered[orderIndex-1].team.name === homeTeamName) && <div className={`pt-1 text-[10px] font-black uppercase tracking-wider ${team.name===homeTeamName?'text-blue-600':'text-slate-400'}`}>{team.name===homeTeamName?'🏠 自チーム':'⚾ 対戦相手チーム'}</div>}
                        <div className={`${team.name===homeTeamName?'bg-blue-50 border-blue-300 ring-1 ring-blue-100':'bg-slate-50 border-slate-200'} rounded-xl border p-3 flex justify-between items-center`}>
                          <div>
                            <div className="font-black text-sm text-slate-800">{team.name} {team.name===homeTeamName && <span className="ml-1 rounded-full bg-blue-600 px-2 py-0.5 text-[9px] text-white">自チーム</span>}</div>
                            <div className="text-[10px] text-slate-500 font-bold">{(team.players||[]).length}人登録{team.name===homeTeamName && team.category ? `｜${team.category}` : ''}{team.name===homeTeamName && team.season ? `｜${team.season}` : ''}</div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setCumulativeTeam(team.name); setCumulativeDateFrom(''); setCumulativeDateTo(''); setCumulativeTab('batter'); setExpandedCumKey(null); setShowCumulativeStats(true); setShowTeamManager(false); }} className="text-[10px] bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg font-bold border border-amber-200">📊累計</button>
                            <button onClick={() => { applyTeamToLineup(team, 'top'); showToast(`${team.name}を先攻に反映`); }} className="text-[10px] bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold border border-blue-200">先攻に</button>
                            <button onClick={() => { applyTeamToLineup(team, 'bottom'); showToast(`${team.name}を後攻に反映`); }} className="text-[10px] bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold border border-blue-200">後攻に</button>
                            <button onClick={() => { setEditingTeamIndex(i); setMergeMode(false); setMergeSelection([]); setMergeKeepIdx(null); }} className="text-[10px] bg-white text-slate-600 px-2.5 py-1.5 rounded-lg font-bold border border-slate-300">編集</button>
                            <button onClick={() => { setConfirmDialog({ title: '🗑️ チーム削除', message: `${team.name}を削除しますか？`, isDanger: true, onConfirm: () => { setRegisteredTeams(prev => prev.filter((_, idx) => idx !== i)); if (team.name === homeTeamName) setHomeTeamName(''); setConfirmDialog(null); } }); }} className="text-[10px] bg-rose-50 text-rose-600 px-2.5 py-1.5 rounded-lg font-bold border border-rose-200">削除</button>
                          </div>
                        </div>
                        </React.Fragment>
                      ))}
                      <div className="flex gap-2 pt-4 border-t border-slate-200">
                        <button onClick={() => { setRegisteredTeams(prev => [...prev, { name: '新規チーム', players: Array.from({length: 10}, (_, i) => ({name: `選手${i+1}`, throws: '右', bats: '右'})) }]); setEditingTeamIndex(registeredTeams.length); }} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">＋ 新規チーム登録</button>
                        <button onClick={() => { const side = gameState.isTop ? 'top' : 'bottom'; const teamName = gameState.isTop ? gameInfo.teamTop : gameInfo.teamBottom; const players = lineups[side].slice(0, 10).map(p => ({name: p.name, throws: p.throws || '右', bats: p.bats || '右'})); setRegisteredTeams(prev => [...prev, { name: teamName, players }]); showToast(`${teamName}を登録しました`); }} className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-md active:scale-95 text-xs">現在のオーダーから登録</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 shrink-0 flex gap-2">
                  <button onClick={() => handleShareData('teams')} className="flex-1 bg-blue-50 text-blue-700 py-2.5 rounded-xl font-bold text-xs border border-blue-200">📤 チーム共有</button>
                  <button onClick={() => setShowTeamManager(false)} className="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs">閉じる</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL 4: ARCHIVE (保存/読込) ================= */}
          {/* ============================================================ */}
          {showArchiveModal && (
            <div className="fixed inset-0 bg-slate-900/70 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] border border-slate-200">
                <div className="p-4 border-b border-slate-200 bg-emerald-50 flex justify-between items-center shrink-0">
                  <h2 className="text-lg font-black text-emerald-800">📂 保存 / 読込</h2>
                  <button onClick={() => setShowArchiveModal(false)} className="text-emerald-400 hover:text-emerald-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 modal-scroll">
                  <button onClick={saveCurrentGame} className={`w-full bg-emerald-600 text-white py-3.5 rounded-xl font-black shadow-md active:scale-95 text-base ${savedGames.some(g => g.id === gameInfo.sourceGameId) ? 'mb-2' : 'mb-4'}`}>💾 現在の試合を新規保存する</button>
                  {savedGames.some(g => g.id === gameInfo.sourceGameId) && (
                    <button onClick={overwriteSourceGame} className="w-full bg-amber-500 text-white py-3.5 rounded-xl font-black shadow-md active:scale-95 mb-4 text-sm">💾 読み込み元の試合へ上書き保存（修正を反映）</button>
                  )}
                  <h3 className="text-sm font-black text-slate-700 mb-3">保存済み試合</h3>
                  {savedGames.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">保存されている試合はありません</p> : (
                    <div className="space-y-2">
                      {savedGames.map(g => (
                        <div key={g.id} className="bg-slate-50 rounded-xl border border-slate-200 p-3 flex justify-between items-center">
                          <div>
                            <div className="font-black text-sm text-slate-800">{g.teamTop} {g.scoreTop} - {g.scoreBottom} {g.teamBottom}</div>
                            <div className="text-[10px] text-slate-500 font-bold">{g.date} / {g.pitchesCount}球</div>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => loadGame(g.id)} className="text-[10px] bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm active:scale-95">読込</button>
                            <button onClick={() => loadGame(g.id, { openRecordEditor: true })} title="読み込んで記録・選手交代を修正する" className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-1.5 rounded-lg font-bold border border-indigo-200">🔄 記録/交代</button>
                            <button onClick={() => openScoreEdit('saved', g.id)} className="text-[10px] bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg font-bold border border-amber-200">✏️ スコア</button>
                            <button onClick={() => handleShareData(`game:${g.id}`)} className="text-[10px] bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold border border-blue-200">共有</button>
                            <button onClick={() => deleteGame(g.id)} className="text-[10px] bg-rose-50 text-rose-600 px-2.5 py-1.5 rounded-lg font-bold border border-rose-200">削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 shrink-0 flex gap-2">
                  <button onClick={() => { setShowArchiveModal(false); setShowImportTextModal(true); }} className="flex-1 bg-indigo-50 text-indigo-700 py-2.5 rounded-xl font-bold text-xs border border-indigo-200">📥 テキストから受信</button>
                  <button onClick={() => handleShareData('all')} className="flex-1 bg-blue-50 text-blue-700 py-2.5 rounded-xl font-bold text-xs border border-blue-200">📤 全データ共有</button>
                  <button onClick={() => setShowArchiveModal(false)} className="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs">閉じる</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL: RECORD EDITOR (全記録の修正) ========== */}
          {/* ============================================================ */}
          {showRecordEditor && (() => {
            const groups = [];
            pitches.forEach((p, idx) => {
              const last = groups[groups.length - 1];
              if (!last || last.inning !== p.inning || last.isTop !== p.isTop) groups.push({ inning: p.inning, isTop: p.isTop, items: [{ p, idx }] });
              else last.items.push({ p, idx });
            });
            return (
              <div className="fixed inset-0 bg-slate-900/70 z-[350] flex items-center justify-center p-3 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
                  <div className="p-4 border-b border-slate-200 bg-indigo-50 flex justify-between items-center shrink-0">
                    <div>
                      <h2 className="text-lg font-black text-indigo-800">📝 記録の修正（一球ごと）</h2>
                      <div className="text-[10px] font-bold text-slate-500">記録をタップして修正・削除、🔄でその場面へさかのぼって交代を挿入できます</div>
                    </div>
                    <button onClick={() => setShowRecordEditor(false)} className="text-indigo-400 hover:text-indigo-800 font-bold text-xl px-2">✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 modal-scroll bg-slate-100/50">
                    {groups.length === 0 ? (
                      <p className="text-center text-slate-400 text-sm py-10 font-bold">まだ記録がありません</p>
                    ) : (
                      groups.map((g, gi) => (
                        <div key={gi} className="mb-3 last:mb-0">
                          <div className={`text-xs font-black px-3 py-2 rounded-t-xl ${g.isTop ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'}`}>{g.inning}回{g.isTop ? '表' : '裏'}　{g.isTop ? gameInfo.teamTop : gameInfo.teamBottom}の攻撃</div>
                          <div className="bg-white rounded-b-xl border border-slate-200 border-t-0 divide-y divide-slate-100 overflow-hidden">
                            {g.items.map(({ p, idx }) => (
                              <div key={idx} className="flex items-stretch">
                                <button onClick={() => handleEditPitchClick(p)} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-blue-50 active:bg-blue-100">
                                  {p.isEvent ? (
                                    <>
                                      <span className="w-8 shrink-0 text-center text-[10px] font-black text-indigo-400">{p.result?.startsWith('選手交代') ? '🔄' : '🏃'}</span>
                                      <span className="flex-1 text-[11px] font-bold text-indigo-700 truncate">{p.result}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="w-8 shrink-0 text-center font-black text-sm text-slate-300 font-mono">{p.pitchNumber}</span>
                                      <span className="w-24 shrink-0 text-[11px] font-bold text-slate-600 truncate">{p.batter}番 {p.batterName}</span>
                                      <span className="w-16 shrink-0 text-[10px] font-bold text-slate-400 truncate hidden sm:inline">{p.type && p.type !== '-' ? p.type : ''}</span>
                                      <span className={`flex-1 text-[11px] font-black truncate ${['安','塁打','本塁打'].some(w=>p.result.includes(w)) ? 'text-blue-600' : ['三振','アウト','失敗','ゴロ','飛','直','邪飛'].some(w=>p.result.includes(w)) ? 'text-rose-600' : 'text-slate-700'}`}>{p.result}</span>
                                    </>
                                  )}
                                  <span className="shrink-0 text-[10px] text-slate-300 font-bold">✏️</span>
                                </button>
                                <button onClick={() => openRetroSubstitution(idx)} title="この記録の直前に選手交代を挿入" className="shrink-0 px-2.5 border-l border-slate-100 text-[10px] font-black text-amber-600 bg-amber-50/60 hover:bg-amber-100 active:bg-amber-200">🔄<span className="block text-[8px] leading-none mt-0.5">交代挿入</span></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0">
                    <p className="text-[10px] text-slate-400 font-bold mb-2 text-center">※記録を修正・削除すると、アウト数・走者・得点は記録全体から自動で再計算されます</p>
                    <button onClick={() => setShowRecordEditor(false)} className="w-full bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-sm">閉じる</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ============================================================ */}
          {/* ============= MODAL: SCORE EDIT (スコア修正) =============== */}
          {/* ============================================================ */}
          {scoreEdit && (() => {
            const g = scoreEdit.source === 'saved' ? savedGames.find(x => x.id === scoreEdit.gameId) : null;
            const nameTop = g ? g.teamTop : gameInfo.teamTop;
            const nameBottom = g ? g.teamBottom : gameInfo.teamBottom;
            const totals = { top: scoreEdit.top.reduce((a, b) => a + b, 0), bottom: scoreEdit.bottom.reduce((a, b) => a + b, 0) };
            const earnedTotals = { top: scoreEdit.earnedTop.reduce((a,b)=>a+b,0), bottom: scoreEdit.earnedBottom.reduce((a,b)=>a+b,0) };
            return (
              <div className="fixed inset-0 bg-slate-900/70 z-[450] flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200">
                  <div className="p-4 border-b border-slate-200 bg-blue-50 flex justify-between items-center shrink-0">
                    <div>
                      <h2 className="text-lg font-black text-blue-800">✏️ スコア修正</h2>
                      <div className="text-[10px] font-bold text-slate-500">{scoreEdit.source === 'saved' ? `保存済み試合 (${g?.date || ''}) の回別スコアを修正します` : '現在の試合の回別スコアを直接修正できます'}</div>
                    </div>
                    <button onClick={() => setScoreEdit(null)} className="text-blue-400 hover:text-blue-800 font-bold text-xl px-2">✕</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 modal-scroll">
                    <div className="overflow-x-auto pb-2">
                      <div className="inline-flex flex-col gap-1.5 min-w-full">
                        <div className="flex gap-1 items-center">
                          <div className="w-24 shrink-0"></div>
                          {scoreEdit.top.map((_, i) => <div key={i} className="w-11 shrink-0 text-center text-[10px] font-bold text-slate-400">{i + 1}</div>)}
                          <div className="w-11 shrink-0 text-center text-[10px] font-black text-slate-500">R</div>
                        </div>
                        {['top', 'bottom'].map(team => <React.Fragment key={team}><div className="flex gap-1 items-center"><div className={`w-24 shrink-0 text-xs font-black truncate ${team === 'top' ? 'text-blue-800' : 'text-rose-800'}`}>{team === 'top' ? nameTop : nameBottom}<span className="block text-[9px] text-slate-400">得点</span></div>{scoreEdit[team].map((v,i)=><input key={i} aria-label={`${team}-${i+1}回得点`} type="number" min="0" max="99" inputMode="numeric" value={v} onFocus={e=>e.target.select()} onChange={e=>setScoreEditCell(team,i,e.target.value)} className="w-11 shrink-0 border border-slate-300 rounded-lg py-2 text-center text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-blue-400"/>)}<div className="w-11 shrink-0 text-center font-black text-blue-700 text-lg">{totals[team]}</div></div><div className="flex gap-1 items-center bg-amber-50/70 rounded-lg py-1"><div className="w-24 shrink-0 text-[10px] font-black text-amber-700 pl-2">↳ 自責点</div>{scoreEdit[team==='top'?'earnedTop':'earnedBottom'].map((v,i)=><input key={i} aria-label={`${team}-${i+1}回自責点`} type="number" min="0" max={scoreEdit[team][i]} inputMode="numeric" value={v} onFocus={e=>e.target.select()} onChange={e=>setEarnedRunCell(team,i,e.target.value)} className="w-11 shrink-0 border border-amber-300 rounded-lg py-1.5 text-center text-xs font-black bg-white outline-none focus:ring-2 focus:ring-amber-400"/>)}<div className="w-11 shrink-0 text-center font-black text-amber-700">{earnedTotals[team]}</div></div></React.Fragment>)}
                      </div>
                    </div>
                    <button onClick={addScoreEditInning} className="mt-2 text-[11px] bg-slate-50 text-slate-600 px-3 py-2 rounded-lg font-bold border border-slate-200 hover:bg-slate-100">＋ 延長回を追加</button>
                    <p className="text-[10px] text-slate-500 font-bold mt-3 bg-amber-50 border border-amber-100 rounded-lg p-3">得点の下に、その回の自責点を入力します。失策・捕逸・タイブレーク走者などによる非自責点は除いてください。自責点は得点を超えて入力できません。</p>
                  </div>
                  <div className="p-4 border-t border-slate-200 flex gap-3 bg-slate-50 shrink-0">
                    <button onClick={() => setScoreEdit(null)} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                    <button onClick={saveScoreEdit} className="flex-[1.5] bg-blue-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">保存する</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ============================================================ */}
          {/* ============= MODAL 5: EXPORT (出力) ======================= */}
          {/* ============================================================ */}
          {showExport && (
            <div className="fixed inset-0 bg-slate-900/70 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-slate-200 bg-slate-800 flex justify-between items-center">
                  <h2 className="text-lg font-black text-white">📤 データ出力</h2>
                  <button onClick={() => setShowExport(false)} className="text-slate-400 hover:text-white font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 space-y-3">
                  <button onClick={() => { copyShareText(); setShowExport(false); }} className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black shadow-md active:scale-95 flex items-center justify-center gap-2">📋 試合結果をコピー (LINE用)</button>
                  <button onClick={() => { copyForAI(); setShowExport(false); }} className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-black shadow-md active:scale-95 flex items-center justify-center gap-2">🤖 AI分析用データをコピー</button>
                  <button onClick={() => { setShowExport(false); setShowScorebookPrintSettings(true); }} className="w-full bg-amber-600 text-white py-3.5 rounded-xl font-black shadow-md active:scale-95 flex items-center justify-center gap-2">📖 スコアブックPDF</button>
                  <button onClick={() => { exportCSV(); setShowExport(false); }} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-md active:scale-95 flex items-center justify-center gap-2">📊 CSV ダウンロード</button>
                  <button onClick={() => { exportData(); setShowExport(false); }} className="w-full bg-slate-700 text-white py-3 rounded-xl font-bold shadow-md active:scale-95 flex items-center justify-center gap-2">💾 JSON バックアップ</button>
                  <div className="pt-3 border-t border-slate-200">
                    <label className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer border border-slate-300 hover:bg-slate-200">
                      📂 ファイルから復元 (JSON / スコアラー)
                      <input type="file" accept=".json,.txt" onChange={importData} className="hidden" />
                    </label>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50">
                  <button onClick={() => setShowExport(false)} className="w-full bg-slate-200 text-slate-700 py-3 rounded-xl font-bold">閉じる</button>
                </div>
              </div>
            </div>
          )}

          {showScorebookPrintSettings && (
            <div className="fixed inset-0 bg-slate-900/70 z-[220] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
                <div className="p-4 border-b border-amber-200 bg-amber-50 flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-black text-amber-900">📖 スコアブックPDF設定</h2>
                    <p className="text-[11px] text-amber-700 font-bold mt-0.5">A4横・先攻と後攻は別ページで出力</p>
                  </div>
                  <button onClick={() => setShowScorebookPrintSettings(false)} className="text-amber-500 hover:text-amber-900 font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={scorebookPrintOptions.includeCharts} onChange={e => setScorebookPrintOptions(o => ({ ...o, includeCharts: e.target.checked }))} className="mt-1 h-5 w-5 accent-amber-600" />
                    <span><span className="block font-black text-slate-800">配球図・打球方向図を載せる</span><span className="block text-xs text-slate-500 mt-1">各打者行の右側に、打席ごとの配球と打球方向を表示します。</span></span>
                  </label>
                  <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={scorebookPrintOptions.includeStats} onChange={e => setScorebookPrintOptions(o => ({ ...o, includeStats: e.target.checked }))} className="mt-1 h-5 w-5 accent-amber-600" />
                    <span><span className="block font-black text-slate-800">個人成績を付ける</span><span className="block text-xs text-slate-500 mt-1">そのチームの打撃成績と投手成績を、スコア表の下に横並びで載せます。</span></span>
                  </label>
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 font-bold leading-relaxed">出力構成：1ページ目 先攻 ／ 2ページ目 後攻。プレビューに表示された紙面がそのまま印刷されます{scorebookPrintOptions.includeCharts ? '。1ページに収まらない場合は打者行の区切りでページを増やします(配球図を外すとコンパクトになります)' : ''}</div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex gap-3">
                  <button onClick={() => setShowScorebookPrintSettings(false)} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                  <button onClick={() => { handleScorebookPrint(); setShowScorebookPrintSettings(false); }} className="flex-[1.5] bg-amber-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">印刷画面を開く</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL 6: ADVANCE (進塁) ===================== */}
          {/* ============================================================ */}
          {showAdvanceModal && (
            <div className="fixed inset-0 bg-slate-900/70 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-blue-200 bg-blue-50 flex justify-between items-center">
                  <h2 className="text-lg font-black text-blue-800">🏃 走者の進塁</h2>
                  <button onClick={() => setShowAdvanceModal(false)} className="text-blue-400 hover:text-blue-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">走者を選択</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{key:'first',label:'1塁'},{key:'second',label:'2塁'},{key:'third',label:'3塁'}].filter(r => gameState.runners[r.key]).map(r => (
                        <button key={r.key} onClick={() => setAdvanceData(prev => ({...prev, runner: r.key}))} className={`py-3 rounded-xl font-bold text-sm border-2 ${advanceData.runner === r.key ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>{r.label}走者</button>
                      ))}
                      {!gameState.runners.first && !gameState.runners.second && !gameState.runners.third && <p className="col-span-3 text-center text-slate-400 text-sm py-4">走者がいません</p>}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">理由</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['盗塁','暴投','捕逸','ボーク','代走','その他'].map(r => (
                        <button key={r} onClick={() => setAdvanceData(prev => ({...prev, reason: r, countAsPitch: null}))} className={`py-2.5 rounded-xl font-bold text-xs border-2 ${advanceData.reason === r ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>{r}</button>
                      ))}
                    </div>
                  </div>
                  {advanceData.reason === 'ボーク' && (
                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-2 block">投球の有無</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setAdvanceData(prev => ({...prev, countAsPitch: true}))} className={`py-2.5 rounded-xl font-bold text-xs border-2 ${advanceData.countAsPitch === true ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>投球あり（球数+1）</button>
                        <button onClick={() => setAdvanceData(prev => ({...prev, countAsPitch: false}))} className={`py-2.5 rounded-xl font-bold text-xs border-2 ${advanceData.countAsPitch === false ? 'bg-slate-600 text-white border-slate-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>投球なし（球数変わらず）</button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">進塁先</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[{key:'second',label:'2塁'},{key:'third',label:'3塁'},{key:'home',label:'本塁'},{key:'same',label:'そのまま'}].map(t => (
                        <button key={t.key} onClick={() => setAdvanceData(prev => ({...prev, to: t.key}))} className={`py-2.5 rounded-xl font-bold text-xs border-2 ${advanceData.to === t.key ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>{t.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-200 bg-slate-50">
                  <div className="p-4 flex gap-3">
                    <button onClick={() => { setShowAdvanceModal(false); setAdvanceData({ runner: '', reason: '', to: '', countAsPitch: null }); }} className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                    <button onClick={handleAdvanceRecord} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">記録する</button>
                  </div>
                  <label className="flex items-center justify-center gap-2 pb-3 text-[11px] font-bold text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={askAdvanceAfterHit} onChange={e => setAskAdvanceAfterHit(e.target.checked)} className="w-3.5 h-3.5" />
                    安打・出塁のあとに「走者はどこまで進んだ？」を出す
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ==== MODAL 6b: ADVANCE SHEET (打席直後の進塁確認) ========== */}
          {/* ============================================================ */}
          {advanceSheet && (() => {
            const outsAfterPlay = advanceSheet.outsBefore + advanceSheet.addedOuts;
            const rows = buildAdvanceChoices(advanceSheet.runnersBefore, advanceSheet.eventType, outsAfterPlay);
            const auto = autoPositions(advanceSheet.runnersBefore, advanceSheet.eventType);
            const preview = previewAdvanceResult(advanceSheet.runnersBefore, advanceSheet.eventType, advanceSheet.plan, outsAfterPlay);
            const isAuto = rows.every(r => advanceSheet.plan[r.id] === r.autoPos);
            const setPlan = (id, value) => setAdvanceSheet(prev => ({ ...prev, plan: { ...prev.plan, [id]: value } }));
            return (
              <div className="fixed inset-0 bg-slate-900/70 z-[310] flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
                  <div className="p-4 border-b border-emerald-200 bg-emerald-50">
                    <h2 className="text-lg font-black text-emerald-800">🏃 走者はどこまで進んだ？</h2>
                    <p className="text-[11px] font-bold text-emerald-700/80 mt-1">
                      <span className="bg-white px-2 py-0.5 rounded border border-emerald-200 mr-1.5">{advanceSheet.resultText}</span>
                      打席前: {advanceSheet.outsBefore}アウト {describeRunners(advanceSheet.runnersBefore)}
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 modal-scroll">
                    {rows.map(row => (
                      <div key={row.id} className="bg-slate-50 rounded-2xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-slate-700">{row.label}</span>
                          {advanceSheet.plan[row.id] !== row.autoPos && (
                            <button onClick={() => setPlan(row.id, row.autoPos)} className="text-[10px] text-slate-400 underline font-bold">自動に戻す</button>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {row.choices.map(c => {
                            const selected = advanceSheet.plan[row.id] === c.value;
                            const isOut = c.value === 'out';
                            return (
                              <button key={String(c.value)} onClick={() => setPlan(row.id, c.value)}
                                className={`flex-1 min-w-[64px] py-2.5 rounded-xl font-bold text-xs border-2 active:scale-95 ${selected ? (isOut ? 'bg-rose-600 text-white border-rose-600 shadow-md' : 'bg-emerald-600 text-white border-emerald-600 shadow-md') : 'bg-white text-slate-600 border-slate-300'}`}>
                                {c.label}{c.value === row.autoPos && <span className={`ml-1 text-[9px] ${selected ? 'text-white/70' : 'text-slate-400'}`}>自動</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="bg-blue-50 rounded-2xl border border-blue-200 p-3 text-center">
                      <div className="text-[10px] font-bold text-blue-500 mb-1">この打席のあと</div>
                      <div className="text-base font-black text-blue-800">
                        {preview.outs}アウト {describeRunners(preview.runners)}
                        {preview.runs > 0 && <span className="ml-2 text-rose-600">{preview.runs}点</span>}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-slate-200 bg-slate-50">
                    <div className="p-4 flex gap-3">
                      <button onClick={() => applyAdvanceSheet(auto)} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold text-sm active:scale-95">自動進塁のまま</button>
                      <button onClick={() => applyAdvanceSheet()} className={`flex-[1.4] py-3 rounded-xl font-black shadow-md active:scale-95 ${isAuto ? 'bg-slate-600 text-white' : 'bg-emerald-600 text-white'}`}>記録する</button>
                    </div>
                    <label className="flex items-center justify-center gap-2 pb-3 text-[11px] font-bold text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={askAdvanceAfterHit} onChange={e => setAskAdvanceAfterHit(e.target.checked)} className="w-3.5 h-3.5" />
                      出塁した打席のあと、毎回この確認を出す
                    </label>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ============================================================ */}
          {/* ============= MODAL 7: OUT RUNNER (走者アウト) ============= */}
          {/* ============================================================ */}
          {showOutRunnerModal && (
            <div className="fixed inset-0 bg-slate-900/70 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-rose-200 bg-rose-50 flex justify-between items-center">
                  <h2 className="text-lg font-black text-rose-800">❌ 走者アウト</h2>
                  <button onClick={() => setShowOutRunnerModal(false)} className="text-rose-400 hover:text-rose-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">走者を選択</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{key:'first',label:'1塁'},{key:'second',label:'2塁'},{key:'third',label:'3塁'}].filter(r => gameState.runners[r.key]).map(r => (
                        <button key={r.key} onClick={() => setOutRunnerData(prev => ({...prev, runner: r.key}))} className={`py-3 rounded-xl font-bold text-sm border-2 ${outRunnerData.runner === r.key ? 'bg-rose-600 text-white border-rose-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>{r.label}走者</button>
                      ))}
                      {!gameState.runners.first && !gameState.runners.second && !gameState.runners.third && <p className="col-span-3 text-center text-slate-400 text-sm py-4">走者がいません</p>}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-2 block">理由</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['盗塁死','牽制死','挟殺','離塁ｱｳﾄ','走塁死','その他'].map(r => (
                        <button key={r} onClick={() => setOutRunnerData(prev => ({...prev, reason: r}))} className={`py-2.5 rounded-xl font-bold text-xs border-2 ${outRunnerData.reason === r ? 'bg-rose-600 text-white border-rose-600 shadow-md' : 'bg-white text-slate-600 border-slate-300'}`}>{r}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 flex gap-3 bg-slate-50">
                  <button onClick={() => setShowOutRunnerModal(false)} className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                  <button onClick={handleOutRunnerRecord} className="flex-1 bg-rose-600 text-white py-3 rounded-xl font-black shadow-md active:scale-95">アウトを記録</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ========== MODAL: 牽制 塁選択 (PICKOFF BASE SELECT) ======== */}
          {/* ============================================================ */}
          {showPickoffModal && (
            <div className="fixed inset-0 bg-slate-900/70 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xs overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-orange-200 bg-orange-50 flex justify-between items-center">
                  <h2 className="text-lg font-black text-orange-800">🏃 牽制 — 何塁へ？</h2>
                  <button onClick={() => setShowPickoffModal(false)} className="text-orange-400 hover:text-orange-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-3 gap-3">
                    {['1塁','2塁','3塁'].map(base => (
                      <button key={base} onClick={() => { setShowPickoffModal(false); recordPitch(`牽制(${base})`); }} className="py-5 rounded-2xl font-black text-lg border-2 border-orange-300 bg-orange-50 text-orange-700 active:scale-95 hover:bg-orange-500 hover:text-white hover:border-orange-500 shadow-sm transition-colors">{base}</button>
                    ))}
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50">
                  <button onClick={() => setShowPickoffModal(false)} className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl font-bold">キャンセル</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ========== MODAL: 振り逃げ (UNCAUGHT THIRD STRIKE) ========= */}
          {/* ============================================================ */}
          {showFurinigeModal && (
            <div className="fixed inset-0 bg-slate-900/70 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  <h2 className="text-lg font-black text-slate-800">第3ストライクの処理</h2>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-slate-500 font-bold mb-4 text-center">キャッチャーは捕球しましたか？</p>
                  <button onClick={() => handleFurinigeResult('三振')} className="w-full bg-rose-600 text-white py-4 rounded-2xl font-black text-base shadow-md active:scale-95">
                    三振（キャッチャー捕球・アウト）
                  </button>
                  <button onClick={() => handleFurinigeResult('セーフ')} className="w-full bg-cyan-600 text-white py-4 rounded-2xl font-black text-base shadow-md active:scale-95">
                    振り逃げ・セーフ（1塁到達）
                  </button>
                  <button onClick={() => handleFurinigeResult('アウト')} className="w-full bg-cyan-800 text-white py-4 rounded-2xl font-black text-base shadow-md active:scale-95">
                    振り逃げ・アウト（1塁で刺死）
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL 8: POST GAME ANALYSIS ================== */}
          {/* ============================================================ */}
          {showAnalystReport && (
            <div className="fixed inset-0 bg-slate-900/90 z-[200] flex flex-col overflow-hidden">
              <div className="bg-white border-b border-slate-200 p-4 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">📈 アナリスト分析</h2>
                <div className="flex gap-2">
                  <button onClick={() => { setShowAnalystReport(false); setShowPostGameAnalysis(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm">🏁 試合レポートへ</button>
                  <button onClick={() => setShowAnalystReport(false)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold border border-slate-300">✕ 閉じる</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 modal-scroll">
                <div className="max-w-4xl mx-auto">
                  <div className="mb-4 text-sm font-black text-slate-700">{gameInfo.date} — {gameInfo.teamTop} vs {gameInfo.teamBottom}</div>
                  <AnalystReport insights={analystInsights} />
                </div>
              </div>
            </div>
          )}

          {showPostGameAnalysis && advancedStats && (
            <div className="fixed inset-0 bg-slate-900/90 z-[200] flex flex-col overflow-hidden">
              <div className="bg-white border-b border-slate-200 p-4 flex justify-between items-center shrink-0">
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">🏁 試合分析レポート</h2>
                <div className="flex gap-2">
                  <button onClick={handlePrintDashboard} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm">🖨️ 印刷 / PDF</button>
                  <button onClick={() => setShowPostGameAnalysis(false)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold border border-slate-300">✕ 閉じる</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 modal-scroll">
                <div className="max-w-4xl mx-auto space-y-8">
                  {/* Score summary */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-xl font-black text-slate-800 mb-4">{gameInfo.date} — {gameInfo.teamTop} vs {gameInfo.teamBottom}</h3>
                    <div className="text-center text-4xl font-black text-blue-700 mb-4">
                      {gameState.runs.top.reduce((a,b)=>a+b,0)} - {gameState.runs.bottom.reduce((a,b)=>a+b,0)}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">投球数</div><div className="text-2xl font-black text-slate-800">{pitches.filter(p=>!p.isEvent||p.countAsPitch).length}</div></div>
                      <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">{gameInfo.teamTop} 打率</div><div className="text-2xl font-black text-blue-700">{advancedStats.topBatting.team.AVG}</div></div>
                      <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">{gameInfo.teamBottom} 打率</div><div className="text-2xl font-black text-blue-700">{advancedStats.bottomBatting.team.AVG}</div></div>
                      <div className="bg-slate-50 p-3 rounded-xl"><div className="text-[10px] font-bold text-slate-500 uppercase">H / E</div><div className="text-lg font-black text-slate-800">{hitsAndErrors.top.hits}H-{hitsAndErrors.top.errors}E / {hitsAndErrors.bottom.hits}H-{hitsAndErrors.bottom.errors}E</div></div>
                    </div>
                  </div>

                  {/* 打席速報(実況文+カウント推移+打球図)。簡易版テキスト速報を置き換え */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-base font-black text-slate-800 mb-4">📰 打席速報</h3>
                    <PlayByPlayReport report={playByPlayReport} gameInfo={gameInfo} defaultOpenLast scrollTarget={pbpScrollTarget} onScrolled={() => setPbpScrollTarget(null)} />
                  </div>

                  {/* Spray charts */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-base font-black text-slate-800 mb-4">🎯 チーム打球方向</h3>
                    <div className="flex flex-wrap gap-6 justify-center">
                      <SprayChart hits={advancedStats.topBatting.team.sprayHits} title={gameInfo.teamTop} size={200} />
                      <SprayChart hits={advancedStats.bottomBatting.team.sprayHits} title={gameInfo.teamBottom} size={200} />
                    </div>
                    <div className="text-[10px] text-slate-500 text-center mt-4">青=安打 / 赤=凡打 / 橙=失策 / 紫=ファウル｜波線=ゴロ / 破線=フライ / 直線=ライナー / 太弧=HR</div>
                  </div>

                  {/* アナリスト指標 */}
                  <AnalystReport insights={analystInsights} />

                  {/* Batting tables + individual spray charts */}
                  {[{data: advancedStats.topBatting, name: gameInfo.teamTop}, {data: advancedStats.bottomBatting, name: gameInfo.teamBottom}].map(({data, name}) => (
                    <div key={name} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                      <h3 className="text-base font-black text-slate-800 mb-4">🏏 打者成績: {name}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead><tr className="bg-slate-100 border-b-2 border-slate-300">
                            <th className="py-2 px-2 text-left">順</th><th className="py-2 px-2 text-left">選手名</th><th className="py-2 px-2 text-center">守備</th><th className="py-2 px-2 text-center">投打</th><th className="py-2 px-2 text-right">打数</th><th className="py-2 px-2 text-right">安打</th><th className="py-2 px-2 text-right">四死</th><th className="py-2 px-2 text-right text-blue-600">打率</th><th className="py-2 px-2 text-right text-amber-600">OPS</th><th className="py-2 px-2 text-right text-rose-600">K%</th><th className="py-2 px-2 text-left">結果</th>
                          </tr></thead>
                          <tbody>
                            {data.players.filter(p => p.PA > 0).map((p, i) => (
                              <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50'}`}>
                                <td className="py-2 px-2 font-bold text-slate-400">{p.order}</td><td className="py-2 px-2 font-black text-slate-800">{p.name}</td>
                                <td className="py-2 px-2 text-center text-slate-500">{p.pos || '-'}</td><td className="py-2 px-2 text-center text-slate-500 text-[10px] whitespace-nowrap">{(p.throws || '?') + '投/' + (p.bats || '?') + '打'}</td>
                                <td className="py-2 px-2 text-right">{p.AB}</td><td className="py-2 px-2 text-right">{p.H}</td><td className="py-2 px-2 text-right">{p.BB_HBP}</td>
                                <td className="py-2 px-2 text-right text-blue-600 font-bold">{p.AVG}</td><td className="py-2 px-2 text-right text-amber-600 font-bold">{p.OPS}</td><td className="py-2 px-2 text-right text-rose-600">{p.KPct}%</td>
                                <td className="py-2 px-2 text-[10px] text-slate-500 max-w-[260px] align-top">
                                  <div className="flex flex-wrap gap-1">
                                    {p.results.length ? p.results.map((r, ri) => <span key={ri} className="inline-block px-2 py-[1px] rounded-full bg-indigo-50 text-slate-700 leading-snug">{r}</span>) : <span className="text-slate-400">-</span>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {/* Per-at-bat pitch breakdown with mini strike zone */}
                      {(() => {
                        const ptColors = {
                          'ストレート': '#ef4444',
                          'スライダー': '#3b82f6',
                          'シュート':   '#10b981',
                          'カーブ':     '#f59e0b',
                          '落ちる球':  '#6366f1',
                          'シンカー':  '#06b6d4',
                        };
                        const cs = 11; // cell size px
                        const svgSz = cs * 7;
                        const renderAbZone = (abPitches) => {
                          // group pitches by course to handle overlaps
                          const byPos = {};
                          abPitches.forEach((p, i) => {
                            if (p.course !== null && p.course !== undefined) {
                              if (!byPos[p.course]) byPos[p.course] = [];
                              byPos[p.course].push({ ...p, seq: i + 1 });
                            }
                          });
                          const r = cs / 2 - 1.2;
                          return (
                            <svg width={svgSz} height={svgSz} style={{display:'block'}}>
                              {Array.from({length: 49}, (_, idx) => {
                                const row = Math.floor(idx / 7), col = idx % 7;
                                const isZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                                return (
                                  <rect key={idx} x={col*cs} y={row*cs} width={cs-0.5} height={cs-0.5}
                                    fill={isZone ? '#f0f9ff' : '#f8fafc'}
                                    stroke={isZone ? '#bae6fd' : '#e2e8f0'} strokeWidth="0.4" />
                                );
                              })}
                              <rect x={2*cs} y={2*cs} width={3*cs} height={3*cs} fill="none" stroke="#475569" strokeWidth="1.5" rx="0.5" />
                              {Object.entries(byPos).map(([course, ps]) => {
                                const cIdx = parseInt(course);
                                const row = Math.floor(cIdx / 7), col = cIdx % 7;
                                const baseCx = col*cs + cs/2, baseCy = row*cs + cs/2;
                                return ps.map((p, pIdx) => {
                                  const angle = ps.length > 1 ? (pIdx / ps.length) * Math.PI * 2 - Math.PI/2 : 0;
                                  const dist = ps.length > 1 ? r * 0.55 : 0;
                                  const cx = baseCx + Math.cos(angle) * dist;
                                  const cy = baseCy + Math.sin(angle) * dist;
                                  const color = ptColors[p.type] || '#94a3b8';
                                  const isBall = ['ボール','ウエスト'].includes(p.result);
                                  const isLastPitch = p.seq === abPitches.length;
                                  return (
                                    <g key={pIdx}>
                                      {isLastPitch && <circle cx={cx} cy={cy} r={r+2} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 1" opacity="0.7" />}
                                      <circle cx={cx} cy={cy} r={r}
                                        fill={isBall ? 'white' : color}
                                        stroke={color} strokeWidth={isBall ? 1.2 : 0}
                                        opacity={0.92} />
                                      <text x={cx} y={cy+2.2} textAnchor="middle" fontSize="5" fontWeight="900"
                                        fill={isBall ? color : 'white'}>{p.seq}</text>
                                    </g>
                                  );
                                });
                              })}
                            </svg>
                          );
                        };
                        const getResultLabel = (result) => {
                          if (['ボール','ウエスト'].includes(result)) return { text: 'BB/HBP', color: '#64748b' };
                          if (result === '三振' || result === '振り逃げ') return { text: '三振', color: '#ef4444' };
                          if (['安','塁打','本塁打'].some(w => result.includes(w))) return { text: result, color: '#1d4ed8' };
                          return { text: result, color: '#475569' };
                        };
                        const playersWithABs = data.players.filter(bp => bp.PA > 0 && bp.atBats && bp.atBats.length > 0);
                        if (!playersWithABs.length) return null;
                        return (
                          <div className="mt-6 border-t border-slate-200 pt-5">
                            <h4 className="text-sm font-black text-slate-700 mb-2">📋 打席内容 <span className="text-xs font-normal text-slate-400">(配球・打球方向)</span></h4>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[10px] text-slate-500 items-center">
                              {Object.entries(ptColors).map(([n,c]) => (
                                <span key={n} className="flex items-center gap-1">
                                  <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={c} /></svg>{n}
                                </span>
                              ))}
                              <span className="text-slate-300 mx-1">|</span>
                              <span>○=ボール ●=ストライク系 数字=投球順 点線=最終球</span>
                            </div>
                            <div className="space-y-4">
                              {playersWithABs.map((batter, bi) => (
                                <div key={bi} className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                                  <div className="text-xs font-black text-slate-700 mb-3">
                                    {batter.order}番 {batter.name}
                                    <span className="ml-2 text-slate-400 font-normal text-[10px]">{batter.AB}打数 {batter.H}安打 打率{batter.AVG}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-3">
                                    {batter.atBats.map((ab, abIdx) => {
                                      const rl = getResultLabel(ab.result);
                                      return (
                                        <div key={abIdx} className="flex flex-col items-center gap-1" style={{minWidth: svgSz * 2 + 6, maxWidth: svgSz * 2 + 14}}>
                                          <div className="text-[10px] text-slate-500 font-bold">{ab.inning}回{ab.isTop?'表':'裏'}</div>
                                          <div className="flex items-start gap-1.5">
                                            <div className="flex flex-col items-center gap-0.5">
                                              <span className="text-[8px] font-bold text-slate-400">配球</span>
                                              <div style={{border:'1px solid #e2e8f0',borderRadius:6,overflow:'hidden',background:'white'}}>
                                                {renderAbZone(ab.pitches)}
                                              </div>
                                            </div>
                                            <div className="flex flex-col items-center gap-0.5">
                                              <span className="text-[8px] font-bold text-slate-400">打球方向</span>
                                              <SprayChart hits={ab.sprayHit ? [ab.sprayHit] : []} size={svgSz} compact emptyLabel="打球なし" />
                                            </div>
                                          </div>
                                          <div className="text-[10px] font-black text-center leading-snug px-1" style={{color: rl.color, maxWidth: svgSz * 2 + 8, overflowWrap: 'anywhere'}}>{rl.text}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="mt-6">
                        <h4 className="text-sm font-black text-slate-700 mb-3">🎯 打者別 打球方向</h4>
                        <div className="flex flex-wrap gap-4 justify-center">
                          {data.players.filter(p => p.sprayHits && p.sprayHits.length > 0).map((p, i) => (
                            <SprayChart key={i} hits={p.sprayHits} title={`${p.order}番 ${p.name}`} size={160} />
                          ))}
                          {data.players.filter(p => p.sprayHits && p.sprayHits.length > 0).length === 0 && (
                            <p className="text-xs text-slate-400 py-4">打球データがありません</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Pitching stats with charts */}
                  {[{data: advancedStats.pitchingTop, name: gameInfo.teamTop, label: '先攻投手陣'}, {data: advancedStats.pitchingBottom, name: gameInfo.teamBottom, label: '後攻投手陣'}].map(({data, name, label}) => (
                    <div key={label} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                      <h3 className="text-base font-black text-slate-800 mb-4">⚾ {label}: {name}</h3>
                      {data.pitchers.map((p, pi) => {
                        const pieColors = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
                        const pieTotal = p.types.reduce((s,t) => s + t.total, 0);
                        const allPitchTypes = [...new Set(p.types.map(t => t.type))];
                        const countLabels = [{key:'ahead',label:'投手有利',color:'#3b82f6'},{key:'even',label:'並行',color:'#64748b'},{key:'behind',label:'打者有利',color:'#ef4444'}];
                        const countDataAll = {};
                        ['vsRight','vsLeft'].forEach(side => {
                          countLabels.forEach(cl => {
                            const cObj = p.counts[side][cl.key];
                            Object.entries(cObj.types || {}).forEach(([type, cnt]) => {
                              if (!countDataAll[cl.key]) countDataAll[cl.key] = {};
                              countDataAll[cl.key][type] = (countDataAll[cl.key][type] || 0) + cnt;
                            });
                          });
                        });
                        const countCourseAll = {};
                        const hmAll = {};
                        allPitchTypes.forEach(type => { hmAll[type] = {}; });
                        countLabels.forEach(cl => { countCourseAll[cl.key] = {}; allPitchTypes.forEach(type => { countCourseAll[cl.key][type] = {}; }); });
                        if (p.pitchTypeHeatmaps) {
                          Object.entries(p.pitchTypeHeatmaps).forEach(([type, hm]) => {
                            if (!hmAll[type]) hmAll[type] = {};
                            Object.entries(hm.all || {}).forEach(([c, cnt]) => { hmAll[type][c] = (hmAll[type][c] || 0) + cnt; });
                            countLabels.forEach(cl => {
                              if (!countCourseAll[cl.key][type]) countCourseAll[cl.key][type] = {};
                              Object.entries(hm[cl.key] || {}).forEach(([c, cnt]) => { countCourseAll[cl.key][type][c] = (countCourseAll[cl.key][type][c] || 0) + cnt; });
                            });
                          });
                        }
                        const renderHeatmap = (hmData, color, size) => {
                          const mx = Math.max(1, ...Object.values(hmData).map(Number));
                          const cs = size === 'sm' ? 8 : 12;
                          const ts = cs * 7;
                          const zs = cs * 2;
                          const zw = cs * 3;
                          return (
                            <svg width={ts} height={ts} viewBox={`0 0 ${ts} ${ts}`}>
                              {Array.from({length: 49}, (_, idx) => {
                                const row = Math.floor(idx / 7), col = idx % 7;
                                const x = col * cs, y = row * cs;
                                const isZone = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                                const cnt = hmData[idx] || 0;
                                const intensity = cnt > 0 ? Math.max(0.18, cnt / mx) : 0;
                                return <rect key={idx} x={x} y={y} width={cs - 0.5} height={cs - 0.5} rx="1"
                                  fill={cnt > 0 ? color : (isZone ? '#f1f5f9' : '#f8fafc')}
                                  opacity={cnt > 0 ? intensity : 1}
                                  stroke={isZone ? '#cbd5e1' : '#e2e8f0'} strokeWidth="0.3" />;
                              })}
                              <rect x={zs} y={zs} width={zw} height={zw} fill="none" stroke="#64748b" strokeWidth="1" rx="0.5" />
                              {size !== 'sm' && Array.from({length: 49}, (_, idx) => {
                                const cnt = hmData[idx] || 0;
                                if (cnt === 0) return null;
                                const row = Math.floor(idx / 7), col = idx % 7;
                                return <text key={`t${idx}`} x={col * cs + cs/2} y={row * cs + cs/2 + 2} textAnchor="middle" fontSize="5.5" fontWeight="900" fill="white">{cnt}</text>;
                              })}
                            </svg>
                          );
                        };
                        const allCourseData = {};
                        Object.values(hmAll).forEach(typeMap => { Object.entries(typeMap).forEach(([c, cnt]) => { allCourseData[c] = (allCourseData[c] || 0) + cnt; }); });
                        return (
                        <div key={pi} className="mb-8 last:mb-0 bg-slate-50 rounded-xl border border-slate-200 p-4">
                          <div className="flex justify-between items-center mb-3">
                            <div className="font-black text-lg text-slate-800">{p.name} <span className="text-sm text-slate-500 font-bold ml-2">{p.total}球</span></div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 mb-4">
                            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">CSW%</div><div className="text-2xl font-black text-amber-600">{p.csw}%</div></div>
                            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">Whiff%</div><div className="text-2xl font-black text-rose-600">{p.whiff}%</div></div>
                            <div className="bg-white p-3 rounded-xl border border-slate-200 text-center"><div className="text-[10px] text-slate-500 font-bold uppercase">初球S率</div><div className="text-2xl font-black text-blue-600">{p.fStrikePct}%</div></div>
                          </div>

                          {/* === SECTION: スプリット === */}
                          {p.sideStats && (
                            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                              {[{label:'🆚 対左右', rows:[{name:'対右', d:p.sideStats.right},{name:'対左', d:p.sideStats.left}]}, {label:'📊 打順', rows:[{name:'上位 1〜5番', d:p.orderStats.top},{name:'下位 6〜9番', d:p.orderStats.bottom}]}].map(({label, rows}) => (
                                <div key={label} className="flex-1 bg-white rounded-xl border border-slate-200 p-3">
                                  <div className="text-[10px] font-black text-slate-600 mb-2">{label}</div>
                                  <table className="w-full text-[10px] border-collapse">
                                    <thead><tr className="border-b border-slate-200 bg-slate-50">
                                      <th className="py-1 px-1 text-left font-black text-slate-500"></th>
                                      <th className="py-1 px-1 text-right font-black text-slate-500">打席</th>
                                      <th className="py-1 px-1 text-right font-black text-slate-500">投球</th>
                                      <th className="py-1 px-1 text-right font-black text-sky-600">S%</th>
                                      <th className="py-1 px-1 text-right font-black text-blue-600">被打率</th>
                                      <th className="py-1 px-1 text-right font-black text-rose-600">K%</th>
                                      <th className="py-1 px-1 text-right font-black text-emerald-600">BB%</th>
                                    </tr></thead>
                                    <tbody>
                                      {rows.map(({name, d}, ri) => (
                                        <tr key={ri} className={`border-b border-slate-100 ${ri%2===1?'bg-slate-50':''}`}>
                                          <td className="py-1 px-1 font-bold text-slate-700">{name}</td>
                                          <td className="py-1 px-1 text-right">{d.PA}</td>
                                          <td className="py-1 px-1 text-right">{d.total}</td>
                                          <td className="py-1 px-1 text-right text-sky-600 font-bold">{d.sPct}%</td>
                                          <td className="py-1 px-1 text-right text-blue-600 font-bold">{d.AVG}</td>
                                          <td className="py-1 px-1 text-right text-rose-600 font-bold">{d.KPct}%</td>
                                          <td className="py-1 px-1 text-right text-emerald-600 font-bold">{d.BBPct}%</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* === SECTION: 全体 === */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
                            <div className="text-xs font-black text-slate-700 mb-3">📊 全体 — 球種割合 & コース分布</div>
                            <div className="flex flex-col sm:flex-row gap-4">
                              {/* Left: pitch type table (numbers only) */}
                              <div className="sm:w-48 shrink-0">
                                <table className="w-full text-[10px] border-collapse">
                                  <thead><tr className="border-b border-slate-200 bg-slate-50">
                                    <th className="py-1 px-1.5 text-left font-black text-slate-600">球種</th>
                                    <th className="py-1 px-1.5 text-right font-black text-slate-600">数</th>
                                    <th className="py-1 px-1.5 text-right font-black text-slate-600">割合</th>
                                    <th className="py-1 px-1.5 text-right font-black text-amber-600">CSW</th>
                                    <th className="py-1 px-1.5 text-right font-black text-rose-600">空振</th>
                                  </tr></thead>
                                  <tbody>
                                    {p.types.map((t, ti) => (
                                      <tr key={ti} className="border-b border-slate-100">
                                        <td className="py-1 px-1.5 font-bold"><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block shrink-0" style={{backgroundColor: pieColors[ti % pieColors.length]}}></span>{t.type}</span></td>
                                        <td className="py-1 px-1.5 text-right font-bold">{t.total}</td>
                                        <td className="py-1 px-1.5 text-right font-black text-blue-600">{Math.round((t.total/(pieTotal||1))*100)}%</td>
                                        <td className="py-1 px-1.5 text-right font-bold text-amber-600">{t.csw}%</td>
                                        <td className="py-1 px-1.5 text-right font-bold text-rose-600">{t.whiff}%</td>
                                      </tr>
                                    ))}
                                    <tr className="bg-slate-50 font-black">
                                      <td className="py-1 px-1.5">合計</td>
                                      <td className="py-1 px-1.5 text-right">{pieTotal}</td>
                                      <td className="py-1 px-1.5 text-right">—</td>
                                      <td className="py-1 px-1.5 text-right text-amber-600">{p.csw}%</td>
                                      <td className="py-1 px-1.5 text-right text-rose-600">{p.whiff}%</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              {/* Right: course heatmaps per pitch type */}
                              <div className="flex-1">
                                <div className="flex flex-wrap gap-3 justify-center">
                                  <div className="flex flex-col items-center">
                                    <div className="text-[9px] font-black text-slate-500 mb-1">全球種</div>
                                    {renderHeatmap(allCourseData, '#334155', 'lg')}
                                  </div>
                                  {p.types.filter(t => hmAll[t.type] && Object.keys(hmAll[t.type]).length > 0).map((t, ti) => (
                                    <div key={ti} className="flex flex-col items-center">
                                      <div className="text-[9px] font-black mb-1" style={{color: pieColors[ti % pieColors.length]}}>{t.type}</div>
                                      {renderHeatmap(hmAll[t.type], pieColors[ti % pieColors.length], 'lg')}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* === SECTION: カウント別 === */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <div className="text-xs font-black text-slate-700 mb-3">📈 カウント別 — 球種割合 & コース分布</div>
                            <div className="space-y-5">
                              {countLabels.map(cl => {
                                const cData = countDataAll[cl.key] || {};
                                const cTotal = Object.values(cData).reduce((s,v) => s + v, 0);
                                if (cTotal === 0) return null;
                                const cCourseAll = {};
                                Object.values(countCourseAll[cl.key] || {}).forEach(typeMap => { Object.entries(typeMap).forEach(([c, cnt]) => { cCourseAll[c] = (cCourseAll[c] || 0) + cnt; }); });
                                return (
                                  <div key={cl.key} className="border-l-4 pl-3 rounded-r-lg" style={{borderColor: cl.color}}>
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-[11px] font-black" style={{color: cl.color}}>{cl.label}</span>
                                      <span className="text-[10px] text-slate-400 font-bold">({cTotal}球)</span>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-3">
                                      {/* Pitch type numbers */}
                                      <div className="sm:w-36 shrink-0">
                                        <table className="w-full text-[9px] border-collapse">
                                          <thead><tr className="border-b border-slate-200">
                                            <th className="py-0.5 px-1 text-left font-black text-slate-500">球種</th>
                                            <th className="py-0.5 px-1 text-right font-black text-slate-500">数</th>
                                            <th className="py-0.5 px-1 text-right font-black text-slate-500">割合</th>
                                          </tr></thead>
                                          <tbody>
                                            {allPitchTypes.map((type, ti) => {
                                              const cnt = cData[type] || 0;
                                              if (cnt === 0) return null;
                                              return (
                                                <tr key={ti} className="border-b border-slate-50">
                                                  <td className="py-0.5 px-1 font-bold"><span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{backgroundColor: pieColors[ti % pieColors.length]}}></span>{type}</span></td>
                                                  <td className="py-0.5 px-1 text-right">{cnt}</td>
                                                  <td className="py-0.5 px-1 text-right font-black">{Math.round((cnt/cTotal)*100)}%</td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                      {/* Course heatmaps */}
                                      <div className="flex flex-wrap gap-2 justify-center flex-1">
                                        <div className="flex flex-col items-center">
                                          <div className="text-[8px] font-black text-slate-400 mb-0.5">全球種</div>
                                          {renderHeatmap(cCourseAll, cl.color, 'sm')}
                                        </div>
                                        {allPitchTypes.map((type, ti) => {
                                          const typeHm = (countCourseAll[cl.key] || {})[type] || {};
                                          if (Object.keys(typeHm).length === 0) return null;
                                          return (
                                            <div key={ti} className="flex flex-col items-center">
                                              <div className="text-[8px] font-black mb-0.5" style={{color: pieColors[ti % pieColors.length]}}>{type.slice(0,4)}</div>
                                              {renderHeatmap(typeHm, pieColors[ti % pieColors.length], 'sm')}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL: Share / Import ======================== */}
          {/* ============================================================ */}
          {showShareModal && (
            <div className="fixed inset-0 bg-slate-900/80 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-blue-50 flex justify-between items-center">
                  <h2 className="text-lg font-bold text-blue-800">📤 データの共有</h2>
                  <button onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-black font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 flex flex-col items-center gap-4 bg-slate-50">
                  <p className="text-sm font-bold text-slate-600 text-center">以下のテキストをコピーして送ってください。</p>
                  <textarea value={shareTextData} readOnly className="w-full h-32 p-3 border-2 border-slate-300 rounded-xl text-[10px] font-mono bg-white" onClick={(e) => e.target.select()} />
                  <button onClick={() => { navigator.clipboard.writeText(shareTextData).then(() => showToast('コピーしました！')).catch(() => { const ta = document.createElement('textarea'); ta.value = shareTextData; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('コピーしました！'); }); }} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-md active:scale-95">テキストをコピーする</button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* ============= MODAL: CUMULATIVE STATS (累計成績) =========== */}
          {/* ============================================================ */}
          {showCumulativeStats && (
            <div className="fixed inset-0 bg-slate-900/70 z-[200] flex items-center justify-center p-2 md:p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] border border-slate-200">
                <div className="p-4 border-b border-amber-200 bg-amber-50 flex justify-between items-center shrink-0">
                  <div>
                    <h2 className="text-lg font-black text-amber-800">📊 累計成績</h2>
                    <div className="text-[11px] font-bold text-amber-700 mt-0.5">{cumulativeTeam} / {cumulativeStats.games.length}試合</div>
                  </div>
                  <button onClick={() => setShowCumulativeStats(false)} className="text-amber-400 hover:text-amber-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0 flex flex-col gap-2">
                  <div className="flex gap-2 items-center flex-wrap">
                    <label className="text-[10px] font-bold text-slate-500">チーム</label>
                    <select value={cumulativeTeam} onChange={e => setCumulativeTeam(e.target.value)} className="text-xs font-bold border border-slate-300 rounded px-2 py-1 bg-white">
                      {registeredTeams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                    </select>
                    <label className="text-[10px] font-bold text-slate-500 ml-2">期間</label>
                    <input type="date" value={cumulativeDateFrom} onChange={e => setCumulativeDateFrom(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white" />
                    <span className="text-xs text-slate-400">〜</span>
                    <input type="date" value={cumulativeDateTo} onChange={e => setCumulativeDateTo(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white" />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => { setCumulativeDateFrom(''); setCumulativeDateTo(''); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">全期間</button>
                    <button onClick={() => { const n = new Date(); const fm = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`; const last = new Date(n.getFullYear(), n.getMonth()+1, 0); const tm = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`; setCumulativeDateFrom(fm); setCumulativeDateTo(tm); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">今月</button>
                    <button onClick={() => { const y = new Date().getFullYear(); setCumulativeDateFrom(`${y}-01-01`); setCumulativeDateTo(`${y}-12-31`); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">今年</button>
                    <button onClick={() => { const y = new Date().getFullYear() - 1; setCumulativeDateFrom(`${y}-01-01`); setCumulativeDateTo(`${y}-12-31`); }} className="text-[10px] bg-white text-slate-600 border border-slate-300 px-2.5 py-1 rounded-lg font-bold">昨年</button>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setCumulativeTab('batter')} className={`flex-1 py-2 rounded-lg font-black text-xs ${cumulativeTab==='batter' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-300'}`}>🏏 打者</button>
                    <button onClick={() => setCumulativeTab('pitcher')} className={`flex-1 py-2 rounded-lg font-black text-xs ${cumulativeTab==='pitcher' ? 'bg-rose-600 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-300'}`}>⚾ 投手</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto modal-scroll p-3">
                  {cumulativeStats.games.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-12 font-bold">この期間に保存試合がありません</p>
                  ) : cumulativeTab === 'batter' ? (
                    cumulativeStats.batters.length === 0 ? <p className="text-center text-slate-400 text-sm py-12 font-bold">打者データなし</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-100 text-slate-600 text-[10px]">
                            <tr>
                              <th className="py-2 px-2 text-left">選手名</th>
                              <th className="py-2 px-1 text-right">G</th>
                              <th className="py-2 px-1 text-right">PA</th>
                              <th className="py-2 px-1 text-right">AB</th>
                              <th className="py-2 px-1 text-right">H</th>
                              <th className="py-2 px-1 text-right">2B</th>
                              <th className="py-2 px-1 text-right">3B</th>
                              <th className="py-2 px-1 text-right">HR</th>
                              <th className="py-2 px-1 text-right">四死</th>
                              <th className="py-2 px-1 text-right">K</th>
                              <th className="py-2 px-1 text-right text-blue-600">打率</th>
                              <th className="py-2 px-1 text-right text-emerald-600">出塁</th>
                              <th className="py-2 px-1 text-right text-purple-600">長打</th>
                              <th className="py-2 px-1 text-right text-amber-600">OPS</th>
                              <th className="py-2 px-1 text-right text-rose-600">K%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cumulativeStats.batters.map((b, i) => (
                              <React.Fragment key={b.name}>
                                <tr onClick={() => setExpandedCumKey(expandedCumKey === `b-${b.name}` ? null : `b-${b.name}`)} className={`cursor-pointer border-b border-slate-200 ${i%2===0?'bg-white':'bg-slate-50'} hover:bg-amber-50`}>
                                  <td className="py-2 px-2 font-black">{expandedCumKey===`b-${b.name}`?'▼':'▶'} {b.name}</td>
                                  <td className="py-2 px-1 text-right">{b.G}</td>
                                  <td className="py-2 px-1 text-right">{b.PA}</td>
                                  <td className="py-2 px-1 text-right">{b.AB}</td>
                                  <td className="py-2 px-1 text-right">{b.H}</td>
                                  <td className="py-2 px-1 text-right">{b._2B}</td>
                                  <td className="py-2 px-1 text-right">{b._3B}</td>
                                  <td className="py-2 px-1 text-right">{b.HR}</td>
                                  <td className="py-2 px-1 text-right">{b.BB_HBP}</td>
                                  <td className="py-2 px-1 text-right">{b.K}</td>
                                  <td className="py-2 px-1 text-right font-black text-blue-600">{b.AVG}</td>
                                  <td className="py-2 px-1 text-right font-black text-emerald-600">{b.OBP}</td>
                                  <td className="py-2 px-1 text-right font-black text-purple-600">{b.SLG}</td>
                                  <td className="py-2 px-1 text-right font-black text-amber-600">{b.OPS}</td>
                                  <td className="py-2 px-1 text-right text-rose-600">{b.KPct}%</td>
                                </tr>
                                {expandedCumKey===`b-${b.name}` && (
                                  <tr><td colSpan={15} className="bg-amber-50/60 p-2">
                                    <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">試合別ログ</div>
                                    <table className="w-full text-[11px] border-collapse">
                                      <thead className="bg-white text-slate-500 text-[10px]">
                                        <tr><th className="py-1 px-2 text-left">日付</th><th className="py-1 px-2 text-left">対戦</th><th className="py-1 px-1 text-right">PA</th><th className="py-1 px-1 text-right">AB</th><th className="py-1 px-1 text-right">H</th><th className="py-1 px-1 text-right">四死</th><th className="py-1 px-1 text-right">K</th><th className="py-1 px-1 text-left">結果</th></tr>
                                      </thead>
                                      <tbody>
                                        {b.gameLog.map((gl, gi) => (
                                          <tr key={gi} className="border-b border-amber-100"><td className="py-1 px-2">{gl.date}</td><td className="py-1 px-2">{gl.opponent}</td><td className="py-1 px-1 text-right">{gl.PA}</td><td className="py-1 px-1 text-right">{gl.AB}</td><td className="py-1 px-1 text-right">{gl.H}</td><td className="py-1 px-1 text-right">{gl.BB_HBP}</td><td className="py-1 px-1 text-right">{gl.K}</td><td className="py-1 px-2 text-[10px]">{gl.results.join(', ')}</td></tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td></tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    cumulativeStats.pitchers.length === 0 ? <p className="text-center text-slate-400 text-sm py-12 font-bold">投手データなし</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-100 text-slate-600 text-[10px]">
                            <tr>
                              <th className="py-2 px-2 text-left">投手</th>
                              <th className="py-2 px-1 text-right">G</th>
                              <th className="py-2 px-1 text-right">球数</th>
                              <th className="py-2 px-1 text-right">対戦</th>
                              <th className="py-2 px-1 text-right">H</th>
                              <th className="py-2 px-1 text-right">K</th>
                              <th className="py-2 px-1 text-right">BB</th>
                              <th className="py-2 px-1 text-right text-blue-600">被打率</th>
                              <th className="py-2 px-1 text-right text-rose-600">K%</th>
                              <th className="py-2 px-1 text-right text-amber-600">BB%</th>
                              <th className="py-2 px-1 text-right text-indigo-600">CSW%</th>
                              <th className="py-2 px-1 text-right text-emerald-600">Whiff%</th>
                              <th className="py-2 px-1 text-right">S%</th>
                              <th className="py-2 px-1 text-right">初球S%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cumulativeStats.pitchers.map((p, i) => (
                              <React.Fragment key={p.name}>
                                <tr onClick={() => setExpandedCumKey(expandedCumKey === `p-${p.name}` ? null : `p-${p.name}`)} className={`cursor-pointer border-b border-slate-200 ${i%2===0?'bg-white':'bg-slate-50'} hover:bg-amber-50`}>
                                  <td className="py-2 px-2 font-black">{expandedCumKey===`p-${p.name}`?'▼':'▶'} {p.name} <span className="text-[9px] text-slate-400">({p.throws}投)</span></td>
                                  <td className="py-2 px-1 text-right">{p.G}</td>
                                  <td className="py-2 px-1 text-right">{p.pitches}</td>
                                  <td className="py-2 px-1 text-right">{p.PA}</td>
                                  <td className="py-2 px-1 text-right">{p.H}</td>
                                  <td className="py-2 px-1 text-right">{p.K}</td>
                                  <td className="py-2 px-1 text-right">{p.BB}</td>
                                  <td className="py-2 px-1 text-right font-black text-blue-600">{p.AVG}</td>
                                  <td className="py-2 px-1 text-right font-black text-rose-600">{p.KPct}%</td>
                                  <td className="py-2 px-1 text-right font-black text-amber-600">{p.BBPct}%</td>
                                  <td className="py-2 px-1 text-right font-black text-indigo-600">{p.csw}%</td>
                                  <td className="py-2 px-1 text-right font-black text-emerald-600">{p.whiffPct}%</td>
                                  <td className="py-2 px-1 text-right">{p.strikePct}%</td>
                                  <td className="py-2 px-1 text-right">{p.fStrikePct}%</td>
                                </tr>
                                {expandedCumKey===`p-${p.name}` && (
                                  <tr><td colSpan={14} className="bg-amber-50/60 p-2">
                                    {p.types.length > 0 && (
                                      <div className="mb-3">
                                        <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">球種別</div>
                                        <div className="flex flex-wrap gap-2">
                                          {p.types.map(t => (
                                            <div key={t.type} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[10px]">
                                              <span className="font-black text-slate-700">{t.type}</span>
                                              <span className="text-slate-400 mx-1">·</span>
                                              <span>{t.total}球</span>
                                              <span className="text-slate-400 mx-1">·</span>
                                              <span className="text-indigo-600 font-bold">S {t.strikePct}%</span>
                                              <span className="text-slate-400 mx-1">·</span>
                                              <span className="text-emerald-600 font-bold">Whiff {t.whiffPct}%</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <div className="text-[10px] font-bold text-slate-500 mb-1 px-1">試合別ログ</div>
                                    <table className="w-full text-[11px] border-collapse">
                                      <thead className="bg-white text-slate-500 text-[10px]">
                                        <tr><th className="py-1 px-2 text-left">日付</th><th className="py-1 px-2 text-left">対戦</th><th className="py-1 px-1 text-right">球数</th><th className="py-1 px-1 text-right">対戦</th><th className="py-1 px-1 text-right">H</th><th className="py-1 px-1 text-right">K</th><th className="py-1 px-1 text-right">BB</th><th className="py-1 px-1 text-right">S%</th></tr>
                                      </thead>
                                      <tbody>
                                        {p.gameLog.map((gl, gi) => (
                                          <tr key={gi} className="border-b border-amber-100"><td className="py-1 px-2">{gl.date}</td><td className="py-1 px-2">{gl.opponent}</td><td className="py-1 px-1 text-right">{gl.pitches}</td><td className="py-1 px-1 text-right">{gl.PA}</td><td className="py-1 px-1 text-right">{gl.H}</td><td className="py-1 px-1 text-right">{gl.K}</td><td className="py-1 px-1 text-right">{gl.BB}</td><td className="py-1 px-1 text-right">{gl.pitches>0?Math.round(gl.strikes/gl.pitches*100):0}%</td></tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td></tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </div>
                <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0">
                  <button onClick={() => setShowCumulativeStats(false)} className="w-full bg-slate-700 text-white py-2.5 rounded-xl font-bold text-sm">閉じる</button>
                </div>
              </div>
            </div>
          )}

          {showImportTextModal && (
            <div className="fixed inset-0 bg-slate-900/80 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-200">
                <div className="p-4 border-b border-emerald-200 bg-emerald-50 flex justify-between items-center">
                  <h2 className="text-lg font-black text-emerald-800">📥 データの受信</h2>
                  <button onClick={() => setShowImportTextModal(false)} className="text-emerald-400 hover:text-emerald-800 font-bold text-xl px-2">✕</button>
                </div>
                <div className="p-6 flex flex-col gap-4 bg-white">
                  <p className="text-sm font-bold text-slate-600 text-center">共有テキスト、またはスコアラーアプリの書き出しデータ(GDF)を貼り付けてください。</p>
                  <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'BASEBALL_SHARE:... もしくは {"kind":"GDF",...}'} className="w-full h-32 p-4 border-2 border-slate-200 rounded-xl text-xs font-mono bg-slate-50 outline-none resize-none" />
                  <div className="flex gap-3 mt-2">
                    <button onClick={() => setShowImportTextModal(false)} className="flex-1 bg-slate-100 border border-slate-300 text-slate-700 font-bold py-3.5 rounded-xl">キャンセル</button>
                    <button onClick={handleImportText} className="flex-1 bg-emerald-600 text-white font-black py-3.5 rounded-xl shadow-md active:scale-95">データを復元する</button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      );
    }

export default App;
