import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const isNative = Capacitor.isNativePlatform();

// アプリが永続化する全キー
export const STORAGE_KEYS = [
  'baseball_gameState_v2',
  'baseball_gameInfo_v2',
  'baseball_lineups_v2',
  'baseball_pitches_v2',
  'baseball_pitchView_v2',
  'baseball_stepInput_v1',
  'baseball_askAdvanceAfterHit_v1',
  'baseball_savedGames_v2',
  'baseball_registeredTeams_v2',
  'baseball_homeTeam_v3',
  'baseball_playerNotes_v3',
];

// localStorageの実質的な上限は多くのブラウザで5MB前後。
// 超えると setItem が QuotaExceededError を投げ、以降の記録が保存されなくなる。
// 上限に達してから気づくと手遅れなので、この割合を超えた時点で警告を出す。
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
export const STORAGE_WARN_RATIO = 0.8;

// 保存失敗・容量逼迫をApp側に伝えるためのハンドラ
let notifyHandler = null;

export function setStorageNotifier(fn) {
  notifyHandler = typeof fn === 'function' ? fn : null;
}

function notify(payload) {
  if (!notifyHandler) return;
  try {
    notifyHandler(payload);
  } catch (e) {
    console.error('ストレージ通知ハンドラでエラー:', e);
  }
}

// ブラウザによって名前もコードも違うため、複数の条件で容量超過を判定する
export function isQuotaError(e) {
  if (!e) return false;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

// localStorageはUTF-16で保持されるため、キーと値の文字数×2がおおよそのバイト数になる
const bytesOf = (key, value) => (value === null || value === undefined ? 0 : (key.length + value.length) * 2);

// キーごとの使用バイト数。起動時に一度だけ実測し、以降は書き込み時に差分更新する。
// 1球ごとの保存で毎回全キーを読み直すと、アーカイブが育つほど入力が重くなるため。
let byteTally = null;

function ensureTally() {
  if (byteTally) return byteTally;
  byteTally = new Map();
  for (const key of STORAGE_KEYS) {
    let value = null;
    try {
      value = localStorage.getItem(key);
    } catch (e) {
      value = null;
    }
    byteTally.set(key, bytesOf(key, value));
  }
  return byteTally;
}

// アプリが使っているキーの合計バイト数(概算)
export function estimateBytes() {
  let total = 0;
  for (const n of ensureTally().values()) total += n;
  return total;
}

// 使用量の概況。UI側の警告表示に使う。
export function getUsage() {
  const bytes = estimateBytes();
  const ratio = bytes / STORAGE_QUOTA_BYTES;
  return { bytes, ratio, nearLimit: ratio >= STORAGE_WARN_RATIO };
}

// 実測し直す。アーカイブ削除など、このモジュール以外がストレージを変えた後に使う。
export function refreshUsage() {
  byteTally = null;
  return getUsage();
}

// iOSのWKWebViewはストレージ逼迫時にlocalStorageを破棄することがあるため、
// ネイティブ実行時は Preferences(UserDefaults)を永続層として二重に書き込み、
// 起動時にlocalStorage側が消えていたらそこから復元する。
// localStorageは同期APIとして全画面ロジックから直接参照される一次キャッシュ。
export async function initStorage() {
  if (!isNative) return;
  for (const key of STORAGE_KEYS) {
    try {
      const { value } = await Preferences.get({ key });
      if (value !== null && localStorage.getItem(key) === null) {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.error('ネイティブストレージからの復元に失敗:', key, e);
    }
  }
  byteTally = null;
}

export function getItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error('ストレージの読み出しに失敗:', key, e);
    return null;
  }
}

// 保存を試み、成功したかどうかを返す。
// 容量超過などで書けなくてもここでは例外を投げない。1球入力のたびに呼ばれるため、
// 例外を素通しすると入力操作そのものが落ちてスコアラーが記録を続けられなくなる。
// 代わりに notifier 経由でApp側に伝え、ユーザーにバックアップと整理を促す。
export function setItem(key, value) {
  let ok = true;
  try {
    localStorage.setItem(key, value);
    ensureTally().set(key, bytesOf(key, value));
  } catch (e) {
    ok = false;
    const quota = isQuotaError(e);
    console.error('ストレージへの保存に失敗:', key, e);
    // ネイティブではPreferences側が生きていればデータ自体は残るので、警告の深刻度を分ける
    notify({ type: quota ? 'quota' : 'error', key, nativeBackup: isNative });
  }
  if (isNative) {
    Preferences.set({ key, value }).catch((e) => {
      console.error('ネイティブストレージへの保存に失敗:', key, e);
      notify({ type: 'native-error', key, nativeBackup: false });
    });
  }
  if (ok) {
    const usage = getUsage();
    if (usage.nearLimit) notify({ type: 'near-limit', key, ...usage });
  }
  return ok;
}
