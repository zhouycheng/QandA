CREATE TABLE admin_control (
    singleton_id smallint PRIMARY KEY CHECK (singleton_id=1),
    bootstrap_completed_at timestamptz
);
INSERT INTO admin_control(singleton_id) VALUES (1);

CREATE TABLE admin_qualification (
    account_id uuid PRIMARY KEY,
    qualified boolean NOT NULL DEFAULT true,
    version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    granted_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CHECK ((qualified AND revoked_at IS NULL) OR (NOT qualified AND revoked_at IS NOT NULL AND revoked_at >= granted_at)),
    CHECK (granted_at >= created_at AND updated_at >= granted_at)
);
CREATE INDEX admin_qualification_active ON admin_qualification(account_id) WHERE qualified;
CREATE INDEX admin_qualification_page ON admin_qualification(created_at DESC,account_id);

CREATE TABLE admin_command_receipt (
    id uuid PRIMARY KEY,
    actor_account_id uuid NOT NULL,
    operation varchar(40) NOT NULL CHECK (operation IN ('SET_QUALIFICATION','SET_ACCOUNT_STATUS')),
    command_request_id uuid NOT NULL,
    target_account_id uuid NOT NULL,
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
    digest_key_version smallint NOT NULL CHECK (digest_key_version BETWEEN 1 AND 32767),
    qualified_after boolean,
    account_status_after varchar(8) CHECK (account_status_after IN ('ACTIVE','DISABLED')),
    resulting_version bigint NOT NULL CHECK (resulting_version BETWEEN 1 AND 9007199254740991),
    changed boolean NOT NULL,
    applied_at timestamptz NOT NULL,
    UNIQUE (actor_account_id,operation,command_request_id),
    CHECK ((operation='SET_QUALIFICATION' AND qualified_after IS NOT NULL AND account_status_after IS NULL)
        OR (operation='SET_ACCOUNT_STATUS' AND qualified_after IS NULL AND account_status_after IS NOT NULL))
);
CREATE INDEX admin_receipt_time ON admin_command_receipt(applied_at,id);

CREATE TABLE admin_audit_entry (
    id uuid PRIMARY KEY,
    source_module varchar(20) NOT NULL CHECK (source_module IN ('IDENTITY','AUTHORIZATION','CONTENT','PRACTICE','LEARNING','ANALYTICS','ADMIN_SECURITY')),
    event_id uuid NOT NULL,
    actor_kind varchar(16) NOT NULL CHECK (actor_kind IN ('ACCOUNT','LOCAL_OPERATOR','SYSTEM')),
    actor_account_id uuid,
    action varchar(64) NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    target_type varchar(32) NOT NULL,
    target_id uuid,
    record_kind varchar(20) CHECK (record_kind IN ('COMPLETED','RESTRICTED_ARCHIVED')),
    related_record_id uuid,
    outcome varchar(8) NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE')),
    reason_code varchar(64) CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    request_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    UNIQUE (source_module,event_id),
    CHECK ((actor_kind='ACCOUNT')=(actor_account_id IS NOT NULL)),
    CHECK ((target_type IN ('QUERY','SYSTEM')) OR target_id IS NOT NULL),
    CHECK ((record_kind IS NULL)=(related_record_id IS NULL)),
    CHECK ((action IN ('PRACTICE_COMPLETED','PRACTICE_RESTRICTED_ARCHIVED'))=(record_kind IS NOT NULL)),
    CHECK (action <> 'PRACTICE_COMPLETED' OR record_kind='COMPLETED'),
    CHECK (action <> 'PRACTICE_RESTRICTED_ARCHIVED' OR record_kind='RESTRICTED_ARCHIVED'),
    CHECK ((outcome='FAILURE' AND reason_code IS NOT NULL) OR (outcome='SUCCESS' AND reason_code IS NULL))
);
CREATE INDEX admin_audit_page ON admin_audit_entry(occurred_at DESC,id DESC);
CREATE INDEX admin_audit_actor ON admin_audit_entry(actor_account_id,occurred_at DESC,id DESC);
CREATE INDEX admin_audit_action ON admin_audit_entry(source_module,action,occurred_at DESC,id DESC);
CREATE INDEX admin_audit_request ON admin_audit_entry(request_id,id);

CREATE TABLE admin_audit_change (
    audit_entry_id uuid NOT NULL REFERENCES admin_audit_entry(id) ON DELETE RESTRICT,
    field varchar(32) NOT NULL CHECK (field IN ('ACCOUNT_STATUS','ADMIN_QUALIFIED','COLLEGE_ID','MAJOR_ID','IS_PUBLIC','RESOURCE_STATUS','RESOURCE_VERSION','CREDENTIAL_VERSION')),
    before_value varchar(64),
    after_value varchar(64),
    PRIMARY KEY (audit_entry_id,field),
    CHECK (before_value IS NOT NULL OR after_value IS NOT NULL),
    CHECK (before_value IS DISTINCT FROM after_value),
    CHECK (COALESCE(before_value,'') !~ '[[:cntrl:]]' AND COALESCE(after_value,'') !~ '[[:cntrl:]]')
);
CREATE FUNCTION admin_keep_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit facts are immutable'; END $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON admin_audit_entry FOR EACH ROW EXECUTE FUNCTION admin_keep_audit_immutable();
CREATE TRIGGER admin_audit_change_immutable BEFORE UPDATE OR DELETE ON admin_audit_change FOR EACH ROW EXECUTE FUNCTION admin_keep_audit_immutable();
CREATE FUNCTION admin_keep_bootstrap_latch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Administrator control is permanent'; END IF;
    IF OLD.bootstrap_completed_at IS NOT NULL AND NEW.bootstrap_completed_at IS DISTINCT FROM OLD.bootstrap_completed_at THEN
        RAISE EXCEPTION 'Bootstrap latch is permanent';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admin_bootstrap_latch BEFORE UPDATE OR DELETE ON admin_control FOR EACH ROW EXECUTE FUNCTION admin_keep_bootstrap_latch();
