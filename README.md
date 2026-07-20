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

## フェーズ1: 累計分析基盤

ヘッダーの「分析ハブ」から、保存済みの複数試合を横断して利用できます。

- 自チーム分析: 期間・試合種別・相手・選手で絞り込み、得失点、イニング別得失点、OBP、SLG、OPS、K%、BB%、被打率、WHIP目安、初球ストライク率、失策を表示
- 選手カルテ: 個人の打撃・投球累計、試合別記録、育成メモを端末内に保存
- 対戦相手分析: チームと選手を自チームとは分離し、同一相手との複数試合を累計したスカウティング表示
- 正規化ビュー: `teams`, `players`, `games`, `gameRosters`, `plateAppearances`, `pitches`, `battingEvents`, `pitchingEvents`, `fieldingEvents`, `baserunningEvents` を既存の試合スナップショットから再構築

### データ移行方針

既存の `baseball_*_v2` データは変更・削除しません。分析画面を開くたびに保存済み試合の生データから正規化ビューと累計値を再計算します。そのため、従来版からの手動移行は不要で、記録を修正した場合も次の表示で集計に反映されます。選手メモのみ新しい `baseball_playerNotes_v3` に保存されます。

「自チーム」の判定は分析対象のチーム選択で行えます。将来サーバーDBへ移す場合は `src/analyticsData.js` の正規化結果をそのままテーブル移行の入力として利用できます。

## iOSアプリ

Capacitorで iOS アプリ化済みです(`ios/` ディレクトリ)。Macでのビルド手順は [docs/ios-build.md](docs/ios-build.md) を参照してください。

```bash
npm run ios:sync   # Webをビルドして iOS プロジェクトへ同期
npx cap open ios   # Xcodeで開く(Mac)
```

iOSアプリ版では localStorage に加えてネイティブストレージ(UserDefaults)へ二重保存し、起動時に自動復元します(`src/storage.js`)。

## デプロイ

`main` ブランチへの push で GitHub Actions がテスト・ビルドを実行し、GitHub Pages へ自動デプロイします(`.github/workflows/deploy.yml`)。
