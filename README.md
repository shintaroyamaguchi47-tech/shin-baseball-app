# ⚾ 配球スコア・分析アプリ Pro

野球の配球記録・分析アプリ。投球コース(7×7)・球種・結果を記録し、ヒートマップ、スプレーチャート、セイバーメトリクス指標(CSW%、チェイス%など)によるリアルタイム分析、PDF試合レポート出力ができます。

## 開発

```bash
npm install      # 依存パッケージのインストール
npm run dev      # 開発サーバー起動 (http://localhost:5173)
npm test         # テスト実行
npm run build    # 本番ビルド (dist/ に出力)
npm run preview  # ビルド結果のプレビュー
```

## 構成

- **Vite + React 18 + Tailwind CSS v3** — すべてローカルにバンドルされ、オフラインで動作します(CDN依存なし)
- `src/App.jsx` — アプリ本体(画面・状態管理)
- `src/analystInsights.js` — アナリスト指標の算出ロジック
- `src/pdfReport.js` — PDF(印刷用HTML)レポート生成
- `src/components/` — SprayChart(スプレーチャート)、AnalystReport(アナリスト分析画面)
- データは localStorage(`baseball_*_v2` キー)に自動保存されます

## iOSアプリ

Capacitorで iOS アプリ化済みです(`ios/` ディレクトリ)。Macでのビルド手順は [docs/ios-build.md](docs/ios-build.md) を参照してください。

```bash
npm run ios:sync   # Webをビルドして iOS プロジェクトへ同期
npx cap open ios   # Xcodeで開く(Mac)
```

iOSアプリ版では localStorage に加えてネイティブストレージ(UserDefaults)へ二重保存し、起動時に自動復元します(`src/storage.js`)。

## デプロイ

`main` ブランチへの push で GitHub Actions がテスト・ビルドを実行し、GitHub Pages へ自動デプロイします(`.github/workflows/deploy.yml`)。
