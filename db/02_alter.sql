-- =====================================================================
-- 02  ALTER  (constraints and the search column)
--     Delete rules (CASCADE / RESTRICT) are declared in section 01.
-- =====================================================================

-- CHECK constraints
ALTER TABLE users
    ADD CONSTRAINT chk_users_role
    CHECK (role IN ('Admin', 'Editor', 'Viewer'));

ALTER TABLE document_access
    ADD CONSTRAINT chk_access_role
    CHECK (access_role IN ('Owner', 'Editor', 'Viewer'));

ALTER TABLE document_versions
    ADD CONSTRAINT chk_version_number_positive
    CHECK (version_number > 0);

ALTER TABLE semantic_changes
    ADD CONSTRAINT chk_change_type
    CHECK (change_type IN ('addition', 'deletion', 'rewrite'));

ALTER TABLE semantic_changes
    ADD CONSTRAINT chk_similarity_range
    CHECK (similarity_score BETWEEN -1 AND 1);

ALTER TABLE semantic_changes
    ADD CONSTRAINT chk_different_versions
    CHECK (from_version_id <> to_version_id);

-- Tighten columns
ALTER TABLE document_versions
    ALTER COLUMN content_hash SET NOT NULL;

ALTER TABLE version_embeddings
    ALTER COLUMN embedding_vector SET NOT NULL;

ALTER TABLE semantic_changes
    ADD CONSTRAINT uq_change_pair UNIQUE (from_version_id, to_version_id);

-- Full-text search column (generated, always in sync with content_text)
ALTER TABLE document_versions
    ADD COLUMN content_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content_text, ''))) STORED;
