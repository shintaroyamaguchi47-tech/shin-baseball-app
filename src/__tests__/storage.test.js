// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getItem, setItem, initStorage, STORAGE_KEYS } from '../storage.js';

describe('storage アダプタ', () => {
  it('setItem/getItem が localStorage を介して往復できる', () => {
    setItem('baseball_gameInfo_v2', '{"date":"2026-06-11"}');
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
});
