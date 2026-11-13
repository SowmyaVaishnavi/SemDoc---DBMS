-- =====================================================================
--  Index effect: EXPLAIN ANALYZE with and without each index
--  Generates 300 documents x 10 versions (3000 rows) with random vectors
--  inside a transaction, compares plans, then ROLLBACKs (data untouched).
--  Paste the plans and timings into the report.
--      psql -d <db> -f db/tests/02_index_comparison.sql
-- =====================================================================
\timing off
BEGIN;

INSERT INTO documents (title, owner_id)
SELECT 'Bulk doc ' || g, 1 FROM generate_series(1, 300) g;

INSERT INTO document_versions (doc_id, version_number, content_text, content_hash, created_by)
SELECT d.doc_id, v,
       (SELECT string_agg((ARRAY['policy','budget','launch','security','retention','remote','vendor',
                                 'audit','roadmap','onboarding','compliance','backup','review','timeline'])
                          [1 + floor(random()*14)::int], ' ')
        FROM generate_series(1, 25)) || CASE WHEN d.doc_id % 97 = 0 AND v = 3 THEN ' zebrafish' ELSE '' END,
       md5(random()::text) || md5(random()::text),
       1
FROM   documents d, generate_series(1, 10) v
WHERE  d.title LIKE 'Bulk doc %';

INSERT INTO version_embeddings (version_id, embedding_vector, embedding_model)
SELECT dv.version_id,
       (SELECT array_agg(random()::float4 - 0.5) FROM generate_series(1, 384) g WHERE g > 0 OR dv.version_id > 0)::vector(384),
       'bulk-random'
FROM   document_versions dv
WHERE  NOT EXISTS (SELECT 1 FROM version_embeddings e WHERE e.version_id = dv.version_id);

ANALYZE document_versions; ANALYZE version_embeddings;

\echo
\echo '=== 1. B-tree idx_versions_doc_version : latest version of one document ==='
\echo '--- WITH index'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT * FROM document_versions WHERE doc_id = 150 ORDER BY version_number DESC LIMIT 1;
DROP INDEX idx_versions_doc_version;
ALTER TABLE document_versions DROP CONSTRAINT uq_doc_version;   -- its unique index would also serve this query
ANALYZE document_versions;
\echo '--- WITHOUT index (and without the unique constraint index)'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT * FROM document_versions WHERE doc_id = 150 ORDER BY version_number DESC LIMIT 1;

\echo
\echo '=== 2. GIN idx_versions_tsv : keyword search ==='
\echo '--- WITH index'
SET enable_seqscan = off;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT version_id FROM document_versions WHERE content_tsv @@ websearch_to_tsquery('english', 'zebrafish');
RESET enable_seqscan;
DROP INDEX idx_versions_tsv;
\echo '--- WITHOUT index'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT version_id FROM document_versions WHERE content_tsv @@ websearch_to_tsquery('english', 'zebrafish');

\echo
\echo '=== 3. HNSW idx_embeddings_hnsw : 5 nearest versions ==='
\echo '--- WITH index'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT version_id FROM version_embeddings
ORDER BY embedding_vector <=> (SELECT embedding_vector FROM version_embeddings WHERE version_id = 100)
LIMIT 5;
DROP INDEX idx_embeddings_hnsw;
\echo '--- WITHOUT index (exact scan)'
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF)
SELECT version_id FROM version_embeddings
ORDER BY embedding_vector <=> (SELECT embedding_vector FROM version_embeddings WHERE version_id = 100)
LIMIT 5;

ROLLBACK;
