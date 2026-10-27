ALTER TABLE authz_subject_policy
  ADD CONSTRAINT authz_subject_policy_content_fk
  FOREIGN KEY (subject_id) REFERENCES content_subject(id) ON DELETE RESTRICT;
