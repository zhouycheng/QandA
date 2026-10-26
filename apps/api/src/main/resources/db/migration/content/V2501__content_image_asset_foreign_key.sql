ALTER TABLE content_image ADD CONSTRAINT content_image_asset_fk
    FOREIGN KEY(file_id,subject_id) REFERENCES file_asset(id,subject_id) ON DELETE RESTRICT;
