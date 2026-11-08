import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './pdfReport.js';
import './scorebookReport.js';
import { initStorage } from './storage.js';
import { registerServiceWorker } from './registerServiceWorker.js';
import App from './App.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

// ネイティブ(iOS)実行時はlocalStorageをネイティブストレージから復元してから描画する
initStorage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(<><App /><UpdateBanner /></>);
  // 描画を待たせないよう、Service Worker の登録は後回しにする
  registerServiceWorker();
});
