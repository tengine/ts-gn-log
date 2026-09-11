# ts-gn-log

ts-gn-log は、Cloud Run 上の Node.js サーバから Cloud Logging 向けの構造化ログを出すための TypeScript ライブラリです。[py-gn-log](https://github.com/tengine/py-gn-log) の TypeScript 版で、出力の契約 (キー名、trace の運び方、fingerprint の規則) を py-gn-log と共有します。設計は [docs/designs/0001-ts-gn-log-design.md](docs/designs/0001-ts-gn-log-design.md) を参照してください。

対象は Node.js で動くサーバ側コード (当面は Next.js の Route Handler、`runtime = 'nodejs'`) です。ブラウザ側と Next.js middleware (edge) は対象外です。

## パッケージの構造

py-gn-log と同じく、`ts-gn-log` の直下は provider (Google Cloud / AWS 等) を知らない共通部で、provider ごとの実装はサブパスにあります。利用側は使う provider のサブパスを明示的に import し、そこを入口にします。サブパスと役割の正本は[設計案 §6](docs/designs/0001-ts-gn-log-design.md#6-リポジトリ構成案)で、下の表は実装の状態を添えた要約です。

| サブパス | 役割 | 状態 |
|---|---|---|
| `ts-gn-log` | 共通部の再輸出。`google/*` は読み込まない | `context` / `fingerprint` / `level` / `output` / `trace` を再輸出 |
| `ts-gn-log/context` | リクエスト / タスク単位の文脈を全ログ行に付ける (AsyncLocalStorage) | 実装済み |
| `ts-gn-log/fingerprint` | ERROR の dedup 用 fingerprint の正規化とハッシュ | 実装済み |
| `ts-gn-log/level` | ログレベルの変換、`LOG_LEVEL` の読み取り | 実装済み |
| `ts-gn-log/output` | 出力形式の決定 (`GNLOG_FORMAT`)、text 整形、stdout / stderr への書き出し、Logger の核 | 実装済み |
| `ts-gn-log/trace` | W3C Trace Context (`traceparent`) の解釈・組み立てと、現在の trace の保持 | 実装済み |
| `ts-gn-log/google/cloud-run` | **Cloud Run 向けの入口** `createLogger()` と `isCloudRun()` | 実装済み |
| `ts-gn-log/google/cloud-logging` | Cloud Logging 向けの JSON 整形 (severity / labels / stack_trace / fingerprint) | 実装済み (fingerprint は未実装) |
| `ts-gn-log/google/cloud-trace` | `X-Cloud-Trace-Context` の解釈と Cloud Logging の特殊フィールド (`logging.googleapis.com/trace` 等)、`withRequestTrace` | 実装済み |

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

### 基本的な使い方

入口は `ts-gn-log/google/cloud-run` の `createLogger()` です。プロセスで 1 回呼び、返ったロガーを使います (py-gn-log の `setup_logging()` に相当)。Cloud Run 上では Cloud Logging 向けの JSON 行、ローカルでは人が読む text 形式を、`console` を経由せず stdout / stderr に書きます (severity が ERROR 以上なら stderr、それ以外は stdout)。

```ts
import { createLogger } from "ts-gn-log/google/cloud-run";

const log = createLogger({
  name: "bff",                        // 全行の name
  labels: { service: "frontend" },    // logging.googleapis.com/labels (JSON 形式のみ)
  // level: "INFO",                   // 省略時は LOG_LEVEL、無ければ INFO
  // json: true,                      // 省略時は GNLOG_FORMAT、無ければ Cloud Run 上なら JSON
  // projectId: "my-project",         // logging.googleapis.com/trace の組み立てに使う。省略時は GOOGLE_CLOUD_PROJECT
  // fields: { app: "bff" },          // 全行に付く固定フィールド (child() の固定フィールドと同じ扱い)
});

log.info("task accepted", { site: "site-a", operation: "POST /api/v1/things" });
log.error("save failed", { err, error_type: "infra", operation: "save_result" });

const siteLog = log.child({ site: "site-a" }); // 固定フィールドを持つ子ロガー
siteLog.warn("retrying");
```

Cloud Run 上の出力 (1 行の JSON):

```json
{"site":"site-a","operation":"POST /api/v1/things","severity":"INFO","message":"task accepted","timestamp":"2026-09-09T01:23:45.678Z","name":"bff","logging.googleapis.com/labels":{"service":"frontend"}}
```

- ログの呼び出しは例外を投げません (Python の `logging` と同じ)。フィールドに循環参照や BigInt があっても行は出ます (循環は `"[Circular]"`、BigInt は文字列)。それでも直列化できない値 (投げる `toJSON` など) があるときは、フィールドを落として `fields_error` に理由を入れ、`severity` / `message` などは必ず出します。整形そのものが失敗した場合 (固定キーも直列化できない等) は、`severity` / `message` / `name` と `format_error` だけの固定の行を出し、書き出し (stdout / stderr) が失敗しても呼び出し元には伝播させません
- 呼び出し時のフィールドはそのまま JSON のキーになります。キー名は py-gn-log の `extra` と同じく snake_case を推奨します。`severity` / `message` / `timestamp` / `name` / `logging.googleapis.com/labels` と同名のフィールドは固定の値が勝ちます
- `err` だけは特別で、severity が ERROR 以上なら `stack_trace` (Error Reporting が認識するフィールド) に、WARNING 以下なら `error` に、その文字列 (Error なら `stack`) が入ります。`err` は Error でなくても構いません (文字列などはそのまま入り、`message` は変わりません)。`child({ err })` の固定フィールドに渡した `err` も同じ扱いです
- ローカルの text 形式は `2026-09-09T01:23:45.678Z INFO     bff  task accepted  {"site":"site-a"}` の 1 行で、`err` があれば次の行以降に stack が続きます。書式は固定です

### リクエスト / タスク単位の文脈を全ログ行に付ける

1 つのリクエストや 1 つのタスクの処理中に出るログ行を、あとから 1 つの ID で串刺しにしたい場面のために、`ts-gn-log/context` を用意しています (py-gn-log の `gnlog.context` と対)。`node:async_hooks` の AsyncLocalStorage に置いた値を、ロガーが出力時にフィールドとして混ぜます。Next.js の Route Handler は Node の非同期文脈をそのまま通すので、`await` 先まで届きます。

```ts
import { runWithContext, setContext, clearContext, getContext } from "ts-gn-log/context";

// fn の間だけ付ける (抜けると元に戻る。入れ子にでき、内側の値が勝つ)
await runWithContext({ request_id: "4bf92f35", site: "tokyo" }, async () => {
  log.info("処理開始"); // {"request_id":"4bf92f35","site":"tokyo","message":"処理開始",...}
  await doWork();      // この中のログにも付く
});

// いちばん内側の runWithContext の範囲を更新する (その範囲が終わるまで残る)。
// リクエストの途中で分かった値 (本文から取り出した ID など) を後から足す使い方
await runWithContext({}, async () => {
  const body = await req.json();
  setContext({ request_id: body.id }); // コールバックや await 先で呼んでも、同じ範囲なので残る
  log.info("...");
  clearContext();                        // この範囲の文脈を空にする (外側の範囲は消さない)
});
```

`setContext` / `clearContext` は `runWithContext` の外では使えません (`Error` になります)。`runWithContext` の中で始めて `await` し忘れた処理から、範囲が終わった後に `setContext` した場合は、エラーにはならず、その書き込みは誰にも読まれません (その処理自身のログには、範囲が生きていた頃の文脈が付きます)。文脈の更新は、その範囲を待っている処理の中で行ってください。`runWithContext` は fn が返した Promise をそのまま返し、観測しません — `await` / `catch` しなかった reject は通常どおり unhandled rejection になります。範囲の中でしか更新できないようにしている理由 (`enterWith` を使わず `run` で張る) は [`src/context.ts`](src/context.ts) の docstring を参照してください。Next.js の Route Handler は `withRequestTrace` (Cloud Trace の節) で囲う前提です。

- キー名は自由ですが、`severity` / `message` / `timestamp` / `name` / `logging.googleapis.com/labels` / `logging.googleapis.com/trace` / `logging.googleapis.com/spanId` / `logging.googleapis.com/trace_sampled` / `stack_trace` / `error` / `fields_error` / `format_error` / `err` は出力の固定キーと同名なので置けません (`Error` になります)。py-gn-log の `extra` と同じく snake_case を推奨します
- `trace` は予約キーで、出力には混ぜません (`ts-gn-log/trace` と `ts-gn-log/google/cloud-trace` が使います)
- 値が `null` / `undefined` のキーは出力されません (入れ子で外側の値を一時的に外すのに使えます)
- 優先順位は 呼び出し時のフィールド > `child()` の固定フィールド > 文脈 です
- text 形式でも同じくフィールドとして末尾の JSON に出ます

### Cloud Trace と連携して全ログ行に trace を付ける

Cloud Run はリクエストごとに `X-Cloud-Trace-Context` ヘッダ (と W3C の `traceparent`) を付けます。`ts-gn-log/google/cloud-trace` の `withRequestTrace` で Route Handler を包むと、受信ヘッダの trace を文脈に置き、全ログ行に `logging.googleapis.com/trace` / `spanId` / `trace_sampled` が付いて Cloud Logging でリクエスト単位に紐付きます (py-gn-log の `gnlog.google.cloud_trace` と対)。

```ts
import { createLogger } from "ts-gn-log/google/cloud-run";
import { currentTrace, traceHeaders, withRequestTrace } from "ts-gn-log/google/cloud-trace";

const log = createLogger({ name: "bff" }); // projectId は省略時 GOOGLE_CLOUD_PROJECT

export const POST = withRequestTrace(async (req: Request) => {
  log.info("received");                       // {"logging.googleapis.com/trace":"projects/<PROJECT_ID>/traces/<TRACE_ID>", ...}
  await fetch(url, { headers: traceHeaders() }); // 下流に trace を引き継ぐ (traceparent + X-Cloud-Trace-Context)
  return Response.json({ trace_id: currentTrace()?.traceId }); // 応答 body に載せる trace id は Cloud Trace の trace id
});
```

- 受信ヘッダは `traceparent` を優先し、無ければ `X-Cloud-Trace-Context` を見ます (py-gn-log と同じ順)。どちらも無ければ新しい trace id (32 桁の 16 進) を生成するので、包まれた処理の中では `currentTrace()` が常に返ります (生成した trace は `spanId` / `sampled` が不明で、下流には `X-Cloud-Trace-Context` だけを送ります)
- `logging.googleapis.com/trace` の組み立てにはプロジェクト ID が要ります。`createLogger({ projectId })` か環境変数 `GOOGLE_CLOUD_PROJECT` で指定し、どちらも無ければ trace のフィールドは付きません (既定値を持たない)。その場合でも `currentTrace()` と `traceHeaders()` は動くので、下流への引き継ぎはできます
- `withRequestTrace` は `runWithContext` で囲むので、その中で `setContext` が使えます。`fields` オプションで、trace とあわせて置くフィールド (リクエストから組み立てる関数でもよい) を渡せます。py-gn-log の `cloud_trace.bind(trace, log_fields(...))` と違い、`logging.googleapis.com/trace` などの trace のフィールドは `fields` に渡しません (予約キー `trace` から `jsonFormat` が自動で組みます。渡すと型エラーになります)。`newTrace` / `fields` の関数が投げてもリクエストは落とさず、既定 (生成し直す / fields 無し) に倒します
- HTTP 以外の経路 (Pub/Sub の属性、タスクのペイロード) では、発行側で `traceHeaders()` の値を属性に載せ、受信側で `traceFromHeaders(attributes)` (名前と値の Record を受けます) で取り出して `runWithTrace(trace, undefined, fn)` で囲みます

### ERROR のログを同種ごとにまとめる fingerprint

`ts-gn-log/fingerprint` は、メッセージの可変部 (ID、件数、引用文字列) を置き換えて正規化し、分類と組み合わせた短いハッシュを作ります (py-gn-log の `gnlog.fingerprint` と対)。Error Reporting が自動でグループ化できないエラー (例外を伴わない ERROR など) の dedup に使います。`createLogger` の `errorEvent` オプションが ERROR 以上のログに自動で付けるようにする予定です (PR 7 で実装)。

```ts
import { normalizeMessage, buildFingerprint } from "ts-gn-log/fingerprint";

normalizeMessage('order 123 for "alice" not found');
// => 'order <num> for <str> not found'
buildFingerprint("worker", "orders.create", "validation", "order 123 missing");
// => sha1("worker|orders.create|validation|order <num> missing") の先頭 16 文字
```

規則は py-gn-log との契約 (設計案 §2 の 3 番目) で、正本は py-gn-log の README「fingerprint の規則 (他言語の実装との契約)」です。要点: UUID → `<uuid>`、引用文字列 → `<str>`、数値 → `<num>` の順に置き換え、先頭 300 文字に切り詰め、`surface` / `operation` / `error_type` / 正規化したメッセージを `\` と `|` を escape して `|` で連結し、UTF-8 の SHA-1 の先頭 16 文字。**切り詰めの単位は Unicode のコードポイント** (Python の `len()` と同じ。JavaScript の `.length` は UTF-16 コード単位なので使いません。py-gn-log #26)。

単一引用符には限界があります。引用の区切りとアポストロフィを同じ文字で兼ねるため、アポストロフィで始まる語 (`'cause`、`'90s`) や対になっていない単一引用符があると、そこから次の単一引用符までが `<str>` にまとまり、別種のエラーが同じ fingerprint になります。厳密さが必要なメッセージでは二重引用符を使ってください (py-gn-log の README と同じ限界です)。

**残る 2 つの限界 (孤立サロゲート、入力の大きさ) の正本は [`src/fingerprint.ts`](src/fingerprint.ts) の docstring です。** ここには要点だけを書きます。

- **孤立サロゲート**: ts 側は U+FFFD に置き換えて値を返します (投げません)。py-gn-log と値が一致するかは、孤立サロゲートが正規化と切り詰めの後にも残る位置にあるかで決まります。py 側で何が起きるかは前提にしないでください (py-gn-log #34 で未決)。
- **入力の大きさ**: 置換は入力の全体に走るので、入力の大きさに比例したメモリを使います。十分に大きな入力では `try`/`catch` で受けられない fatal OOM でプロセスが落ちます (落ちる大きさはヒープの設定次第。実測値は docstring にあります)。**上限は呼び出し側の責務です** (py-gn-log #35 で未決)。ログの経路での上限 (PR 7 の `errorEvent` で実装) は[設計案 §2 の (5)](docs/designs/0001-ts-gn-log-design.md) が正本です。

両言語で同じ値になることは、py-gn-log の Python 実装から生成したゴールデンベクタ (`test/fixtures/fingerprint-golden.json`) で検証しています。正規化、`maxLength` を振った切り詰め (負の値と 0 を含む)、fingerprint の 3 つの軸を持ちます。規則を変えたときは py-gn-log の環境で再生成します:

```
cd ../py-gn-log && uv run python ../ts-gn-log/test/fixtures/generate-fingerprint-golden.py "$(git rev-parse --short HEAD)" > ../ts-gn-log/test/fixtures/fingerprint-golden.json
```

## 環境変数

py-gn-log と同じ名前と意味です。

| 環境変数 | 意味 | 未設定のとき |
|---|---|---|
| `LOG_LEVEL` | 出力するレベルの下限。`DEBUG` / `INFO` / `WARN` / `WARNING` / `ERROR` / `CRITICAL` (大文字小文字を問わない) | `INFO`。未知の値も `INFO` に倒す (エラーにしない) |
| `GNLOG_FORMAT` | 出力形式を明示的に指定する。`json` (Cloud Logging 向けの JSON 行) か `text` (人が読む形式)。それ以外の値は `createLogger()` がエラーを投げる | Cloud Run 上 (`K_SERVICE` などがある) なら `json`、それ以外なら `text` |
| `K_SERVICE` / `CLOUD_RUN_JOB` / `CLOUD_RUN_WORKER_POOL` | Cloud Run が自動設定する。存在すれば Cloud Run 上と判定する | — |
| `GOOGLE_CLOUD_PROJECT` | `logging.googleapis.com/trace` (`projects/<PROJECT_ID>/traces/<TRACE_ID>`) の組み立てに使うプロジェクト ID。`createLogger({ projectId })` が優先 | trace のフィールドを付けない (既定値を持たない) |

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

### 文書とテストの題に書く断定

規則の正本は [CLAUDE.md](CLAUDE.md) の「文書とテストの題に書く断定」です。要点は、断定はリポジトリの関門で検査できるものに限り、py-gn-log の挙動そのものは断定せず参照にし、引数の値の分割は実装の隣の docstring 1 箇所だけで語ってテストの題は値の表から生成する、の 3 つです。

### `dist/` をコミットする規律

規律の正本は[設計案 §4.3](docs/designs/0001-ts-gn-log-design.md#43-配布-決定-public-リポジトリ--git-参照--dist-をコミット)です。手順だけを書きます。

- `src/` を変えた PR では、最後に `npm run build` を実行して `dist/` を再生成し、ソースの変更とは別のコミットとして含める
- PR を出す前に `npm run check:dist` を実行し、コミット済みの `dist/` が現在のソースから生成されるものと一致することを確かめる。CI (`.github/workflows/ci.yml`) も同じ検査を PR ごとに走らせ、ずれていれば失敗する
- `prepare` スクリプトは足さない (理由は §4.3)
