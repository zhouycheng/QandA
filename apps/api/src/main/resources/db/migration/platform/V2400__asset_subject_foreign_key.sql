ALTER TABLE file_asset ADD CONSTRAINT file_asset_subject_fk
    FOREIGN KEY(subject_id) REFERENCES content_subject(id) ON DELETE RESTRICT;
