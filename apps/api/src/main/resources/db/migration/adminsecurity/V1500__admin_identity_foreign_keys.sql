ALTER TABLE admin_qualification ADD CONSTRAINT admin_qualification_account_fk FOREIGN KEY(account_id) REFERENCES identity_account(id) ON DELETE RESTRICT;
ALTER TABLE admin_command_receipt ADD CONSTRAINT admin_receipt_actor_fk FOREIGN KEY(actor_account_id) REFERENCES identity_account(id) ON DELETE RESTRICT;
ALTER TABLE admin_command_receipt ADD CONSTRAINT admin_receipt_target_fk FOREIGN KEY(target_account_id) REFERENCES identity_account(id) ON DELETE RESTRICT;
ALTER TABLE admin_audit_entry ADD CONSTRAINT admin_audit_actor_fk FOREIGN KEY(actor_account_id) REFERENCES identity_account(id) ON DELETE RESTRICT;
