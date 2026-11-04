-- Schema of the D1 database (binding DB). There are no migrations: to change it,
-- drop the database, create another and apply this file.
-- Times are Unix seconds. A user stores an opaque id, the provider subject and
-- the display name the provider gave. No email.

CREATE TABLE users (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  subject  TEXT NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
) WITHOUT ROWID;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

-- One row per scan crop. `text` and `alt` are the machine passes A and B.
-- `status` follows the store in git: machine, disputed, blurry, checked.
CREATE TABLE chunks (
  id        TEXT PRIMARY KEY,          -- source/pXX-cYY
  source    TEXT NOT NULL,
  page      INTEGER NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('machine', 'disputed', 'blurry', 'checked')),
  text      TEXT NOT NULL,
  alt       TEXT,
  sharpness REAL NOT NULL,
  agreement REAL NOT NULL,
  exported_status TEXT                 -- status last carried to git by a pull request
) WITHOUT ROWID;

-- A review is a person's final text for a chunk. `choice` records whether they
-- took pass A, pass B or typed their own. A chunk becomes `checked` when two
-- different people submit the same normalised text.
CREATE TABLE reviews (
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  choice   TEXT NOT NULL CHECK (choice IN ('a', 'b', 'edit')),
  created  INTEGER NOT NULL,
  PRIMARY KEY (chunk_id, user_id)
) WITHOUT ROWID;

CREATE INDEX chunks_queue ON chunks (status, source, page);
