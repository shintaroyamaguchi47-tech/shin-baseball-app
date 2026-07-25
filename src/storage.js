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
  'baseball_askAdvanceAfterHit_v1',
  'baseball_savedGames_v2',
  'baseball_registeredTeams_v2',
  'baseball_homeTeam_v3',
  'baseball_playerNotes_v3',
];

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
}

export function getItem(key) {
  return localStorage.getItem(key);
}

export function setItem(key, value) {
  localStorage.setItem(key, value);
  if (isNative) {
    Preferences.set({ key, value }).catch((e) => {
      console.error('ネイティブストレージへの保存に失敗:', key, e);
    });
  }
}
