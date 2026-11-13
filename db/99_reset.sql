-- =====================================================================
-- 99  RESET  (uncomment to wipe everything and rerun from section 01)
-- =====================================================================

DROP VIEW     IF EXISTS v_user_activity, v_change_timeline, v_latest_version;
DROP FUNCTION IF EXISTS fn_search_versions(VECTOR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS fn_next_version_number(INTEGER);
DROP TABLE    IF EXISTS document_tags, document_access, comments,
                        semantic_changes, version_embeddings,
                        document_versions, documents, tags, users CASCADE;
DROP FUNCTION IF EXISTS trg_touch_document(), trg_block_version_change(),
                        trg_check_change_same_doc(), trg_add_owner_access();
DROP EXTENSION IF EXISTS vector;
