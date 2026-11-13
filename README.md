# Semantic Document Version Change Tracking System

Next.js + PostgreSQL 16 + pgvector. Stores every version of a document and scores how much its
*meaning* changed between versions (cosine similarity of 384-d embeddings).

## Repository layout

```
/db        SQL scripts, queries and tests (this part is complete)
/app       Next.js application (next step)
/docs      ER diagram, report, screenshots
docker-compose.yml, .env.example
```

## Database setup

1. `cp .env.example .env.local` and set the passwords.
2. `docker compose --env-file .env.local up -d` (first start runs `db/01..06`, the dev embeddings
   in `db/dev/07`, and creates `app_user`). The database is on host port **5433**.
3. To rerun from scratch: `docker compose --env-file .env.local down -v`, then `up -d` again.

Without Docker, run in order: `01_schema`, `02_alter`, `03_indexes`, `04_views`,
`05_functions_triggers`, `06_seed`. `99_reset.sql` drops everything for a clean rerun.

| Script | Purpose |
|---|---|
| 01_schema.sql | extension + 9 tables |
| 02_alter.sql | CHECK, NOT NULL, UNIQUE, full-text column |
| 03_indexes.sql | B-tree, GIN, HNSW |
| 04_views.sql | v_latest_version, v_change_timeline, v_user_activity |
| 05_functions_triggers.sql | fn_next_version_number, fn_search_versions, 4 triggers |
| 06_seed.sql | 4 users, 4 documents, 10 versions, tags, access, comments |
| initdb/10_app_user.sh | least-privilege `app_user` (password from env) |
| dev/07_dev_embeddings.sql | DEV ONLY stand-in embeddings and semantic changes |
| queries.sql | 13 important queries mapped to screens |
| tests/01_constraints_triggers.sql | constraint, trigger, transaction, authorization tests |
| tests/02_index_comparison.sql | EXPLAIN ANALYZE with and without each index |
| 99_reset.sql | DROP everything |

New sign-ups get the Editor role: they can create documents (becoming Owner), share them with teammates
as Viewer or Editor, and leave documents shared with them. Admins can set any account to Viewer (read-only) in /admin/users.

Demo accounts (password `Demo@12345`, stored as bcrypt): asha@ (Admin), ravi@ and meera@ (Editor),
kiran@ (Viewer), all `@example.com`. Change or remove before any real deployment.

## Run the tests

```
psql -d semdoc -f db/tests/01_constraints_triggers.sql   # every line should say PASS
psql -d semdoc -f db/tests/02_index_comparison.sql       # plans and timings for the report
```
