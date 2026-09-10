/**
 * Cloud Run 向けの入口 (py-gn-log の gnlog.google.cloud_run と対)
 *
 * `isCloudRun()` は Cloud Run (Service / Job / Worker Pool) 上で動いているかを判定する。
 */

// Cloud Run 上で自動設定される環境変数。いずれかが存在すれば Cloud Run 環境と判定する。
// - K_SERVICE: Cloud Run Service でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#services-env-vars
// - CLOUD_RUN_JOB: Cloud Run Job でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#jobs-env-vars
// - CLOUD_RUN_WORKER_POOL: Cloud Run Worker Pool でのみ自動設定される
//   https://cloud.google.com/run/docs/container-contract#worker-pools-env-vars
const CLOUD_RUN_ENV_VARS = ["K_SERVICE", "CLOUD_RUN_JOB", "CLOUD_RUN_WORKER_POOL"] as const;

/**
 * Cloud Run (Service / Job / Worker Pool) 上で実行されているかを判定する。
 *
 * py-gn-log の `is_cloud_run()` と同じく、3 つの環境変数のいずれかが存在する
 * (値が空文字列でも存在すれば真) ことで判定する。
 */
export function isCloudRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return CLOUD_RUN_ENV_VARS.some((name) => env[name] !== undefined);
}
