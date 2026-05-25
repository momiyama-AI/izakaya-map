# リリース環境

## 対象

MVPの初回リリース先はRender Free Web ServiceのDockerデプロイです。
DBはTurso無料DBを利用します。

- サービス名: `izakaya-price-map`
- ランタイム: Docker
- Renderプラン: Free
- ヘルスチェック: `/api/v1/health`
- 公開アプリ: `/`
- 管理画面: `/admin.html`
- データベース: Turso

## 必須環境変数

RenderでBlueprintを作成するときに設定します。

| キー | 必須 | 内容 |
|---|---:|---|
| `GOOGLE_MAPS_API_KEY` | 必須 | Google Maps JavaScript APIキー。Renderの公開URL確定後、HTTPリファラー制限を設定してください。 |
| `GOOGLE_MAPS_MAP_ID` | 任意 | Google MapsのMap ID。未設定でも動作します。 |
| `ADMIN_TOKEN` | 必須 | Render Blueprintで自動生成できます。作成後はパスワード管理ツールなどで保管してください。 |
| `TURSO_DATABASE_URL` | 必須 | TursoのデータベースURL。`libsql://...` または `https://...` を設定できます。 |
| `TURSO_AUTH_TOKEN` | 必須 | TursoのDB接続トークン。 |
| `REQUIRE_TURSO` | 必須 | `render.yaml` で `true` を設定済みです。Turso未設定のまま本番起動する事故を防ぎます。 |
| `NODE_ENV` | 必須 | `production` を設定済みです。 |
| `PORT` | 必須 | `8080` を設定済みです。 |

実際のAPIキー、管理トークン、Tursoトークンはコミットしないでください。

## Turso準備手順

1. Tursoで無料アカウントを作成します。
2. 新しいDBを作成します。
3. DB URLを取得します。
4. DB接続トークンを作成します。
5. RenderのBlueprint作成時に `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` へ設定します。

アプリ初回起動時に、Turso上へ必要テーブルと初期データを自動作成します。

## Render初回デプロイ手順

1. `main` ブランチをGitHubへPushします。
2. Renderでリポジトリから新しいBlueprintを作成します。
3. ルート直下の `render.yaml` が検出されていることを確認します。
4. 入力を求められたら `GOOGLE_MAPS_API_KEY` を設定します。
5. `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を設定します。
6. デプロイを開始します。
7. `/api/v1/health` を開き、`status` が `ok`、`database.provider` が `turso` であることを確認します。
8. `/` を開き、地図が表示されることを確認します。
9. `/admin.html` を開き、生成された `ADMIN_TOKEN` でイベントログを確認します。

## リリースチェック

ローカル本番相当環境で確認します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl http://localhost:8080 -AdminToken dev-admin-token
```

本番環境で確認します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl https://YOUR-SERVICE.onrender.com -AdminToken YOUR_ADMIN_TOKEN -ExpectedDatabaseProvider turso
```

## 運用メモ

- Render Free Web Serviceはファイルシステムが永続化されないため、本番データはTursoへ保存します。
- Render Free Web Serviceはアクセスが少ないとスリープする可能性があります。初回アクセス時に起動待ちが発生することがあります。
- MVPを超えてデータ量や同時利用が増える場合は、Turso有料枠またはマネージドPostgreSQLへの移行を検討してください。
- `ADMIN_TOKEN` を共有または露出した場合は、速やかにローテーションしてください。
- Google Maps APIキーは、本番Renderドメインとローカル開発用URLに制限してください。
