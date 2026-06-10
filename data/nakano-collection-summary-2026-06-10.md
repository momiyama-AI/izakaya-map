# 中野区 居酒屋ドリンク価格 収集メモ

収集日: 2026-06-10

## 目的

中野区、主に中野駅北口周辺の居酒屋について、アプリの価格マップへ投入できる候補データを出典つきで整理する。

## 収集方針

- 店舗基本情報は公式サイト、楽天ぐるなび、ホットペッパー、食べログを確認した。
- ドリンク単品価格は楽天ぐるなびのドリンクページを優先した。
- 代表価格は標準サイズを優先し、メガサイズ、瓶ビール、ノンアル、特殊サイズは原則除外した。
- 税込表記が明記されているものだけ `explicit_tax_included_on_*` とし、明記がないものは `not_explicit_on_drink_source` とした。
- 緯度経度は未取得。DB投入前に住所からジオコード確認が必要。

## 収集結果

- 店舗数: 11店舗
- 価格行数: 32行
- 対象カテゴリ: `highball`, `beer`, `lemon_sour`
- CSV: `data/nakano-izakaya-source-backed-prices-2026-06-10.csv`

## DB投入前チェック

- `latitude` / `longitude` をGoogle Geocodingまたは手動確認で補完する。
- `tax_status=not_explicit_on_drink_source` の価格は、画面では税込断定を避けるか、人手確認後に `tax_included` を確定する。
- `confidence=medium` の行は「価格帯の下限」または「各種価格」から代表値を採用しているため、管理画面上で要確認にする。
- 既存の本番Tursoへ投入する場合は、同名店舗の重複確認を先に行う。

## 2026-06-11 投入確認

- 住所はNominatim/OpenStreetMapで9店舗、NAVITIME掲載緯度経度で2店舗を確認した。
- ローカルSQLiteへ `scripts/import-nakano-source-prices.js` で投入済み。
- 投入結果: 11店舗、32価格行。
- ローカルAPI確認: `/api/v1/health` の店舗数が206件から217件へ増加。
- 本番Tursoはローカル環境に `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` が未設定のため未投入。

## 2026-06-11 本番反映方式

- Turso管理画面はログイン状態が切れていたため、ローカルから直接トークンを使う投入は行わない。
- 代替として、アプリ起動時に確認済み中野データを自動投入する idempotent import を追加した。
- 既存店舗・既存価格IDはスキップするため、Render再起動や再デプロイで価格が二重登録されない。
- 無効化が必要な場合は `SEED_CURATED_IMPORTS=false` を設定する。
