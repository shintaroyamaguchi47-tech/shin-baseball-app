import React, { useEffect, useState } from 'react';
import { UPDATE_READY_EVENT, applyUpdate } from '../registerServiceWorker.js';

// 新しい版が公開されたときに画面下に出す案内。
// 記録は変更のたびに保存されているので、更新(再読み込み)しても消えない。
export default function UpdateBanner() {
  const [waiting, setWaiting] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onReady = (e) => { setWaiting(e.detail || true); setHidden(false); };
    window.addEventListener(UPDATE_READY_EVENT, onReady);
    return () => window.removeEventListener(UPDATE_READY_EVENT, onReady);
  }, []);

  if (!waiting || hidden) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-[700] mx-auto max-w-md flex items-center gap-2 rounded-2xl bg-slate-800 text-white px-4 py-3 shadow-2xl" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      <span className="flex-1 text-sm font-bold">🆕 新しい版があります</span>
      <button onClick={() => setHidden(true)} className="text-xs font-bold text-slate-300 px-2 py-1.5">あとで</button>
      <button onClick={() => applyUpdate(waiting === true ? null : waiting)} className="text-sm font-black bg-blue-500 rounded-xl px-4 py-1.5 active:scale-95">更新</button>
    </div>
  );
}
