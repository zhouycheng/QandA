"""Validate captured Content HTTP with the pinned QA engine and OpenAPI wire types."""
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path

api = Path(__file__).resolve().parents[6]
spec = importlib.util.spec_from_file_location("qanda_contracts", api / "acceptance/contracts.py")
contracts_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contracts_module)


class WireContracts(contracts_module.Contracts):
    def validate_exchange(self, event):
        event = copy.deepcopy(event)
        operation = self.operations[event["operationId"]]
        response = operation["operation"]["responses"].get(str(event["status"]))
        if response:
            response, owner = self.resolve(response, operation["file"])
            for name, header in response.get("headers", {}).items():
                header, header_owner = self.resolve(header, owner)
                schema, _ = self.resolve(header.get("schema", {}), header_owner)
                for actual in list(event.get("responseHeaders", {})):
                    value = event["responseHeaders"][actual]
                    if actual.lower() == name.lower() and schema.get("type") == "integer" and isinstance(value, str) and re.fullmatch(r"-?[0-9]+", value):
                        event["responseHeaders"][actual] = int(value)
        return super().validate_exchange(event)


if __name__ == "__main__":
    events = json.load(sys.stdin)
    contracts = WireContracts()
    results = [{"operationId": event["operationId"], "case": event.get("case", ""),
                "status": event["status"], "errors": contracts.validate_exchange(event)} for event in events]
    for item in results:
        item["schemaStatus"] = "FAIL" if item["errors"] else "PASS"
    header_checks = 0
    for event in events:
        header = next((name for name in event.get("responseHeaders", {}) if name.lower() == "retry-after"), None)
        if header and str(event["responseHeaders"][header]).isdigit():
            for invalid in ("soon", "1,1"):
                bad = copy.deepcopy(event)
                bad["responseHeaders"][header] = invalid
                assert any(error.get("location", "").lower() == "responseheader:retry-after" for error in contracts.validate_exchange(bad))
                header_checks += 1
            break
    passed = all(item["schemaStatus"] == "PASS" for item in results)
    result = {"status": "PASS" if passed else "FAIL", "schemaEngine": "jsonschema4.23.0/Draft202012/FormatChecker + current owner contracts",
              "wireNormalization": "Parse integer response header strings using their OpenAPI Header schema; preserved HTTP evidence retains raw values",
              "negativeSelfChecks": contracts_module.self_check(), "integerHeaderNegativeChecks": header_checks,
              "exchanges": len(events), "operations": len({event["operationId"] for event in events}), "results": results}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if passed else 1)
