-- =====================================================================
--  queries.sql : important queries, mapped to screens (plan section 5.2)
--  Run after 01..06 (and dev/07 if the app's embedding pipeline has not
--  filled version_embeddings / semantic_changes yet).
--  Write examples sit inside BEGIN ... ROLLBACK so the data is unchanged.
-- =====================================================================

-- Q1  Create a document and its version 1 in one transaction ---------------
--     Screen: New document.  Techniques: INSERT, transaction, FOR UPDATE, function.
BEGIN;
    INSERT INTO documents (title, description, owner_id)
    VALUES ('Security Checklist', 'Quarterly review items',
            (SELECT user_id FROM users WHERE email = 'ravi@example.com'));

    SELECT * FROM documents WHERE title = 'Security Checklist' FOR UPDATE;

    INSERT INTO document_versions (doc_id, version_number, content_text, content_hash,
                                   commit_message, created_by)
    SELECT d.doc_id, fn_next_version_number(d.doc_id), 'Rotate keys every quarter.',
           encode(sha256(convert_to('Rotate keys every quarter.', 'UTF8')), 'hex'),
           'Initial version', d.owner_id
    FROM   documents d WHERE d.title = 'Security Checklist';

    -- the trigger already created the Owner access row:
    SELECT d.title, da.access_role, u.name
    FROM   documents d
    JOIN   document_access da ON da.doc_id = d.doc_id
    JOIN   users u            ON u.user_id = da.user_id
    WHERE  d.title = 'Security Checklist';
ROLLBACK;

-- Q2  Edit title/description and an access role ------------------------------
--     Screen: Document settings.  Technique: UPDATE.
BEGIN;
    UPDATE documents
    SET    title = 'Remote Work Policy (2026)', description = 'Updated description'
    WHERE  title = 'Remote Work Policy';

    UPDATE document_access
    SET    access_role = 'Editor'
    WHERE  user_id = (SELECT user_id FROM users WHERE email = 'kiran@example.com')
      AND  doc_id  = (SELECT doc_id FROM documents WHERE title = 'Remote Work Policy (2026)');
ROLLBACK;

-- Q3  Remove a comment, a tag link and a whole document -------------------------
--     Screen: Document page.  Technique: DELETE, ON DELETE CASCADE.
BEGIN;
    DELETE FROM comments
    WHERE  comment_text LIKE 'Thanks for adding%';

    DELETE FROM document_tags
    WHERE  doc_id = (SELECT doc_id FROM documents WHERE title = 'Onboarding Handbook');

    -- cascades to versions, embeddings, changes, comments, tags, access
    DELETE FROM documents WHERE title = 'Product Launch Plan';
    SELECT count(*) AS versions_left FROM document_versions;
ROLLBACK;

-- Q4  Version timeline with author and change score -----------------------------
--     Screen: Document page.  Technique: JOIN across 4+ tables, ORDER BY.
SELECT d.title, vt.version_number, u.name AS author, vt.commit_message,
       sc.change_type, sc.similarity_score, vt.created_at
FROM   document_versions vt
JOIN   documents d              ON d.doc_id = vt.doc_id
JOIN   users u                  ON u.user_id = vt.created_by
LEFT   JOIN semantic_changes sc ON sc.to_version_id = vt.version_id
WHERE  d.title = 'Remote Work Policy'
ORDER  BY vt.version_number;

-- Same data from the view, with the major-shift flag:
SELECT * FROM v_change_timeline WHERE title = 'Remote Work Policy' ORDER BY to_version;

-- Q5  Documents per tag; tags used by at least 2 documents --------------------------
--     Screen: Document list filter.  Technique: GROUP BY, HAVING, COUNT.
SELECT t.tag_name, COUNT(*) AS documents
FROM   tags t
JOIN   document_tags dt ON dt.tag_id = t.tag_id
GROUP  BY t.tag_name
HAVING COUNT(*) >= 2
ORDER  BY documents DESC, t.tag_name;

-- Q6  Most active editors -----------------------------------------------------------
--     Screen: Dashboard.  Technique: aggregates, GROUP BY (view), ORDER BY.
SELECT name, role, versions_created, comments_written, last_active
FROM   v_user_activity
ORDER  BY versions_created DESC, comments_written DESC;

-- Q7  Documents whose latest change scored below 0.85 -------------------------------
--     Screen: Dashboard.  Technique: subquery + view.
SELECT lv.title, lv.version_number AS latest_version, sc.similarity_score, sc.change_type
FROM   v_latest_version lv
JOIN   semantic_changes sc ON sc.to_version_id = lv.version_id
WHERE  sc.similarity_score < 0.85
ORDER  BY sc.similarity_score;

-- Q8  Documents not edited for 30 days ------------------------------------------------
--     Screen: Dashboard.  Technique: NOT EXISTS correlated subquery.
SELECT d.title, d.updated_at
FROM   documents d
WHERE  NOT EXISTS (SELECT 1 FROM document_versions v
                   WHERE  v.doc_id = d.doc_id
                     AND  v.created_at > now() - INTERVAL '30 days')
ORDER  BY d.updated_at;

-- Q9  Average similarity per document ----------------------------------------------------
--     Screen: Dashboard.  Technique: AVG, JOIN, GROUP BY.
SELECT d.title,
       COUNT(sc.change_id)                  AS changes,
       ROUND(AVG(sc.similarity_score), 3)   AS avg_similarity,
       MIN(sc.similarity_score)             AS lowest_similarity
FROM   documents d
JOIN   document_versions vt ON vt.doc_id = d.doc_id
JOIN   semantic_changes sc  ON sc.to_version_id = vt.version_id
GROUP  BY d.doc_id, d.title
ORDER  BY avg_similarity;

-- Q10 Keyword (full-text) search, ranked --------------------------------------------------
--     Screen: Documents search box.  Technique: GIN index, tsvector, ts_rank.
SELECT d.title, dv.version_number,
       ts_rank(dv.content_tsv, q) AS rank,
       ts_headline('english', dv.content_text, q) AS snippet
FROM   document_versions dv
JOIN   documents d ON d.doc_id = dv.doc_id,
       websearch_to_tsquery('english', 'internet allowance') AS q
WHERE  dv.content_tsv @@ q
ORDER  BY rank DESC;

-- Q11 Semantic search (vector similarity, only documents the user may read) -----------------
--     Screen: Semantic search.  Technique: pgvector <=> cosine, stored function.
--     In the app, p_query_vector is the real MiniLM embedding of the query text.
--     dev_embed() exists only after dev/07 and is a stand-in for trying it out.
SELECT * FROM fn_search_versions(
           dev_embed('monthly internet allowance for remote staff'),
           (SELECT user_id FROM users WHERE email = 'kiran@example.com'),   -- Viewer
           5);

-- Q12 Versions related to a given version -------------------------------------------------------
--     Screen: Version page, "related versions".  Technique: self-join on vectors.
SELECT d2.title, v2.version_number,
       ROUND((1 - (e2.embedding_vector <=> e1.embedding_vector))::numeric, 3) AS similarity
FROM   version_embeddings e1
JOIN   version_embeddings e2 ON e2.version_id <> e1.version_id
JOIN   document_versions v1  ON v1.version_id = e1.version_id
JOIN   document_versions v2  ON v2.version_id = e2.version_id
JOIN   documents d2          ON d2.doc_id = v2.doc_id
WHERE  v1.version_id = (SELECT version_id FROM document_versions
                        WHERE doc_id = (SELECT doc_id FROM documents WHERE title = 'Remote Work Policy')
                        AND version_number = 2)
  AND  v2.doc_id <> v1.doc_id
ORDER  BY e2.embedding_vector <=> e1.embedding_vector
LIMIT  3;

-- Q13 Latest version of every document -------------------------------------------------------------
--     Screen: Documents list.  Technique: view with DISTINCT ON.
SELECT title, version_number, created_at FROM v_latest_version ORDER BY title;
