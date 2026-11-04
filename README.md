# review.rising.sh

Review site for machine transcriptions of handwritten lecture notes. A
reviewer sees the scan beside the text, fixes the text and sends it. No git
knowledge is needed.

Licence: Apache 2.0. Every review is published under it.

## How it works

- A Cloudflare Worker serves the page and the API. D1 holds chunks, reviews and
  accounts. R2 holds the scans, shown only to signed-in users.
- Sign-in is Google or GitHub (OAuth with PKCE). The site keeps an opaque id,
  the provider's display name and the review text.
- Each chunk has a status: `disputed` (two machine readings differ), `blurry`,
  `machine`, or `checked`. The queue serves them in that order.
- A chunk becomes `checked` when two different reviewers submit the same text
  after normalisation (`src/text.ts`). Agreement of the machine readings is not
  accuracy, so no chunk starts `checked`.
- A reviewer is limited to `REVIEWS_PER_MINUTE` reviews.
- An hourly cron (`src/export.ts`) opens one pull request on `TARGET_REPO` with
  every chunk whose status differs from the one last exported
  (`chunks.exported_status`), as `TARGET_DIR/<source>/pXX-cYY.md`. The file
  states the status. Once checked, it lists as reviewers the people whose text
  equals the final one. A `blurry` file carries no text. A batch holds at most
  `BATCH_MAX` files and waits for `BATCH_MIN` changes, or for every chunk to be
  checked. The commit is made through GraphQL `createCommitOnBranch`, which
  GitHub signs; the git-data API would leave it unsigned and `master` requires
  verified signatures. Without `GITHUB_TOKEN` the cron does nothing.

## Layout

- `src/index.ts`: routes. `src/auth.ts`: sign-in. `src/review.ts`: queue and
  submit. `src/schema.sql`: the D1 tables.
- `public/`: the page.
- `cloudflare.config.ts`: bindings and domain.

## Develop

```sh
bun install
bunx tsc --noEmit
bunx vitest run
```

Tests run the real queue and submit code against an in-memory SQLite loaded
with `src/schema.sql` (`test/d1.ts`).

## Deploy

```sh
bunx cf deploy --profile risinghq --secrets-file FILE
```

`FILE` holds `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`, and `GITHUB_TOKEN` for the export: a fine-grained token
with Contents and Pull requests write on `TARGET_REPO`. Pass it only when a secret changes. Each OAuth client
must list `https://review.rising.sh/auth/<provider>/callback`.

## Load chunks

Chunks come from the transcription pipeline. Insert them into `chunks` with
status `machine`, `disputed` or `blurry`, and upload each scan to the R2 bucket
`review-scans` as `<source>/pXX-cYY.png`.
