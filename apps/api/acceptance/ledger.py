"""根据当前合同和实际 HTTP、Schema 证据生成逐操作台账。"""
import json
from contracts import Contracts, EVIDENCE, operation_evidence


def main():
    contracts = Contracts()
    evidence = operation_evidence(contracts)
    rows = [{"operationId": key, "module": value["owner"], "method": value["method"], "path": value["route"], **evidence[key]}
            for key, value in contracts.operations.items()]
    result = {"operations": rows, "registered": len(rows), "positiveHttpObserved": sum(x["positiveHttpObserved"] for x in rows),
              "schemaFailures": sum(x["schemaStatus"] == "FAIL" for x in rows), "externalProviders": {"mail": "LOCAL_CAPTURE", "wechat": "LOCAL_TEST", "officialProviders": "NOT_EXECUTED"}}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "operation-coverage.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "operations"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
