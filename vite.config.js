import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相対パス出力: GitHub Pages のサブパス配信や、将来の Capacitor 同梱に対応
  base: './',
});
