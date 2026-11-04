import { bindings, defineConfig } from "cf/config";

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
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "review" }),
      SCANS: bindings.r2({ name: "review-scans" }),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      GITHUB_CLIENT_ID: bindings.secret(),
      GITHUB_CLIENT_SECRET: bindings.secret(),
      SESSION_DAYS: bindings.text("30"),
      REVIEWS_PER_MINUTE: bindings.text("20"),
    },
  },
});
