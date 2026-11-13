-- =====================================================================
-- 05  FUNCTIONS AND TRIGGERS
-- =====================================================================

-- Next version number for a document.
-- Call inside the save-version transaction AFTER locking the document row:
--     SELECT * FROM documents WHERE doc_id = $1 FOR UPDATE;
CREATE OR REPLACE FUNCTION fn_next_version_number(p_doc_id INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(MAX(version_number), 0) + 1
    FROM   document_versions
    WHERE  doc_id = p_doc_id;
$$;

-- Semantic search: nearest versions the user is allowed to read.
-- Admins can read everything; others need a Document_Access row.
CREATE OR REPLACE FUNCTION fn_search_versions(
    p_query_vector  VECTOR(384),
    p_user_id       INTEGER,
    p_k             INTEGER DEFAULT 10
)
RETURNS TABLE (
    version_id      INTEGER,
    doc_id          INTEGER,
    title           VARCHAR,
    version_number  INTEGER,
    similarity      DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    SELECT dv.version_id,
           d.doc_id,
           d.title,
           dv.version_number,
           1 - (ve.embedding_vector <=> p_query_vector) AS similarity
    FROM   version_embeddings ve
    JOIN   document_versions dv ON dv.version_id = ve.version_id
    JOIN   documents d          ON d.doc_id      = dv.doc_id
    WHERE  EXISTS (SELECT 1 FROM users u
                   WHERE u.user_id = p_user_id AND u.role = 'Admin')
        OR EXISTS (SELECT 1 FROM document_access da
                   WHERE da.doc_id = d.doc_id AND da.user_id = p_user_id)
    ORDER  BY ve.embedding_vector <=> p_query_vector
    LIMIT  p_k;
$$;

-- Trigger 1: a new version bumps Documents.updated_at
CREATE OR REPLACE FUNCTION trg_touch_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE documents SET updated_at = now() WHERE doc_id = NEW.doc_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_version_touch_document
AFTER INSERT ON document_versions
FOR EACH ROW EXECUTE FUNCTION trg_touch_document();

-- Trigger 2: version history is immutable.
--   * UPDATE is always blocked.
--   * Direct DELETE is blocked, but deleting a whole document still
--     cascades: during the cascade the parent row is already gone, so
--     the check below lets it through.
CREATE OR REPLACE FUNCTION trg_block_version_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Document versions are immutable (UPDATE blocked)';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM documents WHERE doc_id = OLD.doc_id) THEN
            RAISE EXCEPTION 'Document versions are immutable (direct DELETE blocked)';
        END IF;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_versions_immutable
BEFORE UPDATE OR DELETE ON document_versions
FOR EACH ROW EXECUTE FUNCTION trg_block_version_change();

-- Trigger 3: both versions of a semantic change must belong to the same document
CREATE OR REPLACE FUNCTION trg_check_change_same_doc()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_doc INTEGER;
    v_to_doc   INTEGER;
BEGIN
    SELECT doc_id INTO v_from_doc FROM document_versions WHERE version_id = NEW.from_version_id;
    SELECT doc_id INTO v_to_doc   FROM document_versions WHERE version_id = NEW.to_version_id;

    IF v_from_doc IS DISTINCT FROM v_to_doc THEN
        RAISE EXCEPTION 'Semantic change must link two versions of the same document';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_change_same_doc
BEFORE INSERT OR UPDATE ON semantic_changes
FOR EACH ROW EXECUTE FUNCTION trg_check_change_same_doc();

-- Trigger 4: creating a document adds the matching Owner access row.
-- Documents.owner_id stays the source of truth.
CREATE OR REPLACE FUNCTION trg_add_owner_access()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO document_access (doc_id, user_id, access_role)
    VALUES (NEW.doc_id, NEW.owner_id, 'Owner')
    ON CONFLICT (doc_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_owner_access
AFTER INSERT ON documents
FOR EACH ROW EXECUTE FUNCTION trg_add_owner_access();
