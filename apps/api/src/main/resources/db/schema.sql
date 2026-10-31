-- QandA 1.0.0：在空的专用数据库中执行。
CREATE TABLE college (
 id uuid PRIMARY KEY, code varchar(40) NOT NULL UNIQUE, name varchar(80) NOT NULL UNIQUE,
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE major (
 id uuid PRIMARY KEY, college_id uuid NOT NULL REFERENCES college(id), code varchar(40) NOT NULL,
 name varchar(80) NOT NULL, status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(college_id,code), UNIQUE(college_id,name)
);
CREATE TABLE user_account (
 id uuid PRIMARY KEY, account_code varchar(12) NOT NULL UNIQUE, nickname varchar(40) NOT NULL,
 email varchar(254), email_key varchar(254) UNIQUE, password_hash varchar(256),
 status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), credential_version bigint NOT NULL DEFAULT 1 CHECK(credential_version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((email IS NULL)=(email_key IS NULL)), CHECK(email_key IS NULL OR email_key=lower(email_key))
);
CREATE TABLE user_profile (
 user_id uuid PRIMARY KEY REFERENCES user_account(id), college_id uuid REFERENCES college(id), major_id uuid REFERENCES major(id),
 enrollment_year integer CHECK(enrollment_year BETWEEN 1900 AND 2200), CHECK(major_id IS NULL OR college_id IS NULL)
);
CREATE INDEX user_profile_major_idx ON user_profile(major_id);
CREATE INDEX user_profile_college_idx ON user_profile(college_id);
CREATE TABLE user_wechat (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_account(id), app_id varchar(64) NOT NULL, open_id varchar(128) NOT NULL,
 union_id varchar(128), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(app_id,open_id), UNIQUE(user_id,app_id)
);
CREATE TABLE admin_account (
 id uuid PRIMARY KEY, username varchar(64) NOT NULL UNIQUE, name varchar(40) NOT NULL, password_hash varchar(256) NOT NULL,
 role varchar(20) NOT NULL CHECK(role IN ('PLATFORM_ADMIN','CONTENT_ADMIN')),
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 credential_version bigint NOT NULL DEFAULT 1 CHECK(credential_version>0), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE TABLE security_policy (
 id integer PRIMARY KEY CHECK(id=1), lock_enabled boolean NOT NULL DEFAULT true, max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 3 AND 10),
 lock_minutes integer NOT NULL DEFAULT 30 CHECK(lock_minutes BETWEEN 1 AND 1440), session_minutes integer NOT NULL DEFAULT 30 CHECK(session_minutes BETWEEN 5 AND 1440),
 min_password_length integer NOT NULL DEFAULT 12 CHECK(min_password_length BETWEEN 12 AND 64), require_letter boolean NOT NULL DEFAULT true,
 require_number boolean NOT NULL DEFAULT true, require_mixed_case boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO security_policy(id) VALUES(1);
CREATE TABLE admin_control (id integer PRIMARY KEY CHECK(id=1), bootstrap_completed_at timestamptz);
INSERT INTO admin_control(id) VALUES(1);
CREATE TABLE user_session (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_account(id), token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 credential_version bigint NOT NULL, client_type varchar(16) NOT NULL CHECK(client_type IN ('WEB','MINI_PROGRAM')), device_id uuid NOT NULL,
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(expires_at>issued_at)
);
CREATE INDEX user_session_account_idx ON user_session(user_id,issued_at DESC);
CREATE TABLE admin_session (
 id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admin_account(id), token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
 credential_version bigint NOT NULL, device_id uuid NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 last_seen_at timestamptz NOT NULL, revoked_at timestamptz, CHECK(expires_at>issued_at)
);
CREATE INDEX admin_session_account_idx ON admin_session(admin_id,issued_at DESC);
CREATE TABLE login_attempt (
 scope_digest bytea PRIMARY KEY CHECK(octet_length(scope_digest)=32), failures integer NOT NULL DEFAULT 0, blocked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_challenge (
 id uuid PRIMARY KEY, user_id uuid REFERENCES user_account(id), purpose varchar(24) NOT NULL CHECK(purpose IN ('REGISTER','RESET_PASSWORD','BIND_EMAIL','CHANGE_PASSWORD','CHANGE_EMAIL_OLD','CHANGE_EMAIL_NEW')),
 email varchar(254) NOT NULL, email_key varchar(254) NOT NULL, code_mac bytea NOT NULL CHECK(octet_length(code_mac)=32), key_version integer NOT NULL,
 eligible boolean NOT NULL, credential_version bigint, failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5), created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, CHECK(expires_at>created_at)
);
CREATE INDEX email_challenge_target_idx ON email_challenge(email_key,purpose,created_at DESC);
CREATE TABLE wechat_ticket (
 id uuid PRIMARY KEY, token_digest bytea NOT NULL UNIQUE, app_id varchar(64) NOT NULL, open_id varchar(128) NOT NULL, union_id varchar(128),
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE subject (
 id uuid PRIMARY KEY, name varchar(120) NOT NULL UNIQUE, description text NOT NULL DEFAULT '',
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE question_bank (
 id uuid PRIMARY KEY, subject_id uuid NOT NULL REFERENCES subject(id), name varchar(120) NOT NULL, description text NOT NULL DEFAULT '', textbook varchar(500) NOT NULL DEFAULT '',
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
 publication_status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK(publication_status IN ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED')),
 scope_type varchar(12) NOT NULL DEFAULT 'ALL' CHECK(scope_type IN ('ALL','TARGETED')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 content_version bigint NOT NULL DEFAULT 1 CHECK(content_version>0), created_by uuid NOT NULL REFERENCES admin_account(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,subject_id)
);
CREATE INDEX question_bank_subject_idx ON question_bank(subject_id,publication_status,status);
CREATE TABLE bank_maintainer (
 bank_id uuid NOT NULL REFERENCES question_bank(id), admin_id uuid NOT NULL REFERENCES admin_account(id), PRIMARY KEY(bank_id,admin_id)
);
CREATE INDEX bank_maintainer_admin_idx ON bank_maintainer(admin_id,bank_id);
CREATE TABLE bank_audience (
 id uuid PRIMARY KEY, bank_id uuid NOT NULL REFERENCES question_bank(id), college_id uuid REFERENCES college(id), major_id uuid REFERENCES major(id),
 enrollment_year integer CHECK(enrollment_year BETWEEN 1900 AND 2200), CHECK(major_id IS NULL OR college_id IS NULL),
 CHECK(num_nonnulls(college_id,major_id,enrollment_year)>0), UNIQUE NULLS NOT DISTINCT(bank_id,college_id,major_id,enrollment_year)
);
CREATE TABLE chapter (
 id uuid PRIMARY KEY, bank_id uuid NOT NULL REFERENCES question_bank(id), name varchar(120) NOT NULL, sort_order integer NOT NULL CHECK(sort_order>=0),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(id,bank_id), UNIQUE(bank_id,sort_order) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE question (
 id uuid PRIMARY KEY, bank_id uuid NOT NULL REFERENCES question_bank(id), chapter_id uuid, status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
 current_revision_id uuid NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(chapter_id,bank_id) REFERENCES chapter(id,bank_id), UNIQUE(id,bank_id)
);
CREATE INDEX question_bank_idx ON question(bank_id,status,created_at,id);
CREATE INDEX question_chapter_idx ON question(chapter_id);
CREATE TABLE question_revision (
 id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES question(id) DEFERRABLE INITIALLY DEFERRED, revision_number integer NOT NULL CHECK(revision_number>0),
 type varchar(20) NOT NULL CHECK(type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER')), stem text NOT NULL,
 explanation text NOT NULL DEFAULT '', correct_value boolean, reference_answer text,
 created_by uuid NOT NULL REFERENCES admin_account(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((type='TRUE_FALSE')=(correct_value IS NOT NULL)), CHECK((type='SHORT_ANSWER')=(reference_answer IS NOT NULL)),
 UNIQUE(question_id,id), UNIQUE(question_id,revision_number)
);
ALTER TABLE question ADD CONSTRAINT question_current_revision_fk FOREIGN KEY(id,current_revision_id) REFERENCES question_revision(question_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE question_option (
 revision_id uuid NOT NULL REFERENCES question_revision(id), option_key varchar(8) NOT NULL, content text NOT NULL, is_correct boolean NOT NULL, sort_order integer NOT NULL,
 PRIMARY KEY(revision_id,option_key), UNIQUE(revision_id,sort_order)
);
CREATE TABLE file_asset (
 id uuid PRIMARY KEY, bank_id uuid NOT NULL REFERENCES question_bank(id), uploaded_by uuid NOT NULL REFERENCES admin_account(id), storage_key varchar(128) NOT NULL UNIQUE,
 sha256 varchar(64) NOT NULL, media_type varchar(32) NOT NULL CHECK(media_type='image/png'), size_bytes bigint NOT NULL CHECK(size_bytes>0),
 width_pixels integer NOT NULL CHECK(width_pixels>0), height_pixels integer NOT NULL CHECK(height_pixels>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_asset_bank_idx ON file_asset(bank_id);
CREATE TABLE question_attachment (revision_id uuid NOT NULL REFERENCES question_revision(id), file_id uuid NOT NULL REFERENCES file_asset(id), PRIMARY KEY(revision_id,file_id));
CREATE TABLE user_subject (
 user_id uuid NOT NULL REFERENCES user_account(id), subject_id uuid NOT NULL REFERENCES subject(id), preferred_bank_id uuid,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0), added_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(user_id,subject_id), FOREIGN KEY(preferred_bank_id,subject_id) REFERENCES question_bank(id,subject_id)
);
CREATE TABLE user_favorite (user_id uuid NOT NULL REFERENCES user_account(id), question_id uuid NOT NULL REFERENCES question(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,question_id));
CREATE TABLE practice_session (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_account(id), bank_id uuid NOT NULL REFERENCES question_bank(id),
 selection_kind varchar(12) NOT NULL CHECK(selection_kind IN ('NORMAL','WRONG','FAVORITE')), question_order varchar(12) NOT NULL CHECK(question_order IN ('SEQUENTIAL','RANDOM')),
 client_type varchar(16) NOT NULL CHECK(client_type IN ('WEB','MINI_PROGRAM')),
 feedback varchar(16) NOT NULL CHECK(feedback IN ('IMMEDIATE','AFTER_FINISH')), status varchar(16) NOT NULL CHECK(status IN ('IN_PROGRESS','SUBMITTED','CANCELLED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), current_index integer NOT NULL DEFAULT 0 CHECK(current_index>=0), duration_seconds integer NOT NULL DEFAULT 0 CHECK(duration_seconds>=0),
 configuration_snapshot text NOT NULL, writer_device_id uuid, writer_token uuid, pending_writer_device_id uuid,
 acknowledged_sequence bigint NOT NULL DEFAULT 0 CHECK(acknowledged_sequence>=0), CHECK((writer_device_id IS NULL)=(writer_token IS NULL)),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz, UNIQUE(id,user_id), CHECK((status='SUBMITTED')=(submitted_at IS NOT NULL))
);
CREATE INDEX practice_active_bank_idx ON practice_session(user_id,bank_id) WHERE status='IN_PROGRESS';
CREATE INDEX practice_history_idx ON practice_session(user_id,submitted_at DESC,id) WHERE status='SUBMITTED';
CREATE INDEX practice_recent_idx ON practice_session(user_id,updated_at DESC,id);
CREATE INDEX practice_statistics_idx ON practice_session(submitted_at,user_id) WHERE status='SUBMITTED';
CREATE TABLE practice_item (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES practice_session(id), question_id uuid NOT NULL, revision_id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=0), answer_text text, answer_boolean boolean, confirmed boolean NOT NULL DEFAULT false, marked boolean NOT NULL DEFAULT false,
 outcome varchar(12) CHECK(outcome IN ('CORRECT','WRONG','UNANSWERED','SELF_RATED')), self_assessment varchar(12) CHECK(self_assessment IN ('CORRECT','WRONG')),
 FOREIGN KEY(question_id,revision_id) REFERENCES question_revision(question_id,id), UNIQUE(session_id,position), UNIQUE(session_id,question_id), UNIQUE(id,revision_id)
);
CREATE INDEX practice_item_question_idx ON practice_item(question_id,session_id);
CREATE TABLE practice_item_choice (
 item_id uuid NOT NULL, revision_id uuid NOT NULL, option_key varchar(8) NOT NULL,
 PRIMARY KEY(item_id,option_key), FOREIGN KEY(item_id,revision_id) REFERENCES practice_item(id,revision_id), FOREIGN KEY(revision_id,option_key) REFERENCES question_option(revision_id,option_key)
);
CREATE TABLE practice_result (
 id uuid PRIMARY KEY, session_id uuid NOT NULL UNIQUE REFERENCES practice_session(id), total_count integer NOT NULL CHECK(total_count>0),
 objective_count integer NOT NULL, answered_count integer NOT NULL, correct_count integer NOT NULL, wrong_count integer NOT NULL, unanswered_count integer NOT NULL,
 short_answer_count integer NOT NULL, duration_seconds integer NOT NULL CHECK(duration_seconds>=0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(objective_count=correct_count+wrong_count+unanswered_count), CHECK(total_count=objective_count+short_answer_count)
);
CREATE TABLE question_feedback (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_account(id), question_id uuid NOT NULL, revision_id uuid NOT NULL,
 category varchar(24) NOT NULL CHECK(category IN ('ANSWER','EXPLANATION','STEM_OPTIONS','OTHER')), body text NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED')), response text NOT NULL DEFAULT '',
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(question_id,revision_id) REFERENCES question_revision(question_id,id)
);
CREATE INDEX question_feedback_queue_idx ON question_feedback(status,created_at DESC);
CREATE TABLE course_request (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_account(id), course_name varchar(120) NOT NULL, major_id uuid REFERENCES major(id), body text NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED')), response text NOT NULL DEFAULT '', version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE announcement (
 id uuid PRIMARY KEY, title varchar(120) NOT NULL, summary varchar(500) NOT NULL, body text NOT NULL,
 audience varchar(12) NOT NULL CHECK(audience IN ('ALL','SELECTED')), status varchar(16) NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','SCHEDULED')),
 publish_at timestamptz, version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES admin_account(id), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'SCHEDULED' OR publish_at IS NOT NULL)
);
CREATE TABLE announcement_platform (announcement_id uuid NOT NULL REFERENCES announcement(id), platform varchar(16) NOT NULL CHECK(platform IN ('WEB','MINI_PROGRAM')), PRIMARY KEY(announcement_id,platform));
CREATE TABLE announcement_recipient (announcement_id uuid NOT NULL REFERENCES announcement(id), user_id uuid NOT NULL REFERENCES user_account(id), PRIMARY KEY(announcement_id,user_id));
CREATE TABLE user_activity (
 user_id uuid NOT NULL REFERENCES user_account(id), platform varchar(16) NOT NULL CHECK(platform IN ('WEB','MINI_PROGRAM')), activity_date date NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,platform,activity_date)
);
CREATE TABLE mail_delivery (
 id uuid PRIMARY KEY, challenge_id uuid NOT NULL UNIQUE REFERENCES email_challenge(id), template_code varchar(40) NOT NULL, template_version integer NOT NULL,
 ciphertext text NOT NULL, nonce text NOT NULL, key_version integer NOT NULL, expires_at timestamptz NOT NULL,
 state varchar(24) NOT NULL CHECK(state IN ('PENDING','SENDING','ACCEPTED','RETRYABLE_FAILED','PERMANENT_FAILED','UNKNOWN','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_id uuid, leased_at timestamptz, provider_message_id varchar(256), error_code varchar(64), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_delivery_pending_idx ON mail_delivery(state,next_attempt_at);
CREATE TABLE command_receipt (
 id uuid PRIMARY KEY, scope varchar(100) NOT NULL, operation varchar(200) NOT NULL, command_id uuid NOT NULL,
 actor_user_id uuid REFERENCES user_account(id), actor_admin_id uuid REFERENCES admin_account(id), payload_digest bytea NOT NULL, digest_key_version integer NOT NULL,
 response_json text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope,operation,command_id), CHECK(num_nonnulls(actor_user_id,actor_admin_id)<=1)
);
CREATE TABLE audit_log (
 id uuid PRIMARY KEY, actor_user_id uuid REFERENCES user_account(id), actor_admin_id uuid REFERENCES admin_account(id), operation varchar(200) NOT NULL,
 request_id uuid NOT NULL, outcome varchar(12) NOT NULL CHECK(outcome IN ('SUCCESS','FAILURE')), reason_code varchar(64), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(actor_user_id,actor_admin_id)<=1)
);
CREATE INDEX audit_log_page_idx ON audit_log(created_at DESC,id);
CREATE INDEX email_challenge_user_idx ON email_challenge(user_id);
CREATE INDEX question_bank_creator_idx ON question_bank(created_by);
CREATE INDEX question_bank_listing_idx ON question_bank(publication_status,status,name,id);
CREATE INDEX bank_audience_college_idx ON bank_audience(college_id);
CREATE INDEX bank_audience_major_idx ON bank_audience(major_id);
CREATE INDEX question_revision_creator_idx ON question_revision(created_by);
CREATE INDEX file_asset_uploader_idx ON file_asset(uploaded_by);
CREATE INDEX question_attachment_file_idx ON question_attachment(file_id);
CREATE INDEX user_subject_subject_idx ON user_subject(subject_id);
CREATE INDEX user_subject_bank_idx ON user_subject(preferred_bank_id,subject_id);
CREATE INDEX user_subject_order_idx ON user_subject(user_id,sort_order,added_at DESC,subject_id);
CREATE INDEX user_favorite_question_idx ON user_favorite(question_id);
CREATE INDEX user_favorite_order_idx ON user_favorite(user_id,created_at DESC,question_id);
CREATE INDEX practice_session_bank_idx ON practice_session(bank_id);
CREATE INDEX practice_item_revision_idx ON practice_item(question_id,revision_id);
CREATE INDEX practice_item_choice_revision_idx ON practice_item_choice(revision_id,option_key);
CREATE INDEX question_feedback_revision_idx ON question_feedback(question_id,revision_id);
CREATE INDEX question_feedback_user_idx ON question_feedback(user_id,created_at DESC,id);
CREATE INDEX course_request_user_idx ON course_request(user_id,created_at DESC,id);
CREATE INDEX course_request_major_idx ON course_request(major_id);
CREATE INDEX course_request_queue_idx ON course_request(status,created_at DESC,id);
CREATE INDEX announcement_creator_idx ON announcement(created_by);
CREATE INDEX announcement_display_idx ON announcement(status,publish_at,updated_at DESC,id);
CREATE INDEX announcement_recipient_user_idx ON announcement_recipient(user_id,announcement_id);
CREATE INDEX user_activity_date_idx ON user_activity(activity_date,platform,user_id);
CREATE INDEX command_receipt_user_idx ON command_receipt(actor_user_id);
CREATE INDEX command_receipt_admin_idx ON command_receipt(actor_admin_id);
CREATE INDEX audit_log_user_idx ON audit_log(actor_user_id);
CREATE INDEX audit_log_admin_idx ON audit_log(actor_admin_id);
CREATE FUNCTION keep_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Historical facts are immutable'; END $$;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON question_revision FOR EACH ROW EXECUTE FUNCTION keep_history_immutable();
CREATE TRIGGER option_immutable BEFORE UPDATE OR DELETE ON question_option FOR EACH ROW EXECUTE FUNCTION keep_history_immutable();
CREATE TRIGGER attachment_immutable BEFORE UPDATE OR DELETE ON question_attachment FOR EACH ROW EXECUTE FUNCTION keep_history_immutable();
CREATE TRIGGER result_immutable BEFORE UPDATE OR DELETE ON practice_result FOR EACH ROW EXECUTE FUNCTION keep_history_immutable();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION keep_history_immutable();
