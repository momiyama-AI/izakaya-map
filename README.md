# Izakaya Drink Price Map

居酒屋ドリンク価格マップのMVP実装プロジェクトです。
追加パッケージなしで動くように、初期構成はNode.js標準HTTPサーバーと静的Web画面で構成しています。

## VS Codeで開発する

VS Codeでこのフォルダ、または `izakaya-price-map.code-workspace` を開いてください。
ターミナルから起動する場合は以下です。

```powershell
.\scripts\dev.ps1
```

起動後:

- App: http://localhost:5173
- Health: http://localhost:5173/api/v1/health
- Areas: http://localhost:5173/api/v1/areas

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

## DB

店舗、エリア、ドリンク価格、イベントログはSQLiteに保存します。
初回起動時に `.local/izakaya-map.sqlite` が自動作成され、`src/data/seed-data.js` の初期データが投入されます。

明示的に初期化する場合:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\init-db.ps1
```

DBの保存先を変える場合:

```powershell
$env:DATABASE_PATH = "C:\path\to\izakaya-map.sqlite"
.\scripts\dev.ps1
```

DBファイルは `.gitignore` で除外しています。

主要テーブルには監査用の列があります。

- `created_at`: 作成日時
- `updated_at`: 更新日時
- `created_by`: 作成者
- `updated_by`: 更新者

既存の初期データは `system` 作成扱いです。
管理APIから登録する場合は `x-admin-user` ヘッダーを指定すると作成者/更新者に反映されます。

確認SQL:

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

## ローカルデプロイ確認

本番相当のポート `8080` でバックグラウンド起動します。

```powershell
.\scripts\deploy-local.ps1
```

起動後:

- App: http://localhost:8080
- Admin: http://localhost:8080/admin.html

停止:

```powershell
.\scripts\stop-local.ps1
```

## Smoke Test

```powershell
.\scripts\smoke-test.ps1 -BaseUrl http://localhost:5173
```

ローカルデプロイ確認後は以下でも実行できます。

```powershell
.\scripts\smoke-test.ps1 -BaseUrl http://localhost:8080
```

## API

代表的なAPI:

- `GET /api/v1/health`
- `GET /api/v1/config`
- `GET /api/v1/areas`
- `GET /api/v1/stores?area_id=AREA-SHINJUKU&drink_category=highball`
- `GET /api/v1/stores/{store_id}`
- `POST /api/v1/events`
- `GET /api/v1/admin/events`
- `POST /api/v1/admin/stores`
- `POST /api/v1/admin/drink-prices`

管理APIで登録した店舗・価格もSQLiteに保存されます。

開発用の管理トークン:

```text
dev-admin-token
```

例:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri http://localhost:8080/api/v1/admin/drink-prices `
  -Headers @{ "x-admin-token" = "dev-admin-token" } `
  -ContentType "application/json" `
  -Body '{"storeId":"STORE-SJK-001","category":"highball","drinkName":"角ハイボール","priceYen":280,"taxIncluded":true,"acquiredAt":"2026-05-25","sourceType":"store_menu","verificationStatus":"verified"}'
```

## OpenStreetMap store import

Use the Overpass API to add location-only store rows for Shinjuku and Nakano. The default target is 100 OSM rows per area. Drink prices are not inserted by this script because they need separate menu verification.

```powershell
.\scripts\node.cmd --% scripts/import-osm-stores.js
```

Optional:

```powershell
$env:OSM_IMPORT_TARGET_PER_AREA = "100"
$env:OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
.\scripts\node.cmd --% scripts/import-osm-stores.js
```

Store location data imported by this script is sourced from OpenStreetMap and Overpass API. Keep attribution visible in the app and review ODbL obligations before redistribution.

## Docker

Dockerが利用できる環境では、以下で本番相当の起動確認ができます。

```powershell
$env:GOOGLE_MAPS_API_KEY = "YOUR_API_KEY"
docker compose up --build
```

App:

```text
http://localhost:8080
```
