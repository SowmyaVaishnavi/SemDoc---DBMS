-- =====================================================================
-- 04  VIEWS
-- =====================================================================

-- Latest version of every document (document list screen)
CREATE VIEW v_latest_version AS
SELECT DISTINCT ON (dv.doc_id)
       dv.doc_id,
       d.title,
       d.owner_id,
       dv.version_id,
       dv.version_number,
       dv.created_by,
       dv.created_at
FROM   document_versions dv
JOIN   documents d ON d.doc_id = dv.doc_id
ORDER  BY dv.doc_id, dv.version_number DESC;

-- Version timeline with author and change score (document page, dashboard)
CREATE VIEW v_change_timeline AS
SELECT d.doc_id,
       d.title,
       sc.change_id,
       vf.version_number  AS from_version,
       vt.version_number  AS to_version,
       sc.similarity_score,
       sc.change_type,
       sc.change_summary,
       (sc.similarity_score < 0.85) AS major_shift,
       u.name             AS author,
       sc.detected_at
FROM   semantic_changes sc
JOIN   document_versions vf ON vf.version_id = sc.from_version_id
JOIN   document_versions vt ON vt.version_id = sc.to_version_id
JOIN   documents d          ON d.doc_id      = vt.doc_id
JOIN   users u              ON u.user_id     = vt.created_by;

-- Most active editors (dashboard)
CREATE VIEW v_user_activity AS
SELECT u.user_id,
       u.name,
       u.role,
       COUNT(DISTINCT dv.version_id) AS versions_created,
       COUNT(DISTINCT c.comment_id)  AS comments_written,
       GREATEST(MAX(dv.created_at), MAX(c.created_at)) AS last_active
FROM   users u
LEFT JOIN document_versions dv ON dv.created_by = u.user_id
LEFT JOIN comments c           ON c.user_id     = u.user_id
GROUP  BY u.user_id, u.name, u.role;
