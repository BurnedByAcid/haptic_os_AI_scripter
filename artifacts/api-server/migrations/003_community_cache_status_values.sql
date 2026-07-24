-- Migration: extend allowed cache_status values for community_scripts
-- Adds 'uploading' (reserved slot during an in-progress upload, used by the
-- advisory-lock race guard) and 'skipped' (cap exceeded at reservation time).
-- The existing CHECK constraint must be dropped and recreated because Postgres
-- does not support ALTER CONSTRAINT to change the expression in-place.

ALTER TABLE community_scripts
  DROP CONSTRAINT IF EXISTS community_scripts_cache_status_check;

ALTER TABLE community_scripts
  ADD CONSTRAINT community_scripts_cache_status_check
    CHECK (cache_status IN ('pending', 'uploading', 'cached', 'failed', 'skipped'));
