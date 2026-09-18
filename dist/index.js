/**
 * ts-gn-log - Cloud Run 上の Node.js サーバから Cloud Logging 向けの構造化ログを出すライブラリ
 *
 * この入口は provider (Google Cloud / AWS 等) を知らない共通部だけを再輸出する。
 * ロギング設定の入口は provider ごとのサブパスにある (Cloud Run なら `ts-gn-log/google/cloud-run`)。
 */
export * from "./context.js";
export * from "./level.js";
export * from "./output.js";
