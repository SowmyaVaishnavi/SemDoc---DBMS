#!/bin/bash
# Creates the least-privilege application user (docker-entrypoint-initdb.d runs this
# after the .sql scripts). The password comes from the environment, never from a file.
set -euo pipefail
: "${APP_DB_PASSWORD:?Set APP_DB_PASSWORD in .env.local}"

psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE app_user LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') \gexec

GRANT CONNECT ON DATABASE :"DBNAME" TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
SQL
