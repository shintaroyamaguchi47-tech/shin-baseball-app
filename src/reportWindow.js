// 印刷用レポート(試合分析・スコアブック・相手投手)を表示するウィンドウを用意する。
//
// PCのブラウザでは従来どおり別ウィンドウに開いて印刷する。
// 次の環境では別ウィンドウが使えないため、アプリ内に全画面で重ねて表示する:
//  - iPhone/iPadのSafari・ホーム画面に追加したWeb版: 別タブが開かない・戻れないうえ、
//    window.print を呼んでも印刷画面が出ない。印刷の代わりにPDFファイルを作って
//    共有シートで渡す(src/reportPdf.js)
//  - iOSアプリ(Capacitor の WKWebView): window.open が null を返し、window.print も動かない
//  - ポップアップがブロックされたブラウザ
// iOSアプリでの印刷はネイティブの印刷画面(ios/App/App/ReportPrintPlugin.swift)で行い、
// そこからPDFとして保存・共有できる。
import { Capacitor, registerPlugin } from '@capacitor/core';
import { saveBlobFile } from './fileExport.js';

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

// iPhoneのSafari向け: 「PDFを作成」→ 作成後に「PDFを保存」で共有シートを出す。
// 共有シートはタップの直後でないと開けず、PDFの作成には数秒かかるので、2回のタップに分けている
function setUpPdfButton(button, w) {
  let file = null;
  let busy = false;
  button.textContent = '📄 PDFを作成';
  button.addEventListener('click', () => {
    const overlay = w.__reportOverlay;
    if (busy || !overlay || !overlay.html) return;
    if (file) {
      saveBlobFile(file.name, file, 'application/pdf').catch((e) => {
        console.error('PDFを保存できませんでした:', e);
        window.alert('PDFを保存できませんでした。もう一度お試しください。');
      });
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = '作成中…';
    import('./reportPdf.js')
      .then(({ buildReportPdf }) => buildReportPdf(overlay.html, {
        landscape: overlay.landscape,
        onProgress: (done, total) => { button.textContent = `作成中… ${done}/${total}`; },
      }))
      .then((blob) => {
        const name = `${(w.document.title || overlay.title || 'レポート').replace(/[\\/:*?"<>|]/g, '')}.pdf`;
        file = new File([blob], name, { type: 'application/pdf' });
        button.textContent = '📤 PDFを保存';
      })
      .catch((e) => {
        console.error('PDFを作成できませんでした:', e);
        window.alert('PDFを作成できませんでした。もう一度お試しください。');
        button.textContent = '📄 PDFを作成';
      })
      .finally(() => { busy = false; button.disabled = false; });
  });
}

function openOverlay(title, { pdf = false } = {}) {
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
  if (pdf) setUpPdfButton(printBtn, w);
  // スコアブックは印刷前に紙面を組み直す関数(__sbPrint)を持つ
  else printBtn.addEventListener('click', () => (w.__sbPrint || w.print).call(w));
  w.__reportOverlay = { close, title, pdf };
  return w;
}

function isIOSBrowser() {
  const ua = navigator.userAgent || '';
  // iPadOS の Safari は Mac と同じUAを名乗るので、タッチ対応かどうかで見分ける
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * レポート用のウィンドウを開く。ボタンを押した直後(同期処理の中)に呼ぶこと。
 * 別ウィンドウが使えない環境ではアプリ内の全画面表示を返すので、通常は null にならない。
 */
export function openReportWindow(title) {
  if (!isNative() && (isIOSBrowser() || isStandalone())) return openOverlay(title, { pdf: true });
  if (!isNative()) {
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
  overlay.html = html;
  overlay.landscape = landscape;
  if (isNative()) w.print = () => printNative(html, overlay.title, landscape);
  // iPhoneのSafariでは印刷画面が出ないので、自動印刷(開いた直後の w.print)は何もしない
  else if (overlay.pdf) w.print = () => {};
}

/** 表示中の画面をそのまま印刷する(分析ハブ)。iOSアプリでは window.print が動かないのでネイティブで印刷する */
export function printCurrentPage() {
  if (!isNative()) { window.print(); return; }
  ReportPrint.printWebView().catch((e) => {
    console.error('印刷画面を開けませんでした:', e);
    window.alert('印刷画面を開けませんでした。もう一度お試しください。');
  });
}
