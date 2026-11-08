import { Capacitor } from '@capacitor/core';

// 新しい版が公開されて準備できたときに window へ送るイベント名
export const UPDATE_READY_EVENT = 'app-update-ready';

// Service Worker を登録してオフラインでも起動できるようにする(PWA)。
//
// 登録しない場合:
//  - ネイティブ(iOS/Capacitor): 資産は最初から端末内にあり、
//    WKWebView のキャッシュと二重管理になるだけなので不要。
//  - 開発サーバー: 古い資産を掴んで変更が反映されなくなるため入れない。
//  - 未対応ブラウザ・非セキュアな配信: そもそも使えない。
//
// 更新の確認: ホーム画面に追加したアプリは iPhone が閉じずに保持し続けるため、
// 新しい版を公開しても読み込み直されない。アプリが前面に戻るたびに sw.js を
// 確認し、新しい版が待機状態になったら UPDATE_READY_EVENT で知らせる。
// 切り替えは利用者がボタンを押したときだけ行う(試合中に勝手に再読み込みしない)。
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (Capacitor.isNativePlatform()) return false;
  if (!import.meta.env.PROD) return false;

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => watchForUpdates(reg))
    .catch((e) => {
      // 登録に失敗してもアプリ自体は動くので、記録の妨げにはしない
      console.error('Service Worker の登録に失敗:', e);
    });
  return true;
}

export function watchForUpdates(reg) {
  if (!reg) return;
  // 初回インストール(controller なし)は「更新」ではないので知らせない
  const notifyIfWaiting = () => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      window.dispatchEvent(new CustomEvent(UPDATE_READY_EVENT, { detail: reg.waiting }));
    }
  };
  notifyIfWaiting();

  reg.addEventListener?.('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed') notifyIfWaiting();
    });
  });

  const check = () => {
    if (document.visibilityState !== 'visible') return;
    Promise.resolve(reg.update?.()).catch(() => {}).then(notifyIfWaiting);
  };
  document.addEventListener('visibilitychange', check);
  // 開きっぱなしでも気づけるよう、たまに確認する
  setInterval(check, 30 * 60 * 1000);
}

// 待機中の新しい版に切り替えてページを読み込み直す
export function applyUpdate(waitingWorker) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}
