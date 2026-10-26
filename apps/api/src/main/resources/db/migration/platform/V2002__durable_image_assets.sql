CREATE TABLE file_asset (
    id uuid PRIMARY KEY,
    uploaded_by_account_id uuid NOT NULL,
    upload_operation_id uuid NOT NULL UNIQUE,
    purpose varchar(24) NOT NULL CHECK(purpose='SUBJECT_IMAGE'),
    subject_id uuid NOT NULL,
    input_profile_version integer NOT NULL CHECK(input_profile_version=1),
    input_limits_digest char(64) NOT NULL,
    raw_sha256 char(64) NOT NULL,
    raw_size_bytes bigint NOT NULL CHECK(raw_size_bytes BETWEEN 1 AND 5242880),
    stage_token uuid,
    stage_lease_until timestamptz,
    storage_key varchar(160) NOT NULL UNIQUE,
    state varchar(16) NOT NULL CHECK(state IN ('STAGING','READY','FAILED','DELETING','DELETED')),
    media_type varchar(64), size_bytes bigint, sha256 char(64), width_pixels integer, height_pixels integer,
    created_at timestamptz NOT NULL, staging_expires_at timestamptz NOT NULL,
    ready_at timestamptz, deleted_at timestamptz, failure_code varchar(64),
    version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
    UNIQUE(id,subject_id),
    CONSTRAINT file_asset_account_fk FOREIGN KEY(uploaded_by_account_id) REFERENCES identity_account(id) ON DELETE RESTRICT,
    CHECK((state='STAGING')=(stage_token IS NOT NULL AND stage_lease_until IS NOT NULL)),
    CHECK(state<>'READY' OR (media_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL
        AND width_pixels IS NOT NULL AND height_pixels IS NOT NULL AND media_type='image/png' AND size_bytes BETWEEN 1 AND 5242880
        AND sha256 ~ '^[0-9a-f]{64}$' AND width_pixels BETWEEN 1 AND 8192 AND height_pixels BETWEEN 1 AND 8192
        AND width_pixels::bigint*height_pixels<=32000000 AND ready_at IS NOT NULL)),
    CHECK(state<>'FAILED' OR failure_code IS NOT NULL)
);
CREATE INDEX file_asset_recovery ON file_asset(state,stage_lease_until);
CREATE FUNCTION platform_keep_asset_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Asset mapping metadata is retained'; END IF;
    IF ROW(NEW.id,NEW.uploaded_by_account_id,NEW.upload_operation_id,NEW.purpose,NEW.subject_id,NEW.input_profile_version,NEW.input_limits_digest,NEW.raw_sha256,NEW.raw_size_bytes,NEW.storage_key,NEW.created_at,NEW.staging_expires_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.uploaded_by_account_id,OLD.upload_operation_id,OLD.purpose,OLD.subject_id,OLD.input_profile_version,OLD.input_limits_digest,OLD.raw_sha256,OLD.raw_size_bytes,OLD.storage_key,OLD.created_at,OLD.staging_expires_at) THEN
        RAISE EXCEPTION 'Asset operation mapping is immutable';
    END IF;
    IF OLD.state='READY' AND ROW(NEW.media_type,NEW.size_bytes,NEW.sha256,NEW.width_pixels,NEW.height_pixels,NEW.ready_at)
       IS DISTINCT FROM ROW(OLD.media_type,OLD.size_bytes,OLD.sha256,OLD.width_pixels,OLD.height_pixels,OLD.ready_at) THEN
        RAISE EXCEPTION 'Ready asset bytes and metadata are immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER file_asset_mapping_immutable BEFORE UPDATE OR DELETE ON file_asset FOR EACH ROW EXECUTE FUNCTION platform_keep_asset_mapping();
