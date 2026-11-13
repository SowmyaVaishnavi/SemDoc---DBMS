-- =====================================================================
-- 03  INDEXES
-- =====================================================================

-- Fetch the latest or a given version fast
CREATE INDEX idx_versions_doc_version
    ON document_versions (doc_id, version_number DESC);

-- Speed up foreign-key JOINs
CREATE INDEX idx_comments_version   ON comments  (version_id);
CREATE INDEX idx_documents_owner    ON documents (owner_id);
CREATE INDEX idx_changes_to_version ON semantic_changes (to_version_id);
CREATE INDEX idx_access_user        ON document_access (user_id);
CREATE INDEX idx_doctags_tag        ON document_tags (tag_id);

-- Keyword (full-text) search
CREATE INDEX idx_versions_tsv
    ON document_versions USING GIN (content_tsv);

-- Semantic (vector) search: HNSW, cosine distance
CREATE INDEX idx_embeddings_hnsw
    ON version_embeddings USING hnsw (embedding_vector vector_cosine_ops);
