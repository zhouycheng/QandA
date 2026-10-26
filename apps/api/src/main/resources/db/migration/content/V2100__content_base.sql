CREATE TABLE content_subject (
 id uuid PRIMARY KEY, source text NOT NULL CHECK(source IN ('SCHOOL','USER')), owner_account_id uuid,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120), description text NOT NULL DEFAULT '' CHECK(char_length(description)<=2000),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 content_version bigint NOT NULL DEFAULT 1 CHECK(content_version BETWEEN 1 AND 9007199254740991),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 CHECK((source='USER' AND owner_account_id=created_by) OR (source='SCHOOL' AND owner_account_id IS NULL))
);
CREATE TABLE content_chapter (
 id uuid PRIMARY KEY, subject_id uuid NOT NULL REFERENCES content_subject(id), title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')), position integer NOT NULL CHECK(position BETWEEN 1 AND 100),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 UNIQUE(id,subject_id), CONSTRAINT content_chapter_position_unique UNIQUE(subject_id,position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE content_question (
 id uuid PRIMARY KEY, subject_id uuid NOT NULL REFERENCES content_subject(id), chapter_id uuid NOT NULL,
 source_key text CHECK(char_length(source_key) BETWEEN 1 AND 120), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 position integer NOT NULL CHECK(position BETWEEN 1 AND 10000), version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 current_revision_id uuid NOT NULL,
 UNIQUE(id,subject_id), FOREIGN KEY(chapter_id,subject_id) REFERENCES content_chapter(id,subject_id),
 CONSTRAINT content_question_position_unique UNIQUE(chapter_id,position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX content_question_source_unique ON content_question(subject_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE content_question_revision (
 id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES content_question(id) DEFERRABLE INITIALLY DEFERRED,
 revision_number integer NOT NULL CHECK(revision_number>=1), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 content_hash bytea NOT NULL CHECK(octet_length(content_hash)=32), search_text text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(question_id,id), UNIQUE(question_id,revision_number)
);
ALTER TABLE content_question ADD CONSTRAINT content_question_current_revision_fk FOREIGN KEY(id,current_revision_id)
 REFERENCES content_question_revision(question_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE content_option_identity(id uuid PRIMARY KEY, question_id uuid NOT NULL REFERENCES content_question(id), UNIQUE(question_id,id));
CREATE TABLE content_image(file_id uuid PRIMARY KEY,subject_id uuid NOT NULL REFERENCES content_subject(id),created_at timestamptz NOT NULL,UNIQUE(file_id,subject_id));
CREATE TABLE content_revision_attachment (
 revision_id uuid NOT NULL REFERENCES content_question_revision(id), location text NOT NULL CHECK(location LIKE '/%'),file_id uuid NOT NULL REFERENCES content_image(file_id),
 PRIMARY KEY(revision_id,location)
);
CREATE INDEX content_attachment_file_idx ON content_revision_attachment(file_id);
CREATE TABLE content_import_batch (
 id uuid PRIMARY KEY, subject_id uuid NOT NULL REFERENCES content_subject(id), created_by uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('VALID','INVALID','COMMITTED','CANCELLED')), version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 subject_content_version bigint NOT NULL CHECK(subject_content_version BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL, committed_at timestamptz,cancelled_at timestamptz,
 CHECK(expires_at>created_at),CHECK((state='COMMITTED')=(committed_at IS NOT NULL)),CHECK((state='CANCELLED')=(cancelled_at IS NOT NULL))
);
CREATE TABLE content_import_document (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES content_import_batch(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120),schema_version text NOT NULL CHECK(schema_version='qanda-content-1'),chapter_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='array'),UNIQUE(batch_id,ordinal)
);
CREATE TABLE content_import_issue (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES content_import_batch(id),document_ordinal integer NOT NULL CHECK(document_ordinal BETWEEN 1 AND 20),
 item_index integer CHECK(item_index>=0),pointer text NOT NULL,code text NOT NULL,severity text NOT NULL CHECK(severity IN ('ERROR','WARNING')),message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 500)
);
CREATE TABLE content_import_created_question (
 batch_id uuid NOT NULL REFERENCES content_import_batch(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 1000),question_id uuid NOT NULL,revision_id uuid NOT NULL,
 PRIMARY KEY(batch_id,ordinal),FOREIGN KEY(question_id,revision_id) REFERENCES content_question_revision(question_id,id)
);
CREATE TABLE content_command_receipt (
 id uuid PRIMARY KEY,actor_account_id uuid NOT NULL,operation text NOT NULL,command_request_id uuid NOT NULL,
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),digest_key_version smallint NOT NULL CHECK(digest_key_version>0),
 state text NOT NULL CHECK(state IN ('RESERVED','SUCCEEDED','REJECTED')),upload_operation_id uuid UNIQUE,upload_profile_version smallint,
 rejection_code text,rejection_status integer,subject_id uuid NOT NULL,chapter_id uuid,question_id uuid,revision_id uuid,import_id uuid,file_id uuid,
 version bigint,content_version bigint,created_at timestamptz NOT NULL,completed_at timestamptz,
 UNIQUE(actor_account_id,operation,command_request_id),
 CHECK((upload_operation_id IS NULL)=(upload_profile_version IS NULL)),
 CHECK(state!='SUCCEEDED' OR (version>=1 AND content_version>=1 AND completed_at IS NOT NULL)),
 CHECK(state!='REJECTED' OR (rejection_code IS NOT NULL AND rejection_status BETWEEN 400 AND 499))
);
CREATE INDEX content_subject_owner_idx ON content_subject(owner_account_id,id);
CREATE INDEX content_import_owner_idx ON content_import_batch(subject_id,created_by);
CREATE FUNCTION content_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable content history'; END $$;
CREATE TRIGGER content_revision_immutable BEFORE UPDATE OR DELETE ON content_question_revision FOR EACH ROW EXECUTE FUNCTION content_immutable_record();
CREATE TRIGGER content_options_immutable BEFORE UPDATE OR DELETE ON content_option_identity FOR EACH ROW EXECUTE FUNCTION content_immutable_record();
CREATE TRIGGER content_attachment_immutable BEFORE UPDATE OR DELETE ON content_revision_attachment FOR EACH ROW EXECUTE FUNCTION content_immutable_record();
CREATE FUNCTION content_immutable_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='content_subject' THEN
  IF (NEW.id,NEW.source,NEW.owner_account_id,NEW.created_by) IS DISTINCT FROM (OLD.id,OLD.source,OLD.owner_account_id,OLD.created_by) THEN RAISE EXCEPTION 'Immutable subject identity'; END IF;
 ELSIF TG_TABLE_NAME='content_chapter' THEN
  IF (NEW.id,NEW.subject_id) IS DISTINCT FROM (OLD.id,OLD.subject_id) THEN RAISE EXCEPTION 'Immutable chapter identity'; END IF;
 ELSE
  IF (NEW.id,NEW.subject_id,NEW.chapter_id,NEW.source_key) IS DISTINCT FROM (OLD.id,OLD.subject_id,OLD.chapter_id,OLD.source_key) THEN RAISE EXCEPTION 'Immutable question identity'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER content_subject_identity BEFORE UPDATE ON content_subject FOR EACH ROW EXECUTE FUNCTION content_immutable_identity();
CREATE TRIGGER content_chapter_identity BEFORE UPDATE ON content_chapter FOR EACH ROW EXECUTE FUNCTION content_immutable_identity();
CREATE TRIGGER content_question_identity BEFORE UPDATE ON content_question FOR EACH ROW EXECUTE FUNCTION content_immutable_identity();
