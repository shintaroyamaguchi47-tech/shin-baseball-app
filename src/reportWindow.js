// 印刷用レポート(試合分析・スコアブック・相手投手)を表示するウィンドウを用意する。
//
// PCのブラウザでは従来どおり別ウィンドウに開いて印刷する。
// 次の環境では別ウィンドウが開けない(または開いても戻れない)ため、アプリ内に全画面で重ねて表示する:
//  - iOSアプリ(Capacitor の WKWebView): window.open が null を返し、window.print も動かない
//  - ホーム画面に追加したWeb版: 別ウィンドウから元の画面へ戻れない
//  - ポップアップがブロックされたブラウザ
// iOSアプリでの印刷はネイティブの印刷画面(ios/App/App/ReportPrintPlugin.swift)で行い、
// そこからPDFとして保存・共有できる。
import { Capacitor, registerPlugin } from '@capacitor/core';

const ReportPrint = registerPlugin('ReportPrint');

const isNative = () => Capacitor.isNativePlatform();

function isStandalone() {
  try {
    return window.navigator.standalone === true
      || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  } catch (e) {
    return false;
  }
}

function printNative(html, name, landscape) {
  ReportPrint.printHtml({ html, name, landscape }).catch((e) => {
    console.error('印刷画面を開けませんでした:', e);
    window.alert('印刷画面を開けませんでした。もう一度お試しください。');
  });
}

function overlayButton(label, primary) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:bold;white-space:nowrap;'
    + (primary ? 'background:#fff;color:#0f172a;' : 'background:rgba(255,255,255,.15);color:#fff;');
  return b;
}

function openOverlay(title) {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-report-overlay', '');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:#f1f5f9;';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;padding-top:max(8px, env(safe-area-inset-top));background:#0f172a;color:#fff;flex-shrink:0;';
  const label = document.createElement('div');
  label.textContent = title || 'レポート';
  label.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const printBtn = overlayButton('🖨️ 印刷 / PDF保存', true);
  const closeBtn = overlayButton('✕ 閉じる', false);
  bar.append(label, printBtn, closeBtn);
  const iframe = document.createElement('iframe');
  iframe.title = title || 'レポート';
  iframe.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';
  overlay.append(bar, iframe);
  document.body.appendChild(overlay);

  const w = iframe.contentWindow;
  const close = () => overlay.remove();
  closeBtn.addEventListener('click', close);
  // スコアブックは印刷前に紙面を組み直す関数(__sbPrint)を持つ
  printBtn.addEventListener('click', () => (w.__sbPrint || w.print).call(w));
  w.__reportOverlay = { close, title };
  return w;
}

/**
 * レポート用のウィンドウを開く。ボタンを押した直後(同期処理の中)に呼ぶこと。
 * 別ウィンドウが使えない環境ではアプリ内の全画面表示を返すので、通常は null にならない。
 */
export function openReportWindow(title) {
  if (!isNative() && !isStandalone()) {
    const w = window.open('', '_blank');
    if (w) return w;
  }
  return openOverlay(title);
}

/**
 * openReportWindow で開いたウィンドウにレポートを書き込む。
 * アプリ内表示のときは、レポート内の「印刷」「閉じる」ボタンもアプリ内で動くように差し替える。
 */
export function writeReport(w, html, { landscape = false } = {}) {
  w.document.write(html);
  w.document.close();
  const overlay = w.__reportOverlay;
  if (!overlay) return;
  // レポート自身の操作ボタン欄(.no-print)は上部バーと重なるので隠す。ボタンは上部バーに同じものがある
  const style = w.document.createElement('style');
  style.textContent = '.no-print{display:none !important;}';
  w.document.head.appendChild(style);
  w.close = overlay.close;
  if (isNative()) w.print = () => printNative(html, overlay.title, landscape);
}

/** 表示中の画面をそのまま印刷する(分析ハブ)。iOSアプリでは window.print が動かないのでネイティブで印刷する */
export function printCurrentPage() {
  if (!isNative()) { window.print(); return; }
  ReportPrint.printWebView().catch((e) => {
    console.error('印刷画面を開けませんでした:', e);
    window.alert('印刷画面を開けませんでした。もう一度お試しください。');
  });
}
