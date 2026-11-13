-- =====================================================================
-- 01  SCHEMA
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Users ------------------------------------------------------------
CREATE TABLE users (
    user_id        SERIAL        PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    email          VARCHAR(255)  NOT NULL UNIQUE,
    password_hash  VARCHAR(255)  NOT NULL,              -- bcrypt hash only
    role           VARCHAR(10)   NOT NULL DEFAULT 'Viewer',
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 2. Documents --------------------------------------------------------
-- Deleting a user who owns documents is blocked (RESTRICT).
CREATE TABLE documents (
    doc_id       SERIAL        PRIMARY KEY,
    title        VARCHAR(255)  NOT NULL,
    description  TEXT,
    owner_id     INTEGER       NOT NULL
                 REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 3. Document_Versions (weak entity, immutable rows) -------------------
-- Surrogate key version_id, because comments, embeddings and changes
-- all point to it. UNIQUE (doc_id, version_number) keeps the identifying
-- relationship with Documents.
CREATE TABLE document_versions (
    version_id      SERIAL       PRIMARY KEY,
    doc_id          INTEGER      NOT NULL
                    REFERENCES documents(doc_id) ON DELETE CASCADE,
    version_number  INTEGER      NOT NULL,
    content_text    TEXT         NOT NULL,
    content_hash    CHAR(64),                            -- SHA-256 hex; NOT NULL set in 02
    commit_message  VARCHAR(500),
    created_by      INTEGER      NOT NULL
                    REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_doc_version UNIQUE (doc_id, version_number)
);

-- 4. Version_Embeddings (one vector per version) ----------------------
CREATE TABLE version_embeddings (
    embedding_id      SERIAL       PRIMARY KEY,
    version_id        INTEGER      NOT NULL UNIQUE
                      REFERENCES document_versions(version_id) ON DELETE CASCADE,
    embedding_vector  VECTOR(384),                       -- NOT NULL set in 02
    embedding_model   VARCHAR(100) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    generated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 5. Semantic_Changes (change between a version and the one before it) -
CREATE TABLE semantic_changes (
    change_id         SERIAL        PRIMARY KEY,
    from_version_id   INTEGER       NOT NULL
                      REFERENCES document_versions(version_id) ON DELETE CASCADE,
    to_version_id     INTEGER       NOT NULL
                      REFERENCES document_versions(version_id) ON DELETE CASCADE,
    similarity_score  NUMERIC(6,5)  NOT NULL,            -- cosine similarity
    change_type       VARCHAR(10)   NOT NULL,            -- addition | deletion | rewrite
    change_summary    VARCHAR(500),
    detected_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 6. Comments ---------------------------------------------------------
CREATE TABLE comments (
    comment_id    SERIAL       PRIMARY KEY,
    version_id    INTEGER      NOT NULL
                  REFERENCES document_versions(version_id) ON DELETE CASCADE,
    user_id       INTEGER      NOT NULL
                  REFERENCES users(user_id) ON DELETE CASCADE,
    comment_text  TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 7. Tags -------------------------------------------------------------
CREATE TABLE tags (
    tag_id    SERIAL       PRIMARY KEY,
    tag_name  VARCHAR(50)  NOT NULL UNIQUE
);

-- 8. Document_Access (M:N junction User <-> Document) ------------------
CREATE TABLE document_access (
    doc_id       INTEGER      NOT NULL
                 REFERENCES documents(doc_id) ON DELETE CASCADE,
    user_id      INTEGER      NOT NULL
                 REFERENCES users(user_id) ON DELETE CASCADE,
    access_role  VARCHAR(10)  NOT NULL DEFAULT 'Viewer',
    granted_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, user_id)
);

-- 9. Document_Tags (M:N junction Document <-> Tag) --------------------
CREATE TABLE document_tags (
    doc_id  INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(tag_id)      ON DELETE CASCADE,
    PRIMARY KEY (doc_id, tag_id)
);
