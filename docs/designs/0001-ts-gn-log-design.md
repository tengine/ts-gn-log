# 0001: ts-gn-log 設計案

py-gn-log の TypeScript 版。Cloud Run 上の Node.js サーバ (当面は Next.js の Route Handler = BFF) から、Cloud Logging が構造化ログとして取り込み、Error Reporting が収集し、Cloud Trace と紐付く JSON 行を出すためのライブラリ。py-gn-log と**出力の契約 (キー名・trace の運び方・fingerprint の規則) を共有する**ことを第一の目的にする。

> 決定事項 (2026-09-09、関係者の確認済み): リポジトリは **public**。配布は **git 参照 + `dist/` をコミット**。言語は **TypeScript 7 系**。**ESM のみ** (CommonJS は出さない)。分類と fingerprint は **既定では付けない**。**ブラウザ側は対象外**。`package.json` は `"private": true` (npm には公開しない)。パッケージ名は **`ts-gn-log`** (リポジトリ名と同じ、scope なし)。

調査の根拠: py-gn-log 利用プロジェクト A (Next.js BFF + Python サービス群を Cloud Run で運用) の自前ロギング実装 (TypeScript 側 159 行。エラー用関数の呼び出し 52 箇所 / 観測用 4 箇所で利用、他に素の `console.*` が route / lib に 65 箇所)、同プロジェクトでの py-gn-log 導入時の議論、py-gn-log の Issue #12〜#18、npm の最新版 (2026-09-09 時点)。

## 1. 位置づけと範囲

| | 内容 |
|---|---|
| 対象 | Node.js で動くサーバ側コード。Cloud Run (Service / Job / Worker Pool) を第一に、ローカル開発も同じ API で動く |
| 当面の利用者 | Next.js の Route Handler (`runtime = 'nodejs'`)。利用プロジェクト A の BFF はすべて nodejs runtime で、edge runtime の route は無い |
| 対象外 (v0.1) | ブラウザ側のログ、Next.js middleware (edge)、Cloud Logging API への直接送信 (`@google-cloud/logging`)。Cloud Run では stdout/stderr への JSON 行が標準経路なので、API 送信は要らない |
| py-gn-log との関係 | 同じ契約を 2 言語で実装する「対」。契約の正本は py-gn-log 側の Issue (#15 文脈、#17 Cloud Trace、#18 分類と fingerprint) で決め、ts-gn-log はそれに従う。片方だけで決めない |

## 2. 出力の契約 (py-gn-log と揃える部分)

py-gn-log (`e7119631`) の実出力と、利用プロジェクト A の自前実装の出力を突き合わせて決めた。

### 2.1 すべての行に付くもの

| キー | 値 | 備考 |
|---|---|---|
| `severity` | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` | Cloud Logging の LogSeverity。py-gn-log と同じ |
| `message` | 文字列 | |
| `timestamp` | ISO 8601 UTC (`2026-09-09T01:23:45.678Z`) | py-gn-log はマイクロ秒 6 桁、JS はミリ秒 3 桁。Cloud Logging はどちらも読む |
| `name` | ロガー名 | py-gn-log の `name` に合わせる (利用プロジェクト A の現行 `logger` / `surface` は使わない。サーフェスは `resource.labels.service_name` か `labels` で) |
| `logging.googleapis.com/labels` | `{ ...固定 labels }` | py-gn-log は `thread_id` / `thread_name` も入れる。Node にスレッドは無いので固定 labels のみ |

### 2.2 文脈があるときに付くもの (py-gn-log #15 / #17)

| キー | 値 |
|---|---|
| `logging.googleapis.com/trace` | `projects/<PROJECT_ID>/traces/<TRACE_ID>` |
| `logging.googleapis.com/spanId` | span id |
| `logging.googleapis.com/trace_sampled` | boolean |
| 任意の文脈フィールド | `runWithContext({ site: 'x' }, fn)` で置いた値がそのまま (snake_case を推奨。py 側の `extra` と同じ) |

`PROJECT_ID` は引数か環境変数 (`GOOGLE_CLOUD_PROJECT`) から取り、**未指定ならデフォルト値を持たず trace フィールドを付けない** (「接続先のデフォルト値を持たない」規律)。

### 2.3 ERROR 以上に付くもの

| キー | 値 | 備考 |
|---|---|---|
| `stack_trace` | `err.stack` | Error Reporting が認識するフィールド名。py-gn-log PR #9 と同じく ERROR 以上のみ |
| 任意 (`errorEvent` を有効にしたとき、py-gn-log #18) | `event` (固定名) / `error_type` (未指定 `unknown`) / `operation` (未指定はロガー名) / `fingerprint` | 既定では付けない。利用側が現行の挙動を保ちたいときだけ有効化する |

`fingerprint` の規則は py-gn-log #18 (main にマージ済み) と共有する。正本は py-gn-log の README「fingerprint の規則 (他言語の実装との契約)」と `src/gnlog/fingerprint.py`。要点: (1) UUID → `<uuid>`、引用文字列 → `<str>` (二重引用符、または直前が ASCII 英数字・下線でない単一引用符)、数値 (`\b\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?\b`、ASCII の意味の `\b` / `\d`) → `<num>` の順に置換、(2) 先頭 300 文字に切り詰め、(3) `surface` / `operation` / `error_type` / 正規化したメッセージのそれぞれで `\` → `\\`、`|` → `\|` に escape してから `|` で連結、(4) UTF-8 の SHA-1 の hex 先頭 16 文字。ゴールデンベクタは py-gn-log の tests を正本として複製し、両言語で一致を検証する。「300 文字」の単位 (コードポイントか UTF-16 コード単位か) は py-gn-log #26 で未決で、ts-gn-log の実装時にコードポイント単位で揃える案を #26 に出す。

### 2.4 py-gn-log 側に変更を求めるもの

- `stack_info: null` が常に付く (`gnlog.google.cloud_logging.JsonFormatter.parse()` に `stack_info` を含めているため。2026-09-10 の main でも同じ)。ts 側では出さないので、py 側で外すか、両方で出すかを決める必要がある → py-gn-log に小さな Issue を足す (未起票)
- キー名の snake_case (`error_type` / `trace_id`) は py-gn-log の `extra` の流儀に従う。利用プロジェクト A の現行 camelCase (`traceId` / `errorType`) は ts-gn-log では採らない

## 3. API 案

```ts
import { createLogger, isCloudRun } from 'ts-gn-log/google/cloud-run'   // provider ごとの入口 (py-gn-log #30 と同じ構造)
import { runWithContext, getContext } from 'ts-gn-log/context'
import { traceFromHeaders, traceHeaders, withRequestTrace } from 'ts-gn-log/google/cloud-trace'
import { normalizeMessage, buildFingerprint } from 'ts-gn-log/fingerprint'

// 初期化 (プロセスで 1 回。py-gn-log の gnlog.google.cloud_run.setup_logging に相当)
const log = createLogger({
  name: 'bff',
  labels: { service: 'frontend' },        // logging.googleapis.com/labels
  projectId: process.env.GOOGLE_CLOUD_PROJECT, // trace フィールドの組み立てに使う。未指定なら付けない
  level: 'INFO',                           // 省略時は LOG_LEVEL 環境変数、無ければ INFO
  json: undefined,                         // 省略時は環境変数 GNLOG_FORMAT (json / text)、無ければ isCloudRun()。true/false で強制 (py-gn-log #13 と対)
  errorEvent: { event: 'app_error', surface: 'frontend-bff' }, // 任意。ERROR 以上に分類と fingerprint を付ける (#18)
})

log.info('task accepted', { site: 'site-a', operation: 'POST /api/v1/things' })
log.error('save failed', { err, error_type: 'infra', operation: 'save_result' })
log.child({ site: 'site-a' })             // 固定フィールドを持つ子ロガー

// 文脈 (AsyncLocalStorage。py-gn-log #15 の ContextVar と対)
await runWithContext({ trace, site: 'site-a' }, async () => {
  log.info('inside')                       // trace / site が自動で付く
})

// Cloud Trace (py-gn-log #17 と対)
const trace = traceFromHeaders(request.headers)  // X-Cloud-Trace-Context → 無ければ traceparent → 無ければ新規生成
const headers = traceHeaders()                     // 現在の文脈から traceparent / X-Cloud-Trace-Context を組み立てる (送信用)
export const POST = withRequestTrace(async (req) => { ... }) // Next.js Route Handler 用の薄い包み
```

設計上の決め事:

- **ロガーは `console` を経由せず `process.stdout` / `process.stderr` に 1 行書く** (Next.js の `console` パッチや色付けの影響を受けないため)。severity が ERROR 以上なら stderr、それ以外は stdout (Cloud Run は両方を取り込む)
- **ローカル (Cloud Run 外) は人が読める text 形式** (`2026-09-09T01:23:45.678Z INFO  bff  message  {fields}`)。`json: true` で JSON を強制できる
- **Cloud Run 判定は `K_SERVICE` / `CLOUD_RUN_JOB` / `CLOUD_RUN_WORKER_POOL` の存在** (py-gn-log と同じ 3 変数、同じ `!= undefined` 判定)
- **`err` は `Error` でなくてもよい** (文字列 / unknown を `message` に落とす)
- **文脈は AsyncLocalStorage** (`node:async_hooks`)。Next.js の Route Handler は Node の非同期文脈をそのまま通すので、リクエストごとの文脈を全 await 先まで運べる。Python の ContextVar と同じ位置づけ
- **trace が無いリクエストでは新規に trace id を生成する** (32 hex)。Cloud Run が付ける `X-Cloud-Trace-Context` があればそれを優先。W3C `traceparent` も読む (OpenTelemetry と互換にしておくため。`@opentelemetry/api` 自体には依存しない)
- **応答 body に載せる trace id は Cloud Trace の trace id にする** (利用側が応答 body に持つキー名はそのまま、値だけが独自形式から Cloud Trace の id に変わる)。利用者報告の値からログを引く運用は維持できる

## 4. 実行環境と依存

### 4.1 ランタイム依存: ゼロ

必要なのは JSON の組み立て、`node:crypto` (sha1 / ランダム id)、`node:async_hooks` (AsyncLocalStorage)、`process.stdout` だけで、すべて Node 標準ライブラリで足りる。

検討して採らなかったもの:

| 候補 | 週間 DL (npm) | 採らない理由 |
|---|---|---|
| `pino` 10.3.1 | 約 4,400 万 | 高速で広く使われるが、出力の形 (`level` が数値、`time` がエポック等) を Cloud Logging の特殊フィールドに合わせる変換層が要り、`pino-pretty` 等も付いてくる。契約を自分で持つ本ライブラリでは、依存を増やす割に得るものが少ない |
| `@opentelemetry/api` 1.9.1 | 約 7,300 万 | trace の伝播だけなら `traceparent` の読み書きで足りる。将来 OTel SDK を入れるときは、`traceFromHeaders` が返す trace id を OTel の SpanContext から取る口を足せばよい |
| `@google-cloud/logging` 12.0.1 | — | Cloud Run では stdout 経由が標準で、API 送信は認証・リトライ・依存を増やす。py-gn-log の README も「`google-cloud-logging` の `setup_logging` との併用は不要」と書いている |

### 4.2 開発時の依存 (2026-09-09 時点の最新)

| 用途 | 採用 | 版 | 備考 |
|---|---|---|---|
| 言語 | TypeScript | **7.0.2** (`latest`) | TS 7 は Go 実装 (tsgo) に切り替わった世代。`tsc` としての互換は保たれているが、`.d.ts` 出力や `isolatedDeclarations` 周りの成熟度は着手時に確認する。利用側との互換は `.d.ts` の文法で決まるので、利用側の TypeScript が古くても問題ない |
| Node | **24 LTS** (Krypton) | `@types/node` は **24.13.3** | 利用プロジェクト A の実行環境が Node 24 なので合わせる。26 系は最新だが LTS でなく、`@types/node@26` を使うと実行環境に無い API が型で通ってしまう。`engines.node: ">=24"` を宣言 |
| ビルド | `tsc` のみ | (TypeScript に同梱) | 小さなライブラリなので bundler は使わない。ESM を `dist/` に出し `.d.ts` を同梱。tsdown 0.23 / tsup 8.5 は依存が増えるだけなので採らない |
| テスト | Vitest | **5.0.0** | Node `^22.12 \|\| ^24 \|\| >=26` 対応。カバレッジは `@vitest/coverage-v8` 5.0.0 |
| lint / format | Biome | **2.5.12** | eslint 10 + prettier 3.9 の 2 本立てを 1 本にできる。週 1,300 万 DL で十分に使われている。TS 7 との相性は着手時に確認 |
| パッケージ検査 | publint 0.3.24 / `@arethetypeswrong/cli` 0.18.5 | 任意 | `exports` と `.d.ts` の解決が正しいかを CI で確認する |

モジュール形式は **ESM のみ** (`"type": "module"`、`exports` で `.`, `./context`, `./trace`, `./fingerprint` を公開)。Next.js 14 以降は ESM 依存をそのまま扱えるので CommonJS は出さない。

### 4.3 配布 (決定: public リポジトリ + git 参照 + `dist/` をコミット)

py-gn-log と同じく **npm には公開せず、public リポジトリを git 参照**で使う (`"ts-gn-log": "github:tengine/ts-gn-log#v0.1.0"`。tag か SHA で版を固定)。利用側の `npm ci` は Docker ビルド (Cloud Build) の中で認証なしに走るため、public であることが条件になる。py-gn-log が public リポジトリの tarball URL で SHA 固定しているのと同じ考え方で、2 つのライブラリの配布方針が揃う。

git 参照ではビルド済みの `dist/` が必要なので、**`dist/` をコミットする**。二重管理 (ソースと生成物) を防ぐため、「`dist/` を空にしてから `npm run build` を実行し、`git status --porcelain dist/` が空である」ことを検査する (`git diff` では新規ファイルの追加漏れと古い出力の削除漏れを検出できない)。手元では `npm run check:dist` がこの検査で、CI (`.github/workflows/ci.yml`) でも同じ検査を PR ごとに走らせる。`prepare` スクリプトで利用側にビルドさせる案は、git 参照のインストールでは利用側で `prepare` が実行され、利用側に TypeScript 7 が要るので採らない。

**この節が配布方針 (npm に公開しない理由、`dist/` をコミットする規律) の正本。** README のインストールと開発者向けの節はここを参照し、手順だけを書く。

検討して採らなかった配布方法:

| 方法 | 採らない理由 |
|---|---|
| private のまま GHA で GitHub App トークンを取り、`npm pack` した tgz を build context に stage する | 動くが、deploy 経路と CI の複数箇所に stage を置き、ローカル開発者にも取得スクリプトが要る。public にすれば配線が不要になる |
| Docker ビルドにトークンを秘密として渡す | Cloud Build の substitution → BuildKit secret → Dockerfile の `git config` と配線が多く、漏洩の配慮も要る |
| GitHub Packages (npm レジストリ) | public パッケージでも取得に GitHub のトークンが要り、Docker ビルドに認証を持ち込むことになる |
| npmjs.com に公開 | py-gn-log が PyPI に上げていない (`Private :: Do Not Upload`) のと方針が割れる |

## 5. 利用プロジェクト A への適用 (ts-gn-log ができた後)

1. 自前のロギング実装を ts-gn-log の薄い包みに置き換える。エラー用 / 観測用の関数のシグネチャは残し (呼び出し 52 + 4 箇所は無改修)、中身を `log.error(...)` / `log.info(...)` に委譲する。`errorEvent` を有効にすれば `event` / `fingerprint` も出続ける
2. Route Handler を `withRequestTrace` で包み、Cloud Run の `X-Cloud-Trace-Context` から trace を文脈に置く。応答 body の trace id は Cloud Trace の id にする (キー名は変えない)
3. HTTP 以外の経路 (タスク中継基盤のペイロード) に trace を載せ、Python 側は py-gn-log #17 の「HTTP 以外の経路」の口で復元する。中継基盤自体には手を入れない
4. 素の `console.*` 65 箇所は、置き換えとは別の PR で段階的に `log.warn` / `log.error` へ寄せる (今は severity が付かず Cloud Logging で `DEFAULT` になっているもの)
5. TypeScript 側と Python 側の fingerprint parity ゴールデンは、ts-gn-log と py-gn-log のリポジトリ間のテストに移す (同じゴールデンベクタを両方に置く)

## 6. リポジトリ構成案

py-gn-log #30 と同じく、直下は provider (Google Cloud / AWS 等) を知らない共通部、provider ごとの実装は `google/` 配下に置く。`ts-gn-log` (index) は共通部だけを再輸出し、`google/*` を読み込まない。利用側は `ts-gn-log/google/cloud-run` を入口にする。**下の対応表がサブパスと役割の正本。** README の「パッケージの構造」はここを参照し、実装の状態を添えた要約を持つ。

| py-gn-log | ts-gn-log (サブパス) | 役割 |
|---|---|---|
| `gnlog.context` | `ts-gn-log/context` | 文脈 (AsyncLocalStorage の `runWithContext` / `getContext`) |
| `gnlog.fingerprint` | `ts-gn-log/fingerprint` | `normalizeMessage` / `buildFingerprint` (§2.3 の規則) |
| `gnlog.level` | `ts-gn-log/level` | ログレベルの変換、`LOG_LEVEL` の読み取り |
| `gnlog.output` | `ts-gn-log/output` | 出力形式の決定 (`GNLOG_FORMAT`)、text 整形、stdout/stderr への書き出し、Logger の核 |
| `gnlog.trace` | `ts-gn-log/trace` | W3C `traceparent` の解釈・組み立て、現在の trace の保持 (文脈の `trace` キー) |
| `gnlog.google.cloud_run` | `ts-gn-log/google/cloud-run` | **入口** `createLogger()` (= `setup_logging()`) と `isCloudRun()` |
| `gnlog.google.cloud_logging` | `ts-gn-log/google/cloud-logging` | Cloud Logging 向け JSON 整形 (severity / labels / stack_trace / errorEvent / fingerprint) |
| `gnlog.google.cloud_trace` | `ts-gn-log/google/cloud-trace` | `X-Cloud-Trace-Context` の解釈、`logging.googleapis.com/*` フィールド、`projectId`、`traceFromHeaders` / `traceHeaders` / `withRequestTrace` |

```
ts-gn-log/
├── src/
│   ├── index.ts              共通部 (context / fingerprint / level / output / trace) の再輸出。google は読み込まない
│   ├── context.ts
│   ├── fingerprint.ts
│   ├── level.ts
│   ├── output.ts
│   ├── trace.ts
│   └── google/
│       ├── cloud-run.ts      createLogger / isCloudRun
│       ├── cloud-logging.ts  JSON 整形
│       └── cloud-trace.ts    Web 標準の Headers / Request を受ける
├── test/               Vitest。fingerprint のゴールデンベクタは py-gn-log と共有
├── dist/               tsc の出力 (ESM + .d.ts)。git 参照で使うためコミットする。ソースとの一致を検査する (§4.3)
├── biome.json
├── tsconfig.json       target ES2022, module NodeNext, strict, declaration
├── package.json        name: ts-gn-log, type: module, exports (上の表のサブパスごと), engines.node >=24, private: true (npm 非公開。git 参照には影響しない)
└── README.md           py-gn-log の README と同じ構成 (インストール / 使い方 / 環境変数 / Cloud Run / 開発者向け)
```

## 7. 残る確認

- ~~ライセンス表記 (public にするので `LICENSE` ファイルを置くかどうか。py-gn-log に合わせる)~~ → py-gn-log に `LICENSE` が無いので置かない (2026-09-10)
- py-gn-log 側の `stack_info: null` (§2.4) を外すかどうか
- fingerprint の「300 文字」の単位 (py-gn-log #26)

## 8. py-gn-log 側の状況 (2026-09-10 追記)

設計時 (`e7119631`) に Issue として参照していた #15 (文脈) / #17 (Cloud Trace) / #18 (分類と fingerprint) は、いずれも py-gn-log の main にマージ済み。#30 で provider 固有の実装が `gnlog.google.*` (`cloud_run` / `cloud_logging` / `cloud_trace`) に再配置され (ts-gn-log も最初から同じ構造にする。§6)、v0.3.0 に上げる PR (#33) がレビュー中。ts-gn-log が揃える契約の正本は、Issue の議論ではなく **main の実装・README・tests** になった。
