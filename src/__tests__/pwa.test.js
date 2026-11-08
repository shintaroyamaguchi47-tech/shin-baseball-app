// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { registerServiceWorker, watchForUpdates, applyUpdate, UPDATE_READY_EVENT } from '../registerServiceWorker.js';

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));

describe('Webアプリマニフェスト', () => {
  it('ホーム画面へ追加するのに必要な項目が揃っている', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    // short_name はホーム画面のラベルになるため、切り詰められない長さに保つ
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('サブパス配信でも壊れないよう start_url と scope が相対パス', () => {
    // GitHub Pages は /<リポジトリ名>/ 配下に置かれるため、絶対パスだと入口を見失う
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('必要なサイズのアイコンが実在する', () => {
    const bySize = Object.fromEntries(manifest.icons.map((i) => [`${i.sizes}:${i.purpose}`, i]));
    expect(bySize['192x192:any']).toBeTruthy();
    expect(bySize['512x512:any']).toBeTruthy();
    // Android のアダプティブアイコンで四隅を切られても欠けないもの
    expect(bySize['512x512:maskable']).toBeTruthy();

    for (const icon of manifest.icons) {
      const file = path.join(root, 'public', icon.src.replace(/^\.\//, ''));
      expect(fs.existsSync(file), `${icon.src} が存在しない`).toBe(true);
      const [w, h] = readPngSize(file);
      const [dw, dh] = icon.sizes.split('x').map(Number);
      expect([w, h], `${icon.src} の実寸が ${icon.sizes} と一致しない`).toEqual([dw, dh]);
    }
  });

  it('index.html からマニフェストとテーマ色が参照されている', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('./manifest.webmanifest');
    expect(html).toContain(`content="${manifest.theme_color}"`);
  });
});

// PNGヘッダ(IHDR)から幅と高さを読む
function readPngSize(file) {
  const buf = fs.readFileSync(file);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('Service Worker の登録', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete navigator.serviceWorker;
  });

  it('開発時は登録しない(古い資産を掴んで変更が反映されなくなるため)', () => {
    navigator.serviceWorker = { register: vi.fn() };
    vi.stubEnv('PROD', false);
    expect(registerServiceWorker()).toBe(false);
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('serviceWorker 非対応の環境では何もしない', () => {
    vi.stubEnv('PROD', true);
    expect(registerServiceWorker()).toBe(false);
  });

  it('本番のブラウザでは相対パスで sw.js を登録する', () => {
    const register = vi.fn(() => Promise.resolve());
    navigator.serviceWorker = { register };
    vi.stubEnv('PROD', true);
    expect(registerServiceWorker()).toBe(true);
    // サブパス配信でも正しい位置を指すよう、絶対パスにしない
    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('登録に失敗してもアプリを止めない', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    navigator.serviceWorker = { register: vi.fn(() => Promise.reject(new Error('boom'))) };
    vi.stubEnv('PROD', true);
    expect(() => registerServiceWorker()).not.toThrow();
    await Promise.resolve();
    err.mockRestore();
  });
});

describe('新しい版の通知', () => {
  afterEach(() => { delete navigator.serviceWorker; });

  const makeReg = (waiting) => {
    const listeners = {};
    return {
      waiting,
      installing: null,
      update: vi.fn(() => Promise.resolve()),
      addEventListener: (type, fn) => { listeners[type] = fn; },
      listeners,
    };
  };

  it('使用中の版があり、新しい版が待機していれば知らせる', () => {
    navigator.serviceWorker = { controller: {} };
    const onReady = vi.fn();
    window.addEventListener(UPDATE_READY_EVENT, onReady);
    const waiting = { postMessage: vi.fn() };
    watchForUpdates(makeReg(waiting));
    window.removeEventListener(UPDATE_READY_EVENT, onReady);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].detail).toBe(waiting);
  });

  it('初回インストール(使用中の版なし)では知らせない', () => {
    navigator.serviceWorker = { controller: null };
    const onReady = vi.fn();
    window.addEventListener(UPDATE_READY_EVENT, onReady);
    watchForUpdates(makeReg({ postMessage: vi.fn() }));
    window.removeEventListener(UPDATE_READY_EVENT, onReady);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('アプリが前面に戻ったら新しい版を確認する', () => {
    navigator.serviceWorker = { controller: {} };
    const reg = makeReg(null);
    watchForUpdates(reg);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).toHaveBeenCalled();
  });

  it('「更新」で待機中の版に切り替えを依頼する', () => {
    navigator.serviceWorker = { addEventListener: vi.fn() };
    const waiting = { postMessage: vi.fn() };
    applyUpdate(waiting);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(navigator.serviceWorker.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });
});
