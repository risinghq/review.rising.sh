import { bindings, defineConfig, triggers } from "cf/config";

import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
import { WORKER_FIRST } from "./src/routes.ts";

const HOST = "review.rising.sh";

export default defineConfig({
  worker: {
    name: "review",
    domains: [HOST],
    workersDev: false,
    compatibilityDate: "2026-10-01",
    entrypoint,
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: false },
    },
    assets: { runWorkerFirst: WORKER_FIRST },
    // Hourly: open a pull request with the chunks checked since the last one.
    triggers: [triggers.scheduled({ schedule: "17 * * * *" })],
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "review" }),
      SCANS: bindings.r2({ name: "review-scans" }),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      GITHUB_CLIENT_ID: bindings.secret(),
      GITHUB_CLIENT_SECRET: bindings.secret(),
      GITHUB_TOKEN: bindings.secret(),
      TARGET_REPO: bindings.text("caefisica/caefisica.com"),
      TARGET_BASE: bindings.text("master"),
      TARGET_DIR: bindings.text("content/apuntes/física-estadística/landi"),
      SESSION_DAYS: bindings.text("30"),
      REVIEWS_PER_MINUTE: bindings.text("20"),
    },
  },
});
