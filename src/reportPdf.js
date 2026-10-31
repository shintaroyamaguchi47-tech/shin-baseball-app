// 印刷用レポートのHTMLから、PDFファイルを直接作る。
//
// iPhone/iPadのSafari(ホーム画面版を含む)では window.print が効かず印刷画面が出ないため、
// 印刷を経由せずにPDFを作って共有シート・ダウンロードで渡す(src/reportWindow.js から使う)。
//
// 作り方: 画面外のiframeに紙の幅でレポートを組版し、1ページ分ずつ画像にしてPDFへ貼る。
// ページの切れ目は、表の行やカードの途中で切れないよう要素の下端に合わせる。
// 文字は画像になる(選択・検索はできない)が、見た目は画面のレポートと同じになる。

const PAGE = {
  portrait: { orientation: 'portrait', w: 210, h: 297, margin: 8, frameWidth: 760 },
  // スコアブックは A4横の固定枠(287mm)で組まれている
  landscape: { orientation: 'landscape', w: 297, h: 210, margin: 5, frameWidth: 1110 },
};
// 画面の1pxを何倍の解像度で描くか。上げると鮮明になるが、iPhoneはキャンバスの面積に上限がある
const SCALE = 2;
const FRAME_HEIGHT = 1200;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function loadFrame(html, width) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-${width + 200}px;top:0;width:${width}px;height:${FRAME_HEIGHT}px;border:0;pointer-events:none;`;
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const style = doc.createElement('style');
  // 操作ボタン欄は紙面に入れない。背景も紙と同じ白にする
  style.textContent = '.no-print{display:none !important;}html,body{background:#fff !important;}';
  doc.head.appendChild(style);
  // スコアブックは読み込み後・フォント読み込み後に紙面を組み直すので、それを待つ
  await wait(300);
  if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
  await wait(500);
  return frame;
}

// 1ページに入る高さ(px)ごとに区切る。強制改ページ(.page-break)と要素の下端を優先する
function sliceUnit(unit, top, height, pageHeight) {
  const win = unit.ownerDocument.defaultView;
  const end = top + height;
  if (height <= pageHeight * 1.02) return [[top, end]];
  const bottoms = [];
  const forced = [];
  for (const el of unit.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) continue;
    if (el.classList.contains('page-break')) forced.push(r.top + win.scrollY);
    bottoms.push(r.bottom + win.scrollY);
  }
  bottoms.sort((a, b) => a - b);
  const slices = [];
  let start = top;
  while (end - start > 1) {
    const limit = start + pageHeight;
    let cut;
    const f = forced.find(y => y > start + 10 && y <= limit);
    if (f !== undefined) cut = f;
    else if (limit >= end) cut = end;
    else {
      // ページの4割より上で切ると余白だらけになるので、それより下の切れ目だけ使う
      const ok = bottoms.filter(b => b > start + pageHeight * 0.4 && b <= limit);
      cut = ok.length ? ok[ok.length - 1] : limit;
    }
    slices.push([start, cut]);
    start = cut;
  }
  return slices;
}

/**
 * レポートのHTMLからPDFを作る。
 * @param {string} html 印刷用レポートのHTML(pdfReport.js / scorebookReport.js / pitcherScoutPdf.js が作るもの)
 * @param {{ landscape?: boolean, onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<Blob>}
 */
export async function buildReportPdf(html, { landscape = false, onProgress } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const page = landscape ? PAGE.landscape : PAGE.portrait;
  const frame = await loadFrame(html, page.frameWidth);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const contentW = page.w - page.margin * 2;
    const contentH = page.h - page.margin * 2;

    // 紙面の単位: スコアブックは1シート=1ページ、相手投手は1投手=1セクション、それ以外は本文全体
    let units = [...doc.querySelectorAll('.sb-sheet')];
    if (!units.length) units = [...doc.querySelectorAll('section.page')];
    if (!units.length) units = [doc.body];

    const jobs = [];
    for (const unit of units) {
      const r = unit.getBoundingClientRect();
      const top = r.top + win.scrollY;
      const left = r.left + win.scrollX;
      // 幅いっぱいに貼ったときの mm/px。1ページに収まる単位は、高さもはみ出さないよう縮める
      let mmPerPx = contentW / r.width;
      if (r.height * mmPerPx <= contentH * 1.02) mmPerPx = Math.min(mmPerPx, contentH / r.height);
      const pageHeight = contentH / mmPerPx;
      const slices = sliceUnit(unit, top, r.height, pageHeight);
      for (const [y0, y1] of slices) {
        jobs.push({ unit, left, width: r.width, y0, y1, mmPerPx, whole: slices.length === 1 && unit !== doc.body });
      }
    }

    const pdf = new jsPDF({ orientation: page.orientation, unit: 'mm', format: 'a4' });
    for (let i = 0; i < jobs.length; i++) {
      const { unit, left, width, y0, y1, mmPerPx, whole } = jobs[i];
      if (onProgress) onProgress(i, jobs.length);
      const options = {
        scale: SCALE, backgroundColor: '#ffffff', logging: false,
        windowWidth: page.frameWidth, windowHeight: FRAME_HEIGHT, scrollX: 0, scrollY: 0,
      };
      // 1ページに収まる単位は要素そのものを描く(切り取り位置を渡すと、縮小表示の紙面で左端がずれる)
      const canvas = await html2canvas(unit, whole ? options : { ...options, x: left, y: y0, width, height: y1 - y0 });
      if (i > 0) pdf.addPage('a4', page.orientation);
      const w = width * mmPerPx;
      const h = (y1 - y0) * mmPerPx;
      // 横に余る(縦に収めるため縮めた)ときは中央に寄せる
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', page.margin + (contentW - w) / 2, page.margin, w, h);
      canvas.width = canvas.height = 0; // iPhoneのキャンバス用メモリをすぐ返す
    }
    if (onProgress) onProgress(jobs.length, jobs.length);
    return pdf.output('blob');
  } finally {
    frame.remove();
  }
}
