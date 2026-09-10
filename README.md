# ts-gn-log

ts-gn-log は、Cloud Run 上の Node.js サーバから Cloud Logging 向けの構造化ログを出すための TypeScript ライブラリです。[py-gn-log](https://github.com/tengine/py-gn-log) の TypeScript 版で、出力の契約 (キー名、trace の運び方、fingerprint の規則) を py-gn-log と共有します。設計は [docs/designs/0001-ts-gn-log-design.md](docs/designs/0001-ts-gn-log-design.md) を参照してください。

対象は Node.js で動くサーバ側コード (当面は Next.js の Route Handler、`runtime = 'nodejs'`) です。ブラウザ側と Next.js middleware (edge) は対象外です。

## パッケージの構造

py-gn-log と同じく、`ts-gn-log` の直下は provider (Google Cloud / AWS 等) を知らない共通部で、provider ごとの実装はサブパスにあります。利用側は使う provider のサブパスを明示的に import し、そこを入口にします。サブパスと役割の正本は[設計案 §6](docs/designs/0001-ts-gn-log-design.md#6-リポジトリ構成案)で、下の表は実装の状態を添えた要約です。

| サブパス | 役割 | 状態 |
|---|---|---|
| `ts-gn-log` | 共通部の再輸出。`google/*` は読み込まない | 空 (機能を足す PR で埋める) |
| `ts-gn-log/context` | リクエスト / タスク単位の文脈を全ログ行に付ける (AsyncLocalStorage) | 未実装 |
| `ts-gn-log/fingerprint` | ERROR の dedup 用 fingerprint の正規化とハッシュ | 未実装 |
| `ts-gn-log/level` | ログレベルの変換、`LOG_LEVEL` の読み取り | 未実装 |
| `ts-gn-log/output` | 出力形式の決定 (`GNLOG_FORMAT`)、text 整形、stdout / stderr への書き出し | 未実装 |
| `ts-gn-log/trace` | W3C Trace Context (`traceparent`) の解釈・組み立てと、現在の trace の保持 | 未実装 |
| `ts-gn-log/google/cloud-run` | **Cloud Run 向けの入口** `createLogger()` と `isCloudRun()` | 未実装 |
| `ts-gn-log/google/cloud-logging` | Cloud Logging 向けの JSON 整形 (severity / labels / stack_trace / fingerprint) | 未実装 |
| `ts-gn-log/google/cloud-trace` | `X-Cloud-Trace-Context` の解釈と Cloud Logging の特殊フィールド (`logging.googleapis.com/trace` 等) | 未実装 |

## インストール

npm には公開していません。GitHub の public リポジトリを git 参照で使います。tag か SHA で版を固定してください。

```
npm install github:tengine/ts-gn-log#v0.1.0
```

`package.json` に書く場合:

```json
{
  "dependencies": {
    "ts-gn-log": "github:tengine/ts-gn-log#v0.1.0"
  }
}
```

ビルド済みの `dist/` (ESM と `.d.ts`) をリポジトリにコミットしているので、利用側に TypeScript は要りません。ランタイム依存はありません。Node 24 以上が必要です。配布方針 (npm に公開しない理由、`dist/` をコミットする理由) の正本は[設計案 §4.3](docs/designs/0001-ts-gn-log-design.md#43-配布-決定-public-リポジトリ--git-参照--dist-をコミット)、依存の方針は [§4.1](docs/designs/0001-ts-gn-log-design.md#41-ランタイム依存-ゼロ)、Node の版は [§4.2](docs/designs/0001-ts-gn-log-design.md#42-開発時の依存-2026-09-09-時点の最新) です。

## 使い方

(機能を足す PR で書く)

## 環境変数

py-gn-log と同じ名前と意味です。

| 環境変数 | 意味 | 未設定のとき |
|---|---|---|
| `LOG_LEVEL` | 出力するレベルの下限。`DEBUG` / `INFO` / `WARN` / `WARNING` / `ERROR` / `CRITICAL` (大文字小文字を問わない) | `INFO`。未知の値も `INFO` に倒す (エラーにしない) |
| `GNLOG_FORMAT` | 出力形式を明示的に指定する。`json` (Cloud Logging 向けの JSON 行) か `text` (人が読む形式)。それ以外の値は `createLogger()` がエラーを投げる | Cloud Run 上 (`K_SERVICE` などがある) なら `json`、それ以外なら `text` |
| `K_SERVICE` / `CLOUD_RUN_JOB` / `CLOUD_RUN_WORKER_POOL` | Cloud Run が自動設定する。存在すれば Cloud Run 上と判定する | — |

`createLogger({ level, json })` の引数は環境変数より優先します。`json` を引数で指定した場合は `GNLOG_FORMAT` を読まないので、不正な値があってもエラーになりません。

py-gn-log にある `LOG_FILE_PATH` (テキスト形式のファイル出力) と `LOG_FORMAT` (テキスト形式の書式文字列) は、ts-gn-log にはありません。Cloud Run では stdout / stderr が標準の経路で、ローカルの text 形式は固定です。

## Cloud Run での使用

Cloud Run (Service / Job / Worker Pool) 上かどうかは、Cloud Run が自動設定する環境変数 `K_SERVICE` / `CLOUD_RUN_JOB` / `CLOUD_RUN_WORKER_POOL` のいずれかが存在するかで判定します (py-gn-log の `is_cloud_run()` と同じ 3 変数、同じ判定)。判定だけを使う場合は `isCloudRun()` を呼びます。

```ts
import { isCloudRun } from "ts-gn-log/google/cloud-run";

if (isCloudRun()) {
  // Cloud Run 上
}
```

## 開発者向け

### 前提条件

- Node 24 (`.tool-versions` で指定。asdf などで合わせてください)
- npm

```
npm ci
```

### コマンド

| コマンド | 内容 |
|---|---|
| `npm run build` | `tsc` で `src/` を `dist/` にビルドする (ESM + `.d.ts`) |
| `npm run check:dist` | `dist/` を空にしてビルドし直し、コミット済みの `dist/` と一致することを検査する (`git status --porcelain dist/` が空なら成功) |
| `npm run typecheck` | `src/` と `test/` と `vitest.config.ts` を `tsc` で型検査する (出力なし)。`npm run build` は `src/` しか見ないので、テストの型はこちらで検査する |
| `npm test` | Vitest でテストを実行する |
| `npm run test:cov` | カバレッジ付きでテストを実行する |
| `npm run lint` | Biome で lint と書式を検査する |
| `npm run format` | Biome で書式を整える |

### `dist/` をコミットする規律

規律の正本は[設計案 §4.3](docs/designs/0001-ts-gn-log-design.md#43-配布-決定-public-リポジトリ--git-参照--dist-をコミット)です。手順だけを書きます。

- `src/` を変えた PR では、最後に `npm run build` を実行して `dist/` を再生成し、ソースの変更とは別のコミットとして含める
- PR を出す前に `npm run check:dist` を実行し、コミット済みの `dist/` が現在のソースから生成されるものと一致することを確かめる。CI (`.github/workflows/ci.yml`) も同じ検査を PR ごとに走らせ、ずれていれば失敗する
- `prepare` スクリプトは足さない (理由は §4.3)
