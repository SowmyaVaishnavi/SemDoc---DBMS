-- =====================================================================
--  07  DEV-ONLY EMBEDDINGS AND SEMANTIC CHANGES
--
--  Lets you run every query in queries.sql BEFORE the Next.js embedding
--  module exists. dev_embed() is a crude hashed bag-of-words vector, NOT
--  all-MiniLM-L6-v2: it only captures shared words, not real meaning.
--  Rows are tagged embedding_model = 'dev-hashed-bow'. The real pipeline
--  (app/lib/embedding + save-version transaction) replaces them.
--  The 0.85 "major shift" threshold is tuned for MiniLM, not for these.
--  Never run this in a deployment that uses real embeddings.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION dev_embed(p_text TEXT)
RETURNS VECTOR(384)
LANGUAGE sql
IMMUTABLE
AS $$
    WITH words AS (
        SELECT w
        FROM   regexp_split_to_table(lower(p_text), '[^a-z]+') AS w
        WHERE  length(w) > 3
    ),
    buckets AS (
        SELECT abs(hashtext(w)) % 384 AS i, count(*)::float8 AS c
        FROM   words GROUP BY 1
    ),
    dense AS (
        SELECT array_agg(COALESCE(b.c, 0) ORDER BY g.i) AS arr
        FROM   generate_series(0, 383) AS g(i)
        LEFT JOIN buckets b ON b.i = g.i
    )
    SELECT (
        '[' || array_to_string(
                  ARRAY(SELECT x / NULLIF(sqrt((SELECT sum(y * y) FROM unnest(arr) AS y)), 0)
                        FROM unnest(arr) AS x), ',') || ']'
    )::vector(384)
    FROM dense;
$$;

-- One embedding per version
INSERT INTO version_embeddings (version_id, embedding_vector, embedding_model)
SELECT version_id, dev_embed(content_text), 'dev-hashed-bow'
FROM   document_versions
ON CONFLICT (version_id) DO NOTHING;

-- Semantic change between every version and the one before it.
-- Label rule from the plan: only lines added -> addition, only lines
-- removed -> deletion, both -> rewrite.
INSERT INTO semantic_changes
        (from_version_id, to_version_id, similarity_score, change_type, change_summary)
SELECT prev.version_id,
       cur.version_id,
       round((1 - (pe.embedding_vector <=> ce.embedding_vector))::numeric, 5),
       CASE WHEN n.added > 0 AND n.removed = 0 THEN 'addition'
            WHEN n.removed > 0 AND n.added = 0 THEN 'deletion'
            ELSE 'rewrite' END,
       format('%s lines added, %s removed, similarity %s',
              n.added, n.removed,
              round((1 - (pe.embedding_vector <=> ce.embedding_vector))::numeric, 2))
FROM   document_versions cur
JOIN   document_versions prev
       ON prev.doc_id = cur.doc_id AND prev.version_number = cur.version_number - 1
JOIN   version_embeddings ce ON ce.version_id = cur.version_id
JOIN   version_embeddings pe ON pe.version_id = prev.version_id
CROSS  JOIN LATERAL (
        SELECT (SELECT count(*) FROM (SELECT unnest(string_to_array(cur.content_text,  E'\n'))
                                      EXCEPT
                                      SELECT unnest(string_to_array(prev.content_text, E'\n'))) a) AS added,
               (SELECT count(*) FROM (SELECT unnest(string_to_array(prev.content_text, E'\n'))
                                      EXCEPT
                                      SELECT unnest(string_to_array(cur.content_text,  E'\n'))) r) AS removed
) n
ON CONFLICT (from_version_id, to_version_id) DO NOTHING;

COMMIT;
