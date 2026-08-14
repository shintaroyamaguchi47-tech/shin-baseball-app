import { Capacitor } from '@capacitor/core';

// Service Worker を登録してオフラインでも起動できるようにする(PWA)。
//
// 登録しない場合:
//  - ネイティブ(iOS/Capacitor): 資産は最初から端末内にあり、
//    WKWebView のキャッシュと二重管理になるだけなので不要。
//  - 開発サーバー: 古い資産を掴んで変更が反映されなくなるため入れない。
//  - 未対応ブラウザ・非セキュアな配信: そもそも使えない。
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (Capacitor.isNativePlatform()) return false;
  if (!import.meta.env.PROD) return false;

  navigator.serviceWorker.register('./sw.js').catch((e) => {
    // 登録に失敗してもアプリ自体は動くので、記録の妨げにはしない
    console.error('Service Worker の登録に失敗:', e);
  });
  return true;
}
