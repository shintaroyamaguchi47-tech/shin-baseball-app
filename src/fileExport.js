// CSV・JSONなどのテキストファイルを書き出す。
//
// <a download> によるダウンロードはiOSアプリ(WKWebView)では何も起きず、
// iPhoneのSafariでも保存先が分かりにくい。そこで環境ごとに方法を変える:
//  - iOSアプリ: 端末の一時領域に書き出し、共有シート(「ファイルに保存」・AirDrop・LINEなど)を出す
//  - スマホのブラウザ: Web Share API でファイルを共有シートに渡す(使えなければダウンロード)
//  - PCのブラウザ: 従来どおりダウンロード
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function isMobileBrowser() {
  const ua = navigator.userAgent || '';
  // iPadOS の Safari は Mac と同じUAを名乗るので、タッチ対応かどうかで見分ける
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const isCancel = (e) => e && (e.name === 'AbortError' || /cancel/i.test(String(e.message || e)));

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // すぐに破棄するとダウンロードが始まる前に消えるブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * テキストをファイルとして書き出す。ボタンを押した直後(同期処理の中)に呼ぶこと
 * (共有シートはユーザー操作の直後でないと開けない)。
 * @returns {Promise<'downloaded'|'shared'|'cancelled'>}
 */
export async function saveTextFile(filename, text, mimeType) {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true,
    });
    try {
      await Share.share({ title: filename, files: [uri] });
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
      throw e;
    }
  }

  const blob = new Blob([text], { type: mimeType });
  if (isMobileBrowser() && typeof navigator.share === 'function' && typeof File === 'function') {
    const file = new File([blob], filename, { type: mimeType });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (e) {
        if (isCancel(e)) return 'cancelled';
        // 共有に失敗したら通常のダウンロードで続ける
      }
    }
  }
  download(filename, blob);
  return 'downloaded';
}
