# Valostudy

VALORANTの録画をフレームに変換し、プレイヤー設定とコーチング指示を**識別URL**にまとめる、自宅サーバー向けWebアプリ。

ベージュ × オリーブのワークスペース。ブラウザから動画をアップロードし、サーバーでFFmpegを実行します。Codexはサーバーに組み込まず、ネットワークアクセスを許可した手元のCodexに識別URLを渡します。

## できること

1. MP4 / MKV / MOV / WebM / AVIをサーバーにアップロード。
2. **抽出前にランク、DPI、ゲーム内センシ、ビデオ設定を必須入力**。eDPIも計算。
3. 開始秒・区間・抽出間隔を設定して非同期でフレーム抽出（最大120秒、300枚）。
4. 渡したい画像を選び、1時間 / 24時間 / 7日の識別URLを発行。
5. URLに実際の入力値を埋め込んだプロンプトを掲載。HTMLはサーバーで生成するためJavaScriptなしで読めます。
6. Codexはそのプロンプトに従い、**Redditの議論を調べてから**画像を確認し、根拠付きでコーチング。

フレーム、プレイヤー設定、状況メモ、プロンプトをJSONマニフェストからも取得できます。URLの無効化、録画の削除、サーバー再起動後の履歴復元に対応。

## 構成

- Python 3.11+ / FastAPI / Uvicorn
- SQLite（セッション、設定、キュー状態、共有URL）
- FFmpeg / FFprobe（サーバー側のメディア処理）
- HTML / CSS / JavaScript ES modules（APIと連携するブラウザUI、フロントエンドのビルド不要）

現段階は単一オーナー・Linux・単一プロセス向けのMVPです。Dockerイメージ、Kubernetes、複数ユーザー、Codex自動実行はまだ含みません。Sitesの旧説明ページは変更していません。

## 起動

FFmpegとPython 3.11以降を準備してください。CachyOS / Archなら `sudo pacman -S python ffmpeg`。

```bash
git clone https://github.com/AlexanderGG-0520/valostudy.git
cd valostudy
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

以下はBashで実行します。ランダムトークンはターミナルに表示されます。ブラウザのログイン欄で使用してください。

```bash
export APP_TOKEN="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')"
printf '%s\n' "$APP_TOKEN"
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

`http://127.0.0.1:8000` を開きます。APP_TOKENは自分の秘密として保管してください。再起動時に同じ値を設定すれば12時間のログインセッションは維持され、変更すると既存ログインが無効になります。**APP_TOKENの変更は識別URLの失効ではありません**。URLはアプリ内で別途無効化できます。

`.env.example` は設定例です。アプリは `.env` を自動では読みません。シェルやサービスマネージャから環境変数を渡してください。fishでは `set -x APP_TOKEN ...` を使用します。

## 自宅LAN・VPNで使う

Codexを実行する端末からサーバーに到達できるアドレスを `PUBLIC_BASE_URL` に指定してください。

```bash
export ALLOWED_HOSTS='localhost,127.0.0.1,192.168.1.100'
export PUBLIC_BASE_URL='http://192.168.1.100:8000'
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log
```

IPは自分のサーバーに置き換えます。端末で動くCodex CLIならLAN/VPNのアドレスを使用できます。クラウド側で動くCodexからは、あなたのPCと同じLANには通常アクセスできません。

HTTPSリバースプロキシ配下ではホストを `ALLOWED_HOSTS` に追加し、`PUBLIC_BASE_URL=https://...` と `SECURE_COOKIE=true` を設定してください。プロキシは元のHostを保持し、Uvicorn側のforwarded headerは信頼するプロキシのIPだけ許可してください。アプリは同一オリジンからの操作のみ受け付けます。サブパス配信は未対応、オリジンのルートに配置してください。

識別URLのキーは閲覧権限を持つため、リバースプロキシでもクエリ文字列をアクセスログへ記録しない設定にしてください。アプリ用のアクセスログは上記の `--no-access-log` で無効化しています。静的アセットはすべて同一オリジンです。

## Codexへの渡し方

1. アプリでフレームを抽出し、画像を選択。
2. 「識別URLを発行」を押す。
3. 「指示文をコピー」を押して、ネットワークアクセスが許可されたCodexへ貼り付ける。
4. Codexがページ内のプロンプトを読み、Reddit本文をリサーチ。
5. マニフェストの画像URLから画像を取得し、画像閲覧機能で確認してコーチング。

**ネットワーク許可だけでは不十分で、Codexに画像閲覧機能とRedditへの到達手段も必要です。**このアプリがRedditをスクレイピングしたり、閲覧しただけでコーチングを開始したりするわけではありません。

プロンプトテンプレートは [`app/prompts/coaching.md`](app/prompts/coaching.md)。共有URL発行時に実際のプレイヤー設定・状況メモ・抽出設定を埋め込み、生成済みの文章を保存します。テンプレートの後日変更で既存URLの指示が勝手に変わることはありません。

テンプレートは以下を指示します。

- Redditで関連議論を目安3件以上、本文・コメントまで確認する。
- 日付・URL・主張・反対意見・適用条件を示す。
- 仕様やパッチの話はRiot公式情報も確認する。
- Reddit本文を1件も確認できなければコーチングを中断し、不足を報告する。
- 観察事実・ユーザー申告・Redditの見解・推測を分ける。
- 見ていない画像・聞こえない音・画面外の敵・反応速度を捏造しない。

これはCodexへの必須指示を提供する設計であり、外部Codexが実際に調査を行ったことをアプリ側で強制・検証する機能ではありません。

## データと制限

| 設定 | 既定値 | 用途 |
|---|---|---|
| `APP_TOKEN` | なし・必須 | 16文字以上の秘密。管理画面ログイン |
| `DATA_DIR` | `./data` | SQLite、元動画、JPEG |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | 接続を許可するホスト |
| `PUBLIC_BASE_URL` | 現在のリクエストのorigin | Codexが到達できるURLの基点 |
| `SECURE_COOKIE` | `false` | HTTPSでは`true` |
| `MAX_UPLOAD_MB` | `4096` | 1動画のサイズ上限 |

- 単一プロセス・1ワーカー。重複起動はデータフォルダのロックで拒否します。
- 動画は8時間以内・4K相当の画素数以下。フレームは横幅最大1920pxのJPEG。
- キューはSQLiteに保存。起動時に待機中ジョブを処理し、途中で停止した処理は失敗として表示して再実行可能にします。
- 受信中にサイズを検査。空き容量が1GiB未満になる場合はアップロードを拒否。元動画・フレームは自動削除しません。不要になった録画はUIで削除してください。
- FFmpegタイムアウト300秒、FFprobe30秒、アップロード30分。切断やサイズ超過時の中途ファイルは削除。
- 時刻は抽出設定から算出した目安で、元フレームの厳密なタイムスタンプではありません。音声解析なし。
- 共有URLは選択したフレームと設定だけに有効。ログインCookieは不要。キーはDBにハッシュで保存し、再表示しません。
- 再抽出または録画削除で、その録画の既存識別URLはすべて無効になります。
- ブラウザで動画再生できるかはコーデックに依存。抽出はサーバー側で実行します。

認証と期限付きURLはありますが、不特定多数を受け入れる公開SaaS向けの隔離・ユーザー管理は未実装です。まずは自分用のLAN/VPNで運用する範囲を想定しています。

## テスト

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
node --check app/static/app.js
```

FFmpegで生成した実動画をアップロードし、抽出・プロンプトへの設定反映・共有画像・認証・期限切れ・失効・再起動からの復元を検証します。CodexやRedditへ実際に接続するテストは行いません。

## 次の段階：Docker

`DATA_DIR` を永続ボリュームとしてマウントし、FFmpegを同梱した非rootのイメージにできます。現時点ではDockerfileは作成していません。詳細は [`docs/architecture.md`](docs/architecture.md)。

## 参考資料

- [FastAPI: Requestを直接使用する](https://fastapi.tiangolo.com/advanced/using-request-directly/)
- [FFmpeg: fpsフィルター](https://ffmpeg.org/ffmpeg-filters.html#fps-1)
- [Codex: 画像入力](https://learn.chatgpt.com/docs/image-inputs)

## ライセンス

既存のGPL-3.0ライセンスを維持しています。[LICENSE](LICENSE) を参照してください。
