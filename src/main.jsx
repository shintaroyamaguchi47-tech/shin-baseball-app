import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './pdfReport.js';
import './scorebookReport.js';
import { initStorage } from './storage.js';
import App from './App.jsx';

// ネイティブ(iOS)実行時はlocalStorageをネイティブストレージから復元してから描画する
initStorage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
});
