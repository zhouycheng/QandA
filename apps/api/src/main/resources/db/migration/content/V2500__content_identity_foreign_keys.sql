ALTER TABLE content_subject ADD FOREIGN KEY(owner_account_id) REFERENCES identity_account(id), ADD FOREIGN KEY(created_by) REFERENCES identity_account(id);
ALTER TABLE content_question_revision ADD FOREIGN KEY(created_by) REFERENCES identity_account(id);
ALTER TABLE content_import_batch ADD FOREIGN KEY(created_by) REFERENCES identity_account(id);
ALTER TABLE content_command_receipt ADD FOREIGN KEY(actor_account_id) REFERENCES identity_account(id);
