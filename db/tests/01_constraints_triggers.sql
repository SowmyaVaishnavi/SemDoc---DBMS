-- =====================================================================
--  SQL tests: constraints, triggers, transaction rollback, authorization
--  Run after 01..06 and dev/07 (or the app's seed):
--      psql -d <db> -f db/tests/01_constraints_triggers.sql
--  Every test prints PASS or FAIL. All changes are rolled back.
-- =====================================================================
\set ON_ERROR_STOP off
\echo '--- Constraint tests (each bad insert must be rejected) ---'

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_name TEXT, p_sql TEXT, p_state TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE NOTICE 'FAIL  %  (statement was accepted)', p_name;
    EXCEPTION WHEN OTHERS THEN
        IF p_state IS NULL OR SQLSTATE = p_state THEN
            RAISE NOTICE 'PASS  %  [%]', p_name, SQLERRM;
        ELSE
            RAISE NOTICE 'FAIL  %  (got % instead of %)', p_name, SQLSTATE, p_state;
        END IF;
    END;
END $$;

BEGIN;

-- C1..C6: CHECK constraints (23514), UNIQUE (23505), NOT NULL (23502), FK (23503)
SELECT pg_temp.expect_error('C1 invalid user role',
  $$INSERT INTO users (name,email,password_hash,role) VALUES ('X','x1@example.com','h','Superuser')$$, '23514');
SELECT pg_temp.expect_error('C2 duplicate email',
  $$INSERT INTO users (name,email,password_hash) VALUES ('X','asha@example.com','h')$$, '23505');
SELECT pg_temp.expect_error('C3 invalid access_role',
  $$INSERT INTO document_access (doc_id,user_id,access_role)
    VALUES (4,(SELECT user_id FROM users WHERE email='asha@example.com'),'Boss')$$, '23514');
SELECT pg_temp.expect_error('C4 duplicate (doc, version_number)',
  $$INSERT INTO document_versions (doc_id,version_number,content_text,content_hash,created_by)
    VALUES (1,1,'dup',repeat('a',64),1)$$, '23505');
SELECT pg_temp.expect_error('C5 version_number must be positive',
  $$INSERT INTO document_versions (doc_id,version_number,content_text,content_hash,created_by)
    VALUES (1,0,'zero',repeat('a',64),1)$$, '23514');
SELECT pg_temp.expect_error('C6 content_hash NOT NULL',
  $$INSERT INTO document_versions (doc_id,version_number,content_text,created_by)
    VALUES (1,99,'no hash',1)$$, '23502');
SELECT pg_temp.expect_error('C7 invalid change_type',
  $$INSERT INTO semantic_changes (from_version_id,to_version_id,similarity_score,change_type)
    VALUES (1,2,0.5,'edit')$$, '23514');
SELECT pg_temp.expect_error('C8 similarity above 1',
  $$INSERT INTO semantic_changes (from_version_id,to_version_id,similarity_score,change_type)
    VALUES (1,2,1.5,'rewrite')$$, '23514');
SELECT pg_temp.expect_error('C9 same from and to version',
  $$INSERT INTO semantic_changes (from_version_id,to_version_id,similarity_score,change_type)
    VALUES (1,1,0.9,'rewrite')$$, '23514');
SELECT pg_temp.expect_error('C10 duplicate change pair',
  $$INSERT INTO semantic_changes (from_version_id,to_version_id,similarity_score,change_type)
    VALUES (1,2,0.9,'addition')$$, '23505');
SELECT pg_temp.expect_error('C11 embedding NOT NULL',
  $$INSERT INTO version_embeddings (version_id, embedding_vector) VALUES (1, NULL)$$, '23502');
SELECT pg_temp.expect_error('C12 wrong vector dimension',
  $$UPDATE version_embeddings SET embedding_vector = '[1,2,3]' WHERE version_id = 1$$);
SELECT pg_temp.expect_error('C13 foreign key: document with unknown owner',
  $$INSERT INTO documents (title, owner_id) VALUES ('Ghost', 9999)$$, '23503');
SELECT pg_temp.expect_error('C14 deleting a user who owns documents (RESTRICT)',
  $$DELETE FROM users WHERE email = 'ravi@example.com'$$, '23503');

ROLLBACK;

\echo '--- Trigger tests ---'
BEGIN;
SELECT pg_temp.expect_error('T1 UPDATE on a version is blocked',
  $$UPDATE document_versions SET commit_message = 'tamper' WHERE version_id = 1$$);
SELECT pg_temp.expect_error('T2 direct DELETE of a version is blocked',
  $$DELETE FROM document_versions WHERE version_id = 1$$);
SELECT pg_temp.expect_error('T3 change between versions of different documents',
  $$INSERT INTO semantic_changes (from_version_id,to_version_id,similarity_score,change_type)
    VALUES (1,5,0.5,'rewrite')$$);
ROLLBACK;

-- T4: inserting a version bumps documents.updated_at
BEGIN;
DO $$
DECLARE before_ts TIMESTAMPTZ; after_ts TIMESTAMPTZ;
BEGIN
    SELECT updated_at INTO before_ts FROM documents WHERE doc_id = 3;
    INSERT INTO document_versions (doc_id, version_number, content_text, content_hash, created_by)
    VALUES (3, fn_next_version_number(3), 'Retention is reviewed yearly.', repeat('b',64), 2);
    SELECT updated_at INTO after_ts FROM documents WHERE doc_id = 3;
    RAISE NOTICE '%  T4 new version updates documents.updated_at (% -> %)',
        CASE WHEN after_ts > before_ts THEN 'PASS' ELSE 'FAIL' END, before_ts::date, after_ts::date;
END $$;
ROLLBACK;

-- T5: creating a document adds the Owner access row
BEGIN;
DO $$
DECLARE n INT;
BEGIN
    INSERT INTO documents (title, owner_id) VALUES ('Trigger Test Doc', 2);
    SELECT count(*) INTO n FROM document_access da JOIN documents d USING (doc_id)
    WHERE d.title = 'Trigger Test Doc' AND da.user_id = 2 AND da.access_role = 'Owner';
    RAISE NOTICE '%  T5 owner access row created by trigger', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END;
END $$;
ROLLBACK;

-- T6: deleting a whole document still cascades despite the immutability trigger
BEGIN;
DO $$
DECLARE n INT;
BEGIN
    DELETE FROM documents WHERE doc_id = 2;
    SELECT count(*) INTO n FROM document_versions WHERE doc_id = 2;
    RAISE NOTICE '%  T6 deleting a document cascades to its versions (left: %)',
        CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
ROLLBACK;

\echo '--- Transaction test: a failure midway leaves nothing behind ---'
DO $$
DECLARE n_before INT; n_after INT;
BEGIN
    SELECT count(*) INTO n_before FROM document_versions WHERE doc_id = 4;
    BEGIN
        -- save-version transaction: version row first, then the embedding step fails
        INSERT INTO document_versions (doc_id, version_number, content_text, content_hash, created_by)
        VALUES (4, fn_next_version_number(4), 'Half-saved version', repeat('c',64), 3);
        INSERT INTO version_embeddings (version_id, embedding_vector)
        VALUES (currval('document_versions_version_id_seq'), '[1,2,3]');   -- wrong dimension
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'embedding step failed as forced: %', SQLERRM;
    END;   -- the sub-transaction rolls back both inserts
    SELECT count(*) INTO n_after FROM document_versions WHERE doc_id = 4;
    RAISE NOTICE '%  X1 no version row remains after the failure (% -> %)',
        CASE WHEN n_before = n_after THEN 'PASS' ELSE 'FAIL' END, n_before, n_after;
END $$;

\echo '--- Authorization at the database level (fn_search_versions) ---'
DO $$
DECLARE viewer_docs INT; admin_docs INT; outsider_docs INT;
BEGIN
    -- Kiran (Viewer) has access to docs 1, 2, 4; Asha (Admin) reads everything
    SELECT count(DISTINCT doc_id) INTO viewer_docs
      FROM fn_search_versions(dev_embed('policy plan guide'), (SELECT user_id FROM users WHERE email='kiran@example.com'), 50);
    SELECT count(DISTINCT doc_id) INTO admin_docs
      FROM fn_search_versions(dev_embed('policy plan guide'), (SELECT user_id FROM users WHERE email='asha@example.com'), 50);
    RAISE NOTICE '%  A1 viewer sees only shared documents (%), admin sees all (%)',
        CASE WHEN viewer_docs = 3 AND admin_docs = 4 THEN 'PASS' ELSE 'FAIL' END, viewer_docs, admin_docs;
    SELECT count(DISTINCT doc_id) INTO outsider_docs
      FROM fn_search_versions(dev_embed('retention'), (SELECT user_id FROM users WHERE email='kiran@example.com'), 50)
      WHERE doc_id = 3;
    RAISE NOTICE '%  A2 viewer never receives the unshared "Data Retention Guidelines"',
        CASE WHEN outsider_docs = 0 THEN 'PASS' ELSE 'FAIL' END;
END $$;

\echo '--- Security: only bcrypt hashes are stored ---'
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS s1_all_passwords_are_bcrypt,
       count(*) AS non_bcrypt_rows
FROM   users WHERE password_hash !~ '^\$2[aby]\$\d{2}\$.{53}$';
