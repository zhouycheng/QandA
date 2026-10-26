ALTER TABLE content_subject ADD CONSTRAINT content_user_owner_required
    CHECK(source <> 'USER' OR (owner_account_id IS NOT NULL AND owner_account_id=created_by));
