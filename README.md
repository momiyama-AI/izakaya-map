# 居酒屋ドリンク価格マップ

居酒屋のドリンク価格を地図上で比較できるMVPアプリです。
現在地周辺やエリア検索から店舗を探し、ハイボール・ビールなどの価格をピンと一覧で確認できます。

初期構成は追加パッケージなしで動くように、Node.js標準HTTPサーバー、静的Web画面、SQLite/Tursoで構成しています。

## 主な機能

- Google Maps上で店舗とドリンク価格を表示
- 現在地を取得して近隣店舗を表示
- エリア、ドリンク種別、価格帯、認証状態で絞り込み
- 店舗詳細で価格、取得元、食べログURLを表示
- 右側の検索結果クリックで対象店舗へ地図移動
- 価格ピンのクリックで地図を拡大
- 管理画面から店舗登録、店舗編集、価格登録、イベント確認
- SQLiteへの店舗、価格、イベントログ保存

## 画面URL

ローカル本番相当起動時のURLです。

- アプリ: `http://localhost:8080`
- 管理画面: `http://localhost:8080/admin.html`
- ヘルスチェック: `http://localhost:8080/api/v1/health`

## VS Codeで開発する

VS Codeでこのフォルダ、または `izakaya-price-map.code-workspace` を開いてください。
Node.jsは24以上を利用します。

開発サーバーを起動します。

```powershell
.\scripts\dev.ps1
```

起動後のURLです。

- アプリ: `http://localhost:5173`
- ヘルスチェック: `http://localhost:5173/api/v1/health`
- エリアAPI: `http://localhost:5173/api/v1/areas`

Google Mapsを表示する場合は、起動前にAPIキーを環境変数へ設定してください。
未設定の場合は、開発用の簡易マップを表示します。

```powershell
$env:GOOGLE_MAPS_API_KEY = "YOUR_API_KEY"
.\scripts\dev.ps1
```

VS Codeのタスクからも実行できます。

- `DB: initialize SQLite`
- `Dev: start app`
- `Deploy: local production`
- `Test: smoke`
- `Deploy: stop local`

## データベース

店舗、エリア、ドリンク価格、イベントログはDBに保存します。
ローカル開発ではSQLiteファイル、本番RenderではTurso無料DBを使います。

### ローカルSQLite

初回起動時に `.local/izakaya-map.sqlite` が自動作成され、`src/data/seed-data.js` の初期データが投入されます。

明示的に初期化する場合は以下を実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\init-db.ps1
```

DBの保存先を変える場合は、`DATABASE_PATH` を指定してください。

```powershell
$env:DATABASE_PATH = "C:\path\to\izakaya-map.sqlite"
.\scripts\dev.ps1
```

DBファイルは `.gitignore` で除外しています。

### Turso

`TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を設定すると、SQLiteファイルではなくTursoへ接続します。

```powershell
$env:TURSO_DATABASE_URL = "libsql://YOUR_DATABASE.turso.io"
$env:TURSO_AUTH_TOKEN = "YOUR_DATABASE_TOKEN"
.\scripts\dev.ps1
```

本番環境でTurso接続を必須にする場合は `REQUIRE_TURSO=true` を設定してください。

主要テーブルには監査用の列があります。

- `created_at`: 作成日時
- `updated_at`: 更新日時
- `created_by`: 作成者
- `updated_by`: 更新者

既存の初期データは `system` 作成扱いです。
管理APIから登録する場合は、`x-admin-user` ヘッダーを指定すると作成者と更新者に反映されます。

確認SQLの例です。

```sql
SELECT
  id,
  name,
  tabelog_url,
  created_at,
  updated_at,
  created_by,
  updated_by
FROM stores;
```

## ローカル本番相当起動

本番相当のポート `8080` でバックグラウンド起動します。

```powershell
.\scripts\deploy-local.ps1
```

停止する場合は以下を実行します。

```powershell
.\scripts\stop-local.ps1
```

## リリース環境

初回リリース先はRender Free Web ServiceとTurso無料DBを想定しています。
設定はリポジトリ直下の `render.yaml` で管理しています。

- サービス名: `izakaya-price-map`
- ランタイム: Docker
- Renderプラン: Free
- ヘルスチェック: `/api/v1/health`
- 公開アプリ: `/`
- 管理画面: `/admin.html`
- DB: Turso
- 必須環境変数: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

詳細な初回デプロイ手順は `deploy/RELEASE_ENVIRONMENT.md` を参照してください。

リリース前チェックの例です。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl http://localhost:8080 -AdminToken dev-admin-token
```

## スモークテスト

開発サーバー向けです。

```powershell
.\scripts\smoke-test.ps1 -BaseUrl http://localhost:5173
```

ローカル本番相当起動後は以下でも実行できます。

```powershell
.\scripts\smoke-test.ps1 -BaseUrl http://localhost:8080
```

## API

代表的なAPIです。

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/areas`
- `GET /api/v1/stores?area_id=AREA-SHINJUKU&drink_category=highball`
- `GET /api/v1/stores/{store_id}`
- `POST /api/v1/events`
- `GET /api/v1/admin/events`
- `POST /api/v1/admin/stores`
- `PUT /api/v1/admin/stores/{store_id}`
- `POST /api/v1/admin/drink-prices`

管理APIで登録した店舗と価格もDBに保存されます。
ローカル環境ではSQLite、本番環境ではTursoに保存されます。

開発用の管理トークンです。

```text
dev-admin-token
```

価格登録APIの例です。

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri http://localhost:8080/api/v1/admin/drink-prices `
  -Headers @{ "x-admin-token" = "dev-admin-token" } `
  -ContentType "application/json" `
  -Body '{"storeId":"STORE-SJK-001","category":"highball","drinkName":"角ハイボール","priceYen":280,"taxIncluded":true,"acquiredAt":"2026-05-25","sourceType":"store_menu","verificationStatus":"verified"}'
```

## OpenStreetMap店舗取り込み

Overpass APIを使って、新宿と中野の店舗位置データを追加できます。
標準では各エリア100件ずつ取り込みます。
メニュー価格は別途確認が必要なため、このスクリプトでは登録しません。

```powershell
.\scripts\node.cmd --% scripts/import-osm-stores.js
```

件数やOverpass APIの接続先を変える場合は、環境変数を指定してください。

```powershell
$env:OSM_IMPORT_TARGET_PER_AREA = "100"
$env:OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
.\scripts\node.cmd --% scripts/import-osm-stores.js
```

このスクリプトで取り込む店舗位置データはOpenStreetMapおよびOverpass APIを出典とします。
アプリ上の帰属表示を維持し、再配布前にODbLの条件を確認してください。

## Docker

Dockerが利用できる環境では、以下で本番相当の起動確認ができます。

```powershell
$env:GOOGLE_MAPS_API_KEY = "YOUR_API_KEY"
docker compose up --build
```

起動後のURLです。

```text
http://localhost:8080
```

## 秘密情報の扱い

Google Maps APIキー、管理トークン、Tursoトークン、Renderのシークレット値はリポジトリにコミットしません。
ローカルでは環境変数、RenderではEnvironment Variablesに設定してください。
