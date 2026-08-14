// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getItem,
  setItem,
  initStorage,
  refreshUsage,
  getUsage,
  estimateBytes,
  isQuotaError,
  setStorageNotifier,
  STORAGE_KEYS,
  STORAGE_QUOTA_BYTES,
} from '../storage.js';

// 容量超過時にブラウザが投げる例外を模す
const quotaError = () => {
  const e = new Error('exceeded the quota');
  e.name = 'QuotaExceededError';
  e.code = 22;
  return e;
};

describe('storage アダプタ', () => {
  beforeEach(() => {
    localStorage.clear();
    refreshUsage();
    setStorageNotifier(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setStorageNotifier(null);
  });

  it('setItem/getItem が localStorage を介して往復できる', () => {
    expect(setItem('baseball_gameInfo_v2', '{"date":"2026-06-11"}')).toBe(true);
    expect(getItem('baseball_gameInfo_v2')).toBe('{"date":"2026-06-11"}');
    expect(localStorage.getItem('baseball_gameInfo_v2')).toBe('{"date":"2026-06-11"}');
  });

  it('Web実行時は initStorage が何もせず正常終了する', async () => {
    await expect(initStorage()).resolves.toBeUndefined();
  });

  it('App.jsx が使う保存キーがすべて STORAGE_KEYS に登録されている', () => {
    // キーの追加漏れがあるとネイティブ復元の対象から外れるため、ソースを走査して検証する
    const src = fs.readFileSync(path.resolve(__dirname, '../App.jsx'), 'utf8');
    const used = new Set([...src.matchAll(/['"](baseball_[a-zA-Z]+_v\d+)['"]/g)].map((m) => m[1]));
    for (const key of used) {
      expect(STORAGE_KEYS, `${key} が STORAGE_KEYS に未登録`).toContain(key);
    }
    expect(used.size).toBeGreaterThan(0);
  });

  describe('容量超過時', () => {
    it('setItem は例外を投げず false を返す(1球入力で画面が落ちない)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw quotaError();
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      let result;
      expect(() => {
        result = setItem('baseball_pitches_v2', '[]');
      }).not.toThrow();
      expect(result).toBe(false);
    });

    it('通知ハンドラに quota として伝わる', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw quotaError();
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen = [];
      setStorageNotifier((info) => seen.push(info));
      setItem('baseball_pitches_v2', '[]');
      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe('quota');
      expect(seen[0].key).toBe('baseball_pitches_v2');
    });

    it('容量超過以外の失敗は error として区別される', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen = [];
      setStorageNotifier((info) => seen.push(info));
      expect(setItem('baseball_pitches_v2', '[]')).toBe(false);
      expect(seen[0].type).toBe('error');
    });

    it('isQuotaError がブラウザごとの容量超過を判定する', () => {
      expect(isQuotaError(quotaError())).toBe(true);
      expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
      expect(isQuotaError({ code: 1014 })).toBe(true);
      expect(isQuotaError(new Error('boom'))).toBe(false);
      expect(isQuotaError(null)).toBe(false);
    });
  });

  describe('使用量の集計', () => {
    it('書き込んだ分だけ増え、書き込みごとに全キーを読み直さない', () => {
      setItem('baseball_gameInfo_v2', 'x'.repeat(100));
      const afterFirst = estimateBytes();
      expect(afterFirst).toBeGreaterThanOrEqual(200);

      // 同じキーの上書きは差分で置き換わる(足し込みではない)
      setItem('baseball_gameInfo_v2', 'x'.repeat(100));
      expect(estimateBytes()).toBe(afterFirst);

      const getSpy = vi.spyOn(Storage.prototype, 'getItem');
      setItem('baseball_pitches_v2', 'y'.repeat(50));
      expect(getSpy).not.toHaveBeenCalled();
      expect(estimateBytes()).toBeGreaterThan(afterFirst);
    });

    it('上限の8割を超えると near-limit を通知する', () => {
      const seen = [];
      setStorageNotifier((info) => seen.push(info));
      // 1文字=2バイト換算なので、上限の85%に届く長さを書く
      const chars = Math.ceil((STORAGE_QUOTA_BYTES * 0.85) / 2);
      setItem('baseball_savedGames_v2', 'x'.repeat(chars));
      expect(seen.some((s) => s.type === 'near-limit')).toBe(true);
      expect(getUsage().nearLimit).toBe(true);
    });

    it('余裕があるうちは通知しない', () => {
      const seen = [];
      setStorageNotifier((info) => seen.push(info));
      setItem('baseball_savedGames_v2', 'x'.repeat(1000));
      expect(seen).toHaveLength(0);
      expect(getUsage().nearLimit).toBe(false);
    });

    it('refreshUsage は削除後の実測値に戻す', () => {
      setItem('baseball_savedGames_v2', 'x'.repeat(1000));
      expect(estimateBytes()).toBeGreaterThan(2000);
      localStorage.removeItem('baseball_savedGames_v2');
      expect(refreshUsage().bytes).toBeLessThan(200);
    });
  });

  it('getItem は読み出しに失敗しても null を返す', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getItem('baseball_pitches_v2')).toBe(null);
  });
});
