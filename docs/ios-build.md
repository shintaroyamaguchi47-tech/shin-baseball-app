# iOSアプリのビルド手順(Mac作業)

このリポジトリはCapacitorでiOSアプリ化済みです。Web資産(`dist/`)をネイティブアプリ(`ios/`)に同梱してビルドします。
Capacitor 8はSwift Package Manager方式なので**CocoaPodsのインストールは不要**です。

## 必要なもの

- macOS + **Xcode**(App Storeから無料。初回起動でコマンドラインツールも入れる)
- **Node.js 22以上**
- 実機テスト・App Store配布には **Apple Developer Program**(年間$99)。
  実機での動作確認だけなら無料のApple IDでも可能(7日間有効の署名)

## 手順

```bash
# 1. リポジトリを取得して依存をインストール
git clone https://github.com/shintaroyamaguchi47-tech/shin-baseball-app.git
cd shin-baseball-app
npm install

# 2. Webアプリをビルドして iOS プロジェクトに同期
npm run ios:sync

# 3. Xcodeでプロジェクトを開く
npx cap open ios
```

### Xcode側の作業

1. 左ペインで **App** プロジェクト → TARGETS **App** → **Signing & Capabilities** を開く
2. **Team** に自分のApple IDチームを選択(未登録なら Xcode → Settings → Accounts で追加)
3. 上部のデバイス選択でシミュレータまたはUSB接続したiPhoneを選び、**▶(Run)**

実機の場合、初回はiPhone側で 設定 → 一般 → VPNとデバイス管理 から開発者を信頼する必要があります。

## コードを変更したとき

Web側(`src/`)を変更したら、再度同期してからXcodeでビルドし直します:

```bash
npm run ios:sync
```

## App Store提出の概要

1. Apple Developer Programに登録(https://developer.apple.com/jp/programs/)
2. App Store Connect(https://appstoreconnect.apple.com/)でアプリを作成
   - バンドルID: `com.shinbaseball.pitchscore`(変更する場合は `capacitor.config.json` の `appId` と Xcode の Bundle Identifier を揃える)
3. Xcodeで Product → Archive → Distribute App でアップロード
4. App Store Connectでスクリーンショット・説明文・プライバシー情報を入力して審査提出
   - プライバシー: 本アプリはデータを端末内にのみ保存し、外部送信しない旨を申告

## データ保存の仕組み

- Web版: localStorage に自動保存
- iOSアプリ版: localStorage に加えて **ネイティブストレージ(UserDefaults)へ二重保存**。
  OSがWebViewのlocalStorageを破棄しても、次回起動時に自動復元されます(`src/storage.js`)
