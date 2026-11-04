export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SCANS: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_DAYS: string;
  REVIEWS_PER_MINUTE: string;
}
