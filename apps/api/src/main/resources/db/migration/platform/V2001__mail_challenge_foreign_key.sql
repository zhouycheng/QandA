ALTER TABLE mail_delivery ADD CONSTRAINT mail_delivery_identity_challenge_fk
    FOREIGN KEY(challenge_id) REFERENCES identity_email_challenge(id) ON DELETE RESTRICT;
