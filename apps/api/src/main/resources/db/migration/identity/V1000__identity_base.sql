CREATE TABLE identity_account (
    id uuid PRIMARY KEY,
    account_code varchar(12) COLLATE "C" NOT NULL UNIQUE CHECK (account_code ~ '^QA[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
    nickname varchar(40) NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 40 AND nickname !~ '[[:cntrl:]]'),
    status varchar(8) NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL CHECK (updated_at >= created_at)
);
CREATE INDEX identity_account_page ON identity_account (created_at DESC,id);
CREATE FUNCTION identity_keep_account_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.account_code IS DISTINCT FROM OLD.account_code THEN RAISE EXCEPTION 'Immutable account code'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER identity_account_code_immutable BEFORE UPDATE ON identity_account FOR EACH ROW EXECUTE FUNCTION identity_keep_account_code();

CREATE TABLE identity_email (
    account_id uuid PRIMARY KEY REFERENCES identity_account(id) ON DELETE RESTRICT,
    email varchar(254) NOT NULL,
    email_key varchar(254) COLLATE "C" NOT NULL UNIQUE CHECK (email_key = lower(email_key) AND email_key !~ '[[:cntrl:]]'),
    verified_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE identity_password (
    account_id uuid PRIMARY KEY REFERENCES identity_account(id) ON DELETE RESTRICT,
    encoded_password varchar(256) NOT NULL,
    changed_at timestamptz NOT NULL
);
CREATE TABLE identity_wechat (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES identity_account(id) ON DELETE RESTRICT,
    app_id varchar(64) COLLATE "C" NOT NULL,
    open_id varchar(128) COLLATE "C" NOT NULL,
    union_id varchar(128) COLLATE "C",
    bound_at timestamptz NOT NULL,
    UNIQUE (app_id,open_id), UNIQUE (account_id,app_id)
);
CREATE TABLE identity_auth_session (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES identity_account(id) ON DELETE RESTRICT,
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest)=32),
    credential_version bigint NOT NULL CHECK (credential_version BETWEEN 1 AND 9007199254740991),
    client_type varchar(12) NOT NULL CHECK (client_type IN ('WEB','MINI_PROGRAM','ADMIN_WEB')),
    device_id uuid NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
    last_seen_at timestamptz NOT NULL CHECK (last_seen_at >= issued_at),
    revoked_at timestamptz,
    revocation_reason varchar(32),
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);
CREATE INDEX identity_auth_session_active ON identity_auth_session(account_id,issued_at DESC,id) WHERE revoked_at IS NULL;
CREATE TABLE identity_email_change (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES identity_account(id) ON DELETE RESTRICT,
    old_email_key varchar(254) COLLATE "C" NOT NULL,
    new_email varchar(254) NOT NULL,
    new_email_key varchar(254) COLLATE "C" NOT NULL,
    expected_account_version bigint NOT NULL CHECK (expected_account_version BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    confirmed_at timestamptz,
    invalidated_at timestamptz,
    CHECK (old_email_key <> new_email_key),
    CHECK (confirmed_at IS NULL OR invalidated_at IS NULL)
);
CREATE INDEX identity_email_change_account ON identity_email_change(account_id,created_at DESC);
CREATE TABLE identity_email_challenge (
    id uuid PRIMARY KEY,
    purpose varchar(24) NOT NULL CHECK (purpose IN ('REGISTER','RESET_PASSWORD','BIND_EMAIL','CHANGE_PASSWORD','CHANGE_EMAIL_OLD','CHANGE_EMAIL_NEW')),
    account_id uuid REFERENCES identity_account(id) ON DELETE RESTRICT,
    recipient varchar(254) NOT NULL,
    email_key varchar(254) COLLATE "C" NOT NULL,
    code_mac bytea NOT NULL CHECK (octet_length(code_mac)=32),
    key_version smallint NOT NULL CHECK (key_version > 0),
    credential_version bigint CHECK (credential_version BETWEEN 1 AND 9007199254740991),
    eligible boolean NOT NULL,
    email_change_id uuid REFERENCES identity_email_change(id) ON DELETE RESTRICT,
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    next_send_at timestamptz NOT NULL CHECK (next_send_at > created_at AND next_send_at <= expires_at),
    consumed_at timestamptz,
    invalidated_at timestamptz,
    UNIQUE(email_change_id,purpose),
    CHECK ((email_change_id IS NOT NULL) = (purpose IN ('CHANGE_EMAIL_OLD','CHANGE_EMAIL_NEW'))),
    CHECK (purpose <> 'REGISTER' OR (account_id IS NULL AND credential_version IS NULL)),
    CHECK ((account_id IS NULL) = (credential_version IS NULL)),
    CHECK (purpose IN ('REGISTER','RESET_PASSWORD') OR account_id IS NOT NULL),
    CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);
CREATE INDEX identity_email_challenge_target ON identity_email_challenge(email_key,purpose,created_at DESC);
CREATE INDEX identity_email_challenge_account ON identity_email_challenge(account_id,purpose,created_at DESC);
CREATE TABLE identity_wechat_ticket (
    id uuid PRIMARY KEY,
    ticket_digest bytea NOT NULL UNIQUE CHECK (octet_length(ticket_digest)=32),
    app_id varchar(64) COLLATE "C" NOT NULL,
    open_id varchar(128) COLLATE "C" NOT NULL,
    union_id varchar(128) COLLATE "C",
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    consumed_at timestamptz,
    account_id uuid REFERENCES identity_account(id) ON DELETE RESTRICT,
    CHECK ((consumed_at IS NULL) = (account_id IS NULL))
);
CREATE TABLE identity_command_receipt (
    scope_kind varchar(16) NOT NULL CHECK (scope_kind IN ('ACCOUNT','EMAIL_CHALLENGE','WECHAT_TICKET')),
    scope_id uuid NOT NULL,
    operation varchar(64) NOT NULL,
    command_id uuid NOT NULL,
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
    digest_key_version smallint NOT NULL CHECK (digest_key_version > 0),
    account_id uuid NOT NULL REFERENCES identity_account(id) ON DELETE RESTRICT,
    resulting_credential_version bigint NOT NULL CHECK (resulting_credential_version BETWEEN 1 AND 9007199254740991),
    http_status smallint NOT NULL CHECK (http_status IN (200,201,204)),
    resulting_account_version bigint NOT NULL CHECK (resulting_account_version BETWEEN 1 AND 9007199254740991),
    email_change_id uuid REFERENCES identity_email_change(id) ON DELETE RESTRICT,
    confirmed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > confirmed_at),
    PRIMARY KEY(scope_kind,scope_id,operation,command_id)
);
CREATE TABLE identity_rate_bucket (
    purpose varchar(24) NOT NULL CHECK (purpose IN ('EMAIL_SEND','LOGIN_FAILURE','RECIPIENT_LOOKUP')),
    scope_kind varchar(8) NOT NULL CHECK (scope_kind IN ('EMAIL','ACCOUNT','SOURCE')),
    scope_digest bytea NOT NULL CHECK (octet_length(scope_digest)=32),
    window_started_at timestamptz NOT NULL,
    window_seconds integer NOT NULL CHECK (window_seconds > 0),
    used_count integer NOT NULL CHECK (used_count > 0),
    blocked_until timestamptz,
    limit_audit_event_id uuid,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(purpose,scope_kind,scope_digest,window_started_at),
    CHECK ((blocked_until IS NULL) = (limit_audit_event_id IS NULL))
);
