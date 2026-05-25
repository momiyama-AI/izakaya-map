# リリース環境

## 対象

MVPの初回リリース先はRender Web ServiceのDockerデプロイです。

- サービス名: `izakaya-price-map`
- ランタイム: Docker
- ヘルスチェック: `/api/v1/health`
- 公開アプリ: `/`
- 管理画面: `/admin.html`
- データベース: Render永続ディスク上のSQLite
- データベースパス: `/app/storage/izakaya-map.sqlite`

## 必須環境変数

RenderでBlueprintを作成するときに設定します。

| キー | 必須 | 内容 |
|---|---:|---|
| `GOOGLE_MAPS_API_KEY` | 必須 | Google Maps JavaScript APIキー。Renderの公開URL確定後、HTTPリファラー制限を設定してください。 |
| `GOOGLE_MAPS_MAP_ID` | 任意 | Google MapsのMap ID。未設定でも動作します。 |
| `ADMIN_TOKEN` | 必須 | Render Blueprintで自動生成できます。作成後はパスワード管理ツールなどで保管してください。 |
| `DATABASE_PATH` | 必須 | `render.yaml` で `/app/storage/izakaya-map.sqlite` を設定済みです。 |
| `NODE_ENV` | 必須 | `production` を設定済みです。 |
| `PORT` | 必須 | `8080` を設定済みです。 |

実際のAPIキーや管理トークンはコミットしないでください。

## Render初回デプロイ手順

1. `main` ブランチをGitHubへPushします。
2. Renderでリポジトリから新しいBlueprintを作成します。
3. ルート直下の `render.yaml` が検出されていることを確認します。
4. 入力を求められたら `GOOGLE_MAPS_API_KEY` を設定します。
5. 永続ディスクが有効になっていることを確認します。
   - 名前: `izakaya-data`
   - マウントパス: `/app/storage`
   - サイズ: `1GB`
6. デプロイを開始します。
7. `/api/v1/health` を開き、`status` が `ok` であることを確認します。
8. `/` を開き、地図が表示されることを確認します。
9. `/admin.html` を開き、生成された `ADMIN_TOKEN` でイベントログを確認します。

## リリースチェック

ローカル本番相当環境で確認します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl http://localhost:8080 -AdminToken dev-admin-token
```

本番環境で確認します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-check.ps1 -BaseUrl https://YOUR-SERVICE.onrender.com -AdminToken YOUR_ADMIN_TOKEN
```

## 運用メモ

- Renderで永続ディスクを使わない場合、ファイルシステムは再デプロイ時に消える可能性があります。
- SQLiteは `/app/storage` 配下に保存します。
- Renderの永続ディスクは単一サービスインスタンスに接続されるため、SQLite運用中はインスタンス数を1にしてください。
- 永続ディスク利用時はゼロダウンタイムデプロイにならないため、リリース時に短時間の停止が発生する可能性があります。
- MVPを超えてデータ量や同時利用が増える場合は、SQLiteからマネージドPostgreSQLへの移行を検討してください。
- `ADMIN_TOKEN` を共有または露出した場合は、速やかにローテーションしてください。
- Google Maps APIキーは、本番Renderドメインとローカル開発用URLに制限してください。
