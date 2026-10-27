CREATE TABLE authz_college (
  college_id uuid PRIMARY KEY, name varchar(80) COLLATE "C" NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CONSTRAINT authz_college_name_unique UNIQUE(name),
  CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name !~ '[[:cntrl:]]' AND name IS NFC NORMALIZED)
);
CREATE INDEX authz_college_directory_idx ON authz_college(status,name,college_id);
CREATE TABLE authz_major (
  major_id uuid PRIMARY KEY, college_id uuid NOT NULL REFERENCES authz_college(college_id) ON DELETE RESTRICT,
  name varchar(80) COLLATE "C" NOT NULL, status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CONSTRAINT authz_major_name_unique UNIQUE(college_id,name),
  CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name !~ '[[:cntrl:]]' AND name IS NFC NORMALIZED)
);
CREATE INDEX authz_major_directory_idx ON authz_major(college_id,status,name,major_id);
CREATE TABLE authz_membership (
  account_id uuid PRIMARY KEY, major_id uuid NOT NULL REFERENCES authz_major(major_id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  established_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX authz_membership_major_idx ON authz_membership(major_id,account_id);
CREATE TABLE authz_membership_change (
  change_id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES authz_membership(account_id) ON DELETE RESTRICT,
  from_major_id uuid REFERENCES authz_major(major_id) ON DELETE RESTRICT,
  to_major_id uuid NOT NULL REFERENCES authz_major(major_id) ON DELETE RESTRICT,
  actor_account_id uuid NOT NULL, reason varchar(24) NOT NULL CHECK (reason IN ('REGISTRATION','SELF_CHANGE','ADMIN_CHANGE')),
  changed_at timestamptz NOT NULL, resulting_version bigint NOT NULL CHECK(resulting_version BETWEEN 1 AND 9007199254740991),
  CHECK(from_major_id IS NULL OR from_major_id <> to_major_id), UNIQUE(account_id,resulting_version)
);
CREATE INDEX authz_membership_history_idx ON authz_membership_change(account_id,changed_at DESC,change_id);
CREATE TABLE authz_subject_policy (
  subject_id uuid PRIMARY KEY, is_public boolean NOT NULL DEFAULT false,
  version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE authz_college_grant (
  subject_id uuid NOT NULL REFERENCES authz_subject_policy(subject_id) ON DELETE RESTRICT,
  college_id uuid NOT NULL REFERENCES authz_college(college_id) ON DELETE RESTRICT,
  granted_by_account_id uuid NOT NULL, granted_at timestamptz NOT NULL, PRIMARY KEY(subject_id,college_id)
);
CREATE INDEX authz_college_grant_reverse_idx ON authz_college_grant(college_id,subject_id);
CREATE TABLE authz_major_grant (
  subject_id uuid NOT NULL REFERENCES authz_subject_policy(subject_id) ON DELETE RESTRICT,
  major_id uuid NOT NULL REFERENCES authz_major(major_id) ON DELETE RESTRICT,
  granted_by_account_id uuid NOT NULL, granted_at timestamptz NOT NULL, PRIMARY KEY(subject_id,major_id)
);
CREATE INDEX authz_major_grant_reverse_idx ON authz_major_grant(major_id,subject_id);
CREATE TABLE authz_account_rule (
  subject_id uuid NOT NULL REFERENCES authz_subject_policy(subject_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL, granted boolean NOT NULL, inheritance_blocked boolean NOT NULL,
  updated_by_account_id uuid NOT NULL, updated_at timestamptz NOT NULL, PRIMARY KEY(subject_id,account_id),
  CHECK(granted OR inheritance_blocked)
);
CREATE INDEX authz_account_rule_reverse_idx ON authz_account_rule(account_id,subject_id);
CREATE TABLE authz_user_share (
  subject_id uuid NOT NULL REFERENCES authz_subject_policy(subject_id) ON DELETE RESTRICT,
  recipient_account_id uuid NOT NULL, granted_by_account_id uuid NOT NULL, granted_at timestamptz NOT NULL,
  PRIMARY KEY(subject_id,recipient_account_id), CHECK(recipient_account_id <> granted_by_account_id)
);
CREATE INDEX authz_user_share_reverse_idx ON authz_user_share(recipient_account_id,subject_id);
CREATE TABLE authz_command_receipt (
  receipt_id uuid PRIMARY KEY, actor_account_id uuid NOT NULL, operation varchar(64) NOT NULL,
  command_id uuid NOT NULL, payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  digest_key_version smallint NOT NULL CHECK(digest_key_version BETWEEN 1 AND 32767),
  college_id uuid REFERENCES authz_college(college_id) ON DELETE RESTRICT,
  major_id uuid REFERENCES authz_major(major_id) ON DELETE RESTRICT,
  membership_account_id uuid REFERENCES authz_membership(account_id) ON DELETE RESTRICT,
  subject_id uuid REFERENCES authz_subject_policy(subject_id) ON DELETE RESTRICT,
  resulting_version bigint NOT NULL CHECK(resulting_version BETWEEN 1 AND 9007199254740991),
  changed boolean NOT NULL, http_status smallint NOT NULL CHECK(http_status IN (200,201)), confirmed_at timestamptz NOT NULL,
  UNIQUE(actor_account_id,operation,command_id), CHECK(num_nonnulls(college_id,major_id,membership_account_id,subject_id)=1),
  CHECK (
    (operation IN ('CREATE_COLLEGE','UPDATE_COLLEGE') AND college_id IS NOT NULL) OR
    (operation IN ('CREATE_MAJOR','UPDATE_MAJOR') AND major_id IS NOT NULL) OR
    (operation='SET_MEMBERSHIP' AND membership_account_id IS NOT NULL) OR
    (operation IN ('SET_PUBLIC','SET_COLLEGE_GRANT','SET_MAJOR_GRANT','SET_ACCOUNT_RULE','GRANT_SHARE','REVOKE_SHARE') AND subject_id IS NOT NULL)
  )
);
