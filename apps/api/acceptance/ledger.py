"""将源码入口、独立HTTP/Schema、业务断言和外部联调分别登记。"""
import collections
import datetime
import hashlib
import json
from pathlib import Path

from contracts import Contracts, EVIDENCE, ROOT, operation_evidence


def main():
    contracts = Contracts()
    states = operation_evidence(contracts)
    assertions = json.loads((EVIDENCE / "a-assertions.json").read_text())
    evidence_path = str(EVIDENCE.relative_to(ROOT))
    rows = []
    for key, item in contracts.operations.items():
        state = states[key]
        module = "NOT_IMPLEMENTED" if state["implementation"] == "NOT_IMPLEMENTED" else "NOT_INDEPENDENTLY_VERIFIED"
        rows.append({"operationId": key, "module": item["owner"], "method": item["method"], "path": "/api/v1" + item["route"],
                     **state, "moduleVerification": module,
                     "moduleEvidence": None,
                     "moduleSupplementEvidence": None,
                     "independentEvidence": evidence_path + "/a-http-redacted.json" if state["observedStatuses"] else None,
                     "schemaEvidence": evidence_path + "/a-http-schema-validation.json" if state["observedStatuses"] else None,
                     "assertionEvidence": evidence_path + "/a-assertions.json" if state["observedStatuses"] else None,
                     "responseStatusesInContract": list(item["operation"]["responses"]),
                     "requestHeadersInContract": [contracts.resolve(x, item["file"])[0]["name"]
                         for x in item["pathItem"].get("parameters", []) + item["operation"].get("parameters", [])
                         if contracts.resolve(x, item["file"])[0]["in"] == "header"]})
    assert len(rows) == len({x["operationId"] for x in rows}) == 101
    counts = dict(collections.Counter(x["independentIntegration"] for x in rows))
    result = {"capturedAt": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
              "scope": "A53+Content23 isolated real-provider HTTP; C25 not implemented",
              "runtime": {"database": assertions["database"], "migrationVersions": assertions["migrationVersions"],
                          "exchanges": assertions["exchanges"], "mailTransport": assertions["mailTransport"], "vendorCalls": assertions["vendorCalls"]},
              "rateLimits": {"windowSeconds": 60, "writePerAccount": {"default": 120, "actualBoundaryTested": True},
                             "readPerAccount": {"default": 600, "actualBoundaryTested": False},
                             "anonymousPerPeer": {"default": 60000, "testOverride": 3, "actualOverrideBoundaryTested": True},
                             "scope": "one process; counters reset on restart; shared multi-instance counts not verified"},
              "counts": counts, "operations": rows,
              "contractSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in contracts.documents}}
    quality = EVIDENCE / "ledger"
    quality.mkdir(parents=True, exist_ok=True)
    (quality / "implementation-operation-coverage.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    labels = {"PASS": "通过", "FAIL": "失败", "PENDING_DEPENDENCY": "依赖待齐", "NOT_EXECUTED": "未独立执行", "NOT_IMPLEMENTED": "未实现"}
    text = ["# 101 接口实现与独立验收台账", "", "源码入口、HTTP 观察、Schema 校验、业务断言和外部服务状态分别记录。合同位于 `apps/api/contracts/modules/`，聚合合同为 `apps/api/contracts/openapi.yaml`。", "",
            "练习、学习记录和统计相关的25项操作保留为未实现草案；草案不代表服务已提供对应行为。运行证据只保存在忽略目录 `.backend-runtime/verification/`。", "",
            "| operationId | 模块 | 方法/路径 | 源码入口 | 模块报告 | 独立集成 | 外部 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for x in rows:
        written = "存在" if x["implementation"] == "WRITTEN" else "未实现"
        module = "待独立验证" if written == "存在" else "未实现"
        text.append(f"| {x['operationId']} | {x['module']} | `{x['method']} {x['path']}` | {written} | {module} | {labels[x['independentIntegration']]} | {x['external']} |")
    text += ["", "机器记录包含每操作实际状态码、合同响应码/请求头、独立证据位置与源合同指纹，见[逐项JSON](implementation-operation-coverage.json)。", "",
             "外部 PENDING_TENCENT_SES 和 PENDING_OFFICIAL_WECHAT 表示对应供应商验收仍待执行；本地测试结果不会替代外部服务验证。", ""]
    (quality / "implementation-operation-coverage.md").write_text("\n".join(text))
    print(json.dumps({"operations": 101, "independentCounts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
