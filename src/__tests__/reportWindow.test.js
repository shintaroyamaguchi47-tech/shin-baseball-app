// @vitest-environment jsdom
// iPhoneのSafariでは別タブ・印刷画面が使えないため、アプリ内に表示して「PDFを作成」ボタンを出す。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openReportWindow, writeReport } from '../reportWindow.js';

const setUserAgent = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HTML = '<!DOCTYPE html><html><head><title>帯金_相手投手レポート</title></head><body><div class="no-print"><button onclick="window.print()">印刷</button></div><p>本文</p></body></html>';

describe('レポートの開き方', () => {
  const origUA = window.navigator.userAgent;
  afterEach(() => {
    setUserAgent(origUA);
    document.querySelectorAll('[data-report-overlay]').forEach(el => el.remove());
    vi.restoreAllMocks();
  });

  it('iPhoneのSafariでは別タブを開かず、アプリ内表示に「PDFを作成」を出す', () => {
    setUserAgent(IPHONE);
    const open = vi.spyOn(window, 'open');
    const w = openReportWindow('帯金_相手投手レポート');
    writeReport(w, HTML);
    expect(open).not.toHaveBeenCalled();
    const overlay = document.querySelector('[data-report-overlay]');
    expect(overlay.textContent).toContain('PDFを作成');
    expect(overlay.querySelector('iframe').contentDocument.body.textContent).toContain('本文');
    // 開いた直後の自動印刷は何もしない(iPhoneでは印刷画面が出ないため)
    expect(() => w.print()).not.toThrow();
    w.close();
    expect(document.querySelector('[data-report-overlay]')).toBeNull();
  });

  it('PCでは従来どおり別ウィンドウに書き込む', () => {
    let written = '';
    vi.spyOn(window, 'open').mockReturnValue({ document: { write: s => { written += s; }, close: () => {} }, print: () => {} });
    const w = openReportWindow('t');
    writeReport(w, HTML);
    expect(written).toContain('本文');
    expect(document.querySelector('[data-report-overlay]')).toBeNull();
  });
});
