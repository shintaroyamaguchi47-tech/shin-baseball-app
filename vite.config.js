import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// public/ 以下の静的ファイル(アイコン・マニフェスト)を列挙する。
// バンドルには載らずそのままコピーされるため、別途キャッシュ対象に加える必要がある。
function listPublicFiles(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listPublicFiles(path.join(dir, entry.name), rel)
      : [rel];
  });
}

// ビルド成果物を precache する Service Worker を生成するプラグイン。
//
// 資産名はハッシュ付きで毎ビルド変わるため、一覧はビルド時にしか作れない。
// workbox 等を足さずに済むよう、必要な最小限をここで組み立てている。
//
// 更新の当て方: 新しい Service Worker は skipWaiting しない。
// 試合中にアプリを開いたまま資産が入れ替わるのを避け、
// すべてのタブを閉じて開き直したときに新版へ切り替わるようにしている。
function precacheServiceWorker() {
  return {
    name: 'precache-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).map((f) => `./${f}`);
      const publicFiles = listPublicFiles(path.resolve('public')).map((f) => `./${f}`);
      // './' はサブパス配信での入口。index.html を直接開かれた場合にも当たるよう両方入れる。
      // sw.js 自身と、巨大なソースマップはキャッシュ対象から外す。
      const precache = [...new Set(['./', './index.html', ...assets, ...publicFiles])].filter(
        (f) => !f.endsWith('/sw.js') && !f.endsWith('.map')
      );
      const version = crypto.createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);

      const source = `// このファイルはビルド時に自動生成されます(vite.config.js)。直接編集しないでください。
const CACHE = 'haikyu-score-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  // グラウンドで圏外になっても開けるよう、全資産を先に取り込む
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面遷移(再読み込み)はネットワーク優先。オンラインなら新版が反映され、
  // 圏外ならキャッシュしたページで記録を続けられる。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // 資産はファイル名にハッシュが入っており中身が変わらないのでキャッシュ優先
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
  // 相対パス出力: GitHub Pages のサブパス配信や、将来の Capacitor 同梱に対応
  base: './',
});
