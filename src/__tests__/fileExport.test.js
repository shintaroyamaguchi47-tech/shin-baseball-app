// @vitest-environment jsdom
// CSV・JSONの書き出し。iPhoneでは <a download> が効かないため共有シートを使い、PCではダウンロードする。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveTextFile } from '../fileExport.js';

const setUserAgent = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('saveTextFile', () => {
  const origUA = window.navigator.userAgent;
  afterEach(() => {
    setUserAgent(origUA);
    delete window.navigator.share;
    delete window.navigator.canShare;
    vi.restoreAllMocks();
  });

  const stubDownload = () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.download); });
    return clicked;
  };

  it('PCではファイル名付きでダウンロードする', async () => {
    setUserAgent(PC);
    const clicked = stubDownload();
    window.navigator.share = vi.fn();
    expect(await saveTextFile('試合データ_2026-10-31.csv', 'a,b', 'text/csv')).toBe('downloaded');
    expect(clicked).toEqual(['試合データ_2026-10-31.csv']);
    expect(window.navigator.share).not.toHaveBeenCalled();
  });

  it('iPhoneのブラウザでは共有シートにファイルを渡す', async () => {
    setUserAgent(IPHONE);
    const clicked = stubDownload();
    window.navigator.canShare = vi.fn(() => true);
    window.navigator.share = vi.fn(() => Promise.resolve());
    expect(await saveTextFile('配球データ.json', '{}', 'application/json')).toBe('shared');
    const { files } = window.navigator.share.mock.calls[0][0];
    expect(files[0].name).toBe('配球データ.json');
    expect(clicked).toEqual([]);
  });

  it('共有シートを閉じたときはダウンロードしない', async () => {
    setUserAgent(IPHONE);
    const clicked = stubDownload();
    window.navigator.share = vi.fn(() => Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })));
    expect(await saveTextFile('a.csv', 'a', 'text/csv')).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('ファイルの共有に対応していなければダウンロードする', async () => {
    setUserAgent(IPHONE);
    const clicked = stubDownload();
    window.navigator.canShare = vi.fn(() => false);
    window.navigator.share = vi.fn();
    expect(await saveTextFile('a.csv', 'a', 'text/csv')).toBe('downloaded');
    expect(clicked).toEqual(['a.csv']);
  });
});
