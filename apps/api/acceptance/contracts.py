"""基于当前拥有者合同的完整 Schema 验收；敏感实例只从标准输入进入内存。"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parents[3]
DESIGN = ROOT / "apps/api/contracts"
EVIDENCE = Path(os.environ.get("QANDA_QUALITY_EVIDENCE_DIR", ROOT / "apps/api/.backend-runtime/verification/quality")).resolve()
METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def wire_value(value, schema):
    if schema.get("type") == "integer" and isinstance(value, str) and re.fullmatch(r"-?[0-9]+", value):
        return int(value)
    if schema.get("type") == "boolean" and value in ("true", "false"):
        return value == "true"
    return value


class Contracts:
    def __init__(self):
        self.documents = {p.resolve(): json.loads(p.read_text()) for p in
                          sorted((DESIGN / "modules").glob("*/openapi.yaml"))}
        entry = DESIGN / "openapi.yaml"
        self.documents[entry] = json.loads(entry.read_text())
        self.registry = Registry().with_resources(
            (p.as_uri(), Resource.from_contents(doc, default_specification=DRAFT202012))
            for p, doc in self.documents.items())
        self.operations = {}
        for path, document in self.documents.items():
            if path == entry:
                continue
            for route, item in document.get("paths", {}).items():
                for method, operation in item.items():
                    if method not in METHODS:
                        continue
                    key = operation["operationId"]
                    assert key not in self.operations, key
                    self.operations[key] = {"owner": path.parent.name, "file": path,
                                            "method": method.upper(), "route": route,
                                            "operation": operation, "pathItem": item}
        assert len(self.operations) == 101

    def resolve(self, value, owner):
        seen = set()
        while isinstance(value, dict) and "$ref" in value:
            uri = urljoin(owner.as_uri(), value["$ref"])
            assert uri not in seen, "Reference-only cycle"
            seen.add(uri)
            parsed = urlparse(uri)
            assert parsed.scheme == "file", "Only local accepted contracts are read"
            owner = Path(unquote(parsed.path)).resolve()
            value = self.documents[owner]
            for token in unquote(parsed.fragment).lstrip("/").split("/") if parsed.fragment else []:
                token = token.replace("~1", "/").replace("~0", "~")
                value = value[int(token)] if isinstance(value, list) else value[token]
        return value, owner

    def errors(self, value, schema, owner):
        # Keep the document as the base URI so relative schema references remain authoritative.
        wrapped = {**self.documents[owner], "$id": owner.as_uri(), "allOf": [schema]}
        validator = Draft202012Validator(wrapped, registry=self.registry,
                                        format_checker=FormatChecker())
        return [{"keyword": str(e.validator),
                 "instancePointer": "/" + "/".join(map(str, e.absolute_path)),
                 "schemaPointer": "/" + "/".join(map(str, e.absolute_schema_path))}
                for e in validator.iter_errors(value)]

    def validate_exchange(self, event):
        op = self.operations[event["operationId"]]
        owner, operation = op["file"], op["operation"]
        errors = []
        route = urlparse(event["path"])
        template = "/api/v1" + op["route"]
        expression = re.escape(template)
        for name in re.findall(r"\{([^}]+)\}", template):
            expression = expression.replace(re.escape("{" + name + "}"), "(?P<" + name + ">[^/]+)")
        match = re.fullmatch(expression, route.path)
        if event["method"] != op["method"] or not match:
            errors.append({"keyword": "method/path", "instancePointer": "/path"})
        headers = {k.lower(): v for k, v in event.get("responseHeaders", {}).items()}
        response = operation["responses"].get(str(event["status"]), operation["responses"].get("default"))
        if response is None:
            errors.append({"keyword": "documented-status", "instancePointer": "/status"})
            return errors
        response, response_owner = self.resolve(response, owner)
        for name, header in response.get("headers", {}).items():
            header, header_owner = self.resolve(header, response_owner)
            value = headers.get(name.lower())
            if value is None:
                if header.get("required"):
                    errors.append({"keyword": "required-header", "instancePointer": "/headers/" + name})
            elif "schema" in header:
                schema, schema_owner = self.resolve(header["schema"], header_owner)
                errors += [{**e, "location": "responseHeader:" + name}
                           for e in self.errors(wire_value(value, schema), schema, schema_owner)]
        content = response.get("content", {})
        if content:
            mime = headers.get("content-type", "").split(";")[0].lower()
            media = content.get(mime)
            if media is None:
                errors.append({"keyword": "response-media", "instancePointer": "/headers/content-type"})
            elif mime == "application/json":
                errors += [{**e, "location": "responseBody"}
                           for e in self.errors(event.get("responseBody"), media["schema"], response_owner)]
        elif event.get("responseBody") is not None:
            errors.append({"keyword": "empty-response", "instancePointer": "/responseBody"})
        if event.get("validateRequest", True):
            parameters = op["pathItem"].get("parameters", []) + operation.get("parameters", [])
            query = parse_qs(route.query, keep_blank_values=True)
            request_headers = {k.lower(): v for k, v in event.get("requestHeaders", {}).items()}
            for parameter in parameters:
                parameter, parameter_owner = self.resolve(parameter, owner)
                name, location = parameter["name"], parameter["in"]
                values = ({"path": match.groupdict() if match else {}, "query": query,
                           "header": request_headers}.get(location, {}))
                value = values.get(name.lower() if location == "header" else name)
                if value is None:
                    if parameter.get("required"):
                        errors.append({"keyword": "required-parameter", "instancePointer": "/" + location + "/" + name})
                    continue
                schema, schema_owner = self.resolve(parameter["schema"], parameter_owner)
                if isinstance(value, list):
                    value = value if schema.get("type") == "array" else value[0]
                value = wire_value(value, schema)
                errors += [{**e, "location": "requestParameter:" + name}
                           for e in self.errors(value, schema, schema_owner)]
            if "requestBody" in operation:
                request, request_owner = self.resolve(operation["requestBody"], owner)
                if "application/json" in request.get("content", {}):
                    errors += [{**e, "location": "requestBody"} for e in self.errors(
                        event.get("requestBody"), request["content"]["application/json"]["schema"], request_owner)]
        return errors


def operation_evidence(contracts):
    """Per-operation evidence keeps observed HTTP, schema and missing dependencies separate."""
    def read(name, default):
        path = EVIDENCE / name
        return json.loads(path.read_text()) if path.exists() else default

    events = read("a-http-redacted.json", [])
    schema = read("a-http-schema-validation.json", {}).get("results", [])
    schema_failed = {x["operationId"] for x in schema if x["schemaStatus"] == "FAIL"}
    assertions = read("a-assertions.json", {})
    assertion_failed = {x["operationId"] for x in assertions.get("findings", [])}
    status_failed = {x["operationId"] for x in events if not x.get("statusMatches", True)}
    failed = schema_failed | assertion_failed | status_failed
    positives = {x["operationId"] for x in events if x.get("validateRequest") and x.get("statusMatches") and 200 <= x["status"] < 300}
    pending = {x["operationId"] for x in events if x.get("case") == "pending-content-fk"}
    results = {}
    mail_operations = {"identityRequestPublicEmailChallenge", "identityRegisterEmail", "identityResetPassword",
                       "identityRequestOwnEmailChallenge", "identityBindEmail", "identityChangePassword",
                       "identityRequestEmailChange", "identityConfirmEmailChange"}
    for op_id, item in contracts.operations.items():
        sources = list((ROOT / "apps/api/src/main/kotlin/qanda/backend" / item["owner"].replace("-", "")).glob("*.kt"))
        written = any(re.search(r"fun\s+" + re.escape(op_id) + r"\s*\(", path.read_text()) for path in sources)
        integrated = "NOT_IMPLEMENTED" if not written else "FAIL" if op_id in failed else "PASS" if op_id in positives else "PENDING_DEPENDENCY" if op_id in pending else "NOT_EXECUTED"
        external = "PENDING_OFFICIAL_WECHAT" if "Wechat" in op_id else "PENDING_TENCENT_SES" if op_id in mail_operations else "NOT_APPLICABLE"
        local = "EXPLICIT_LOCAL_WECHAT" if "Wechat" in op_id else assertions.get("mailTransport", "TEST_ONLY") if op_id in mail_operations else "REAL_FILE_IO" if op_id in ("contentUploadImage", "contentReadImage") and op_id in positives else "NOT_APPLICABLE"
        results[op_id] = {"implementation": "WRITTEN" if written else "NOT_IMPLEMENTED", "independentIntegration": integrated,
                          "positiveHttpObserved": op_id in positives, "schemaFailureObserved": op_id in schema_failed,
                          "assertionFailureObserved": op_id in assertion_failed, "statusFailureObserved": op_id in status_failed,
                          "localProviderVerification": local,
                          "external": external, "observedStatuses": sorted({x["status"] for x in events if x["operationId"] == op_id}),
                          "pendingAspects": ["Shared directory/mutation429 and Retry-After not independently exercised"] if item["owner"] == "authorization" and not {"generic-directory429", "generic-mutation429"}.issubset({x.get("case") for x in events}) else []}
    return results


def self_check():
    validator = Draft202012Validator({"type": "object", "required": ["kind", "items"],
        "additionalProperties": False, "properties": {"kind": {"const": "A"},
        "items": {"type": "array", "uniqueItems": True, "items": {"type": "integer"}},
        "value": {"type": "integer"}}, "if": {"properties": {"kind": {"const": "A"}}},
        "then": {"required": ["value"]}})
    good = {"kind": "A", "items": [1], "value": 2}
    assert validator.is_valid(good)
    negatives = [{**good, "items": [1, 1]}, {**good, "items": [False]},
                 {**good, "extra": 1}, {k: v for k, v in good.items() if k != "value"}]
    assert all(not validator.is_valid(item) for item in negatives)
    assert not Draft202012Validator({"type": "string", "format": "uuid"},
                                    format_checker=FormatChecker()).is_valid("invalid")
    seconds = Draft202012Validator({"type": "integer", "minimum": 1})
    assert seconds.is_valid(wire_value("60", {"type": "integer"}))
    assert all(not seconds.is_valid(wire_value(x, {"type": "integer"})) for x in ("abc", "1.5", "60,60", "0"))
    return 9


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["spec", "exchanges"])
    args = parser.parse_args()
    contracts = Contracts()
    if args.command == "spec":
        from openapi_spec_validator import OpenAPIV31SpecValidator
        failures = []
        for path, document in contracts.documents.items():
            for error in OpenAPIV31SpecValidator(document, base_uri=path.as_uri()).iter_errors():
                failures.append({"file": str(path.relative_to(ROOT)),
                                 "path": "/".join(map(str, error.path)),
                                 "kind": type(error).__name__})
        result = {"status": "PASS" if not failures else "FAIL", "documents": len(contracts.documents),
                  "operations": len(contracts.operations), "negativeSelfChecks": self_check(),
                  "schemaEngine": "openapi-spec-validator 0.7.2 + jsonschema 4.23.0/Draft202012/FormatChecker",
                  "failures": failures,
                  "sourceSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                   for p in contracts.documents}}
    else:
        results = []
        for event in json.load(sys.stdin):
            errors = contracts.validate_exchange(event)
            results.append({"operationId": event["operationId"], "case": event.get("case", ""),
                            "status": event["status"], "schemaStatus": "FAIL" if errors else "PASS",
                            "errors": errors})
        result = {"status": "PASS" if all(x["schemaStatus"] == "PASS" for x in results) else "FAIL",
                  "exchanges": len(results), "operations": len({x["operationId"] for x in results}),
                  "negativeSelfChecks": self_check(), "results": results}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
