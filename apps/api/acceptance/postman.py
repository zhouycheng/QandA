"""从拥有者合同生成101操作的Postman目录、空凭据环境和可复用输入样例。"""
import copy
import json
import re
import uuid
from pathlib import Path

from contracts import Contracts, EVIDENCE, ROOT, operation_evidence


def main():
    contracts = Contracts()
    variables = {"baseUrl": "http://127.0.0.1:8083", "adminToken": "", "userToken": "",
                 "loginRole": "USER", "loginEmail": "", "password": "", "newPassword": "",
                 "emailCode": "", "wechatCode": "", "oldCode": "", "newCode": "",
                 "registrationToken": "", "commandKey": "", "expectedStatus": "", "imageFile": ""}
    variables["contentRole"] = "USER"
    content_versions = {"contentCreateChapter": "expectedContentVersion", "contentReorderChapters": "expectedContentVersion",
                        "contentCreateQuestion": "expectedContentVersion", "contentReorderQuestions": "expectedContentVersion",
                        "contentPrevalidateImport": "expectedContentVersion", "contentUpdateSubject": "subjectVersion",
                        "contentSetSubjectStatus": "subjectVersion", "contentUpdateChapter": "chapterVersion",
                        "contentReviseQuestion": "questionVersion", "contentSetQuestionStatus": "questionVersion",
                        "contentCommitImport": "importVersion", "contentCancelImport": "importVersion"}
    counter = 100

    def sample(schema, owner, name=""):
        nonlocal counter
        schema, owner = contracts.resolve(schema, owner)
        if schema is True:
            return None
        if "example" in schema:
            return copy.deepcopy(schema["example"])
        if schema.get("examples"):
            return copy.deepcopy(schema["examples"][0])
        if "const" in schema:
            return schema["const"]
        if "default" in schema:
            return schema["default"]
        if "enum" in schema:
            return schema["enum"][0]
        for union in ("oneOf", "anyOf"):
            if union in schema:
                choices = [x for x in schema[union] if x.get("type") != "null"]
                return sample((choices or schema[union])[0], owner, name)
        if "allOf" in schema:
            result = {}
            for part in schema["allOf"]:
                value = sample(part, owner, name)
                if not isinstance(value, dict):
                    return value
                result.update(value)
            return result
        kind = schema.get("type")
        if isinstance(kind, list):
            kind = next((x for x in kind if x != "null"), "null")
        if kind == "object" or "properties" in schema:
            return {key: sample(schema["properties"][key], owner, key) for key in schema.get("required", [])}
        if kind == "array":
            return [sample(schema["items"], owner, name) for _ in range(schema.get("minItems", 0))]
        if kind in ("number", "integer"):
            return max(schema.get("minimum", 1), 1)
        if kind == "boolean":
            return False
        if kind == "null":
            return None
        if schema.get("format") == "uuid":
            counter += 1
            return str(uuid.UUID(int=counter))
        if schema.get("format") == "date-time":
            return "2026-10-26T00:00:00.000Z"
        if schema.get("format") == "date":
            return "2026-10-26"
        if "email" in name.lower():
            return "qa-example@example.test"
        if "password" in name.lower():
            return "Example-password-2026!"
        if name in ("code", "oldCode", "newCode"):
            return "123456"
        if "token" in name.lower():
            return "a" * 43
        if name == "accountCode":
            return "QA0000000000"
        return "样例" * max(1, (schema.get("minLength", 1) + 1) // 2)

    states = operation_evidence(contracts)
    verified = {key for key, value in states.items() if value["independentIntegration"] == "PASS"}
    folder_items, inputs, issues = {}, [], []
    secret_keys = {"password", "newPassword", "registrationToken", "oldCode", "newCode"}

    for operation_id, entry in contracts.operations.items():
        operation, owner, route = entry["operation"], entry["file"], entry["route"]
        stage = "A" if entry["owner"] in ("identity", "authorization", "admin-security") else "B" if entry["owner"] == "content" else "C"
        status = {"PASS": "独立验收通过", "FAIL": "最后运行未过·待复验", "PENDING_DEPENDENCY": "依赖待就绪·503已复现",
                  "NOT_IMPLEMENTED": "合同草稿·未实现", "NOT_EXECUTED": "已写入·独立待验"}[states[operation_id]["independentIntegration"]]
        folder = f"{stage} · {entry['owner']}"
        folder_items.setdefault(folder, [])
        headers = [{"key": "X-Request-Id", "value": "{{$guid}}"}]
        required_names = []
        for name in re.findall(r"\{([^}]+)\}", route):
            variables.setdefault(name, "")
            required_names.append(name)
        url = "{{baseUrl}}/api/v1" + re.sub(r"\{([^}]+)\}", r"{{\1}}", route)
        query = []
        for raw in entry["pathItem"].get("parameters", []) + operation.get("parameters", []):
            parameter, parameter_owner = contracts.resolve(raw, owner)
            if parameter["in"] == "query":
                value = sample(parameter["schema"], parameter_owner, parameter["name"])
                query.append({"key": parameter["name"], "value": str(value).lower() if isinstance(value, bool) else str(value),
                              "disabled": not parameter.get("required", False)})
            if parameter["in"] == "header" and parameter["name"].lower() == "idempotency-key":
                headers.append({"key": "Idempotency-Key", "value": "{{effectiveCommandKey}}"})
        security = operation.get("security", contracts.documents[owner].get("security", []))
        subject_route = route == "/subjects" or route.startswith("/subjects/")
        bearer = "{{adminToken}}" if route.startswith("/admin/") else "{{effectiveSubjectToken}}" if subject_route else "{{userToken}}"
        auth = {"type": "noauth"} if not security else {"type": "bearer", "bearer": [{"key": "token", "value": bearer, "type": "string"}]}
        request = {"method": entry["method"], "header": headers, "auth": auth,
                   "url": {"raw": url, "host": ["{{baseUrl}}"], "path": ("api/v1" + route).split("/"), "query": query},
                   "description": f"{operation_id}；{status}。合同：apps/api/contracts/modules/{entry['owner']}/openapi.yaml。按运行说明准备实际资源与版本。"}
        body_sample = None
        if "requestBody" in operation:
            body, body_owner = contracts.resolve(operation["requestBody"], owner)
            media = body.get("content", {})
            if "application/json" in media:
                data = media["application/json"]
                examples = data.get("examples", {})
                body_sample = copy.deepcopy(data["example"]) if "example" in data else None
                if body_sample is None and examples:
                    body_sample = copy.deepcopy(contracts.resolve(next(iter(examples.values())), body_owner)[0]["value"])
                if body_sample is None:
                    body_sample = sample(data["schema"], body_owner)
                errors = contracts.errors(body_sample, data["schema"], body_owner)
                if errors:
                    issues.append({"operationId": operation_id, "errors": errors})

                def template(value, key=""):
                    if isinstance(value, dict):
                        return {k: template(v, k) for k, v in value.items()}
                    if isinstance(value, list):
                        if key == "ids":
                            for i in range(len(value)):
                                variables.setdefault(f"orderId{i+1}", "")
                            return ["{{orderId" + str(i+1) + "}}" for i in range(len(value))]
                        return [template(v, key[:-1] if key.endswith("s") else key) for v in value]
                    if value is None:
                        return None
                    name = key
                    if key == "code":
                        name = "wechatCode" if "Wechat" in operation_id else "emailCode"
                    if key == "email" and operation_id == "identityCreateEmailSession":
                        name = "loginEmail"
                    if key == "expectedVersion":
                        name = content_versions.get(operation_id, key)
                    if key in secret_keys or key == "code" or key.endswith("Id") or key in ("accountCode", "expectedVersion", "expectedContentVersion", "epoch", "writerId", "email"):
                        variables.setdefault(name, 1 if isinstance(value, (int, float)) and not isinstance(value, bool) else "")
                        return "{{" + name + "}}"
                    return value

                body_sample = template(body_sample)
                raw = json.dumps(body_sample, ensure_ascii=False, indent=2)
                for field in ("expectedVersion", "expectedContentVersion", "subjectVersion", "chapterVersion", "questionVersion", "importVersion", "epoch"):
                    raw = raw.replace('"{{' + field + '}}"', '{{' + field + '}}')
                request["body"] = {"mode": "raw", "raw": raw, "options": {"raw": {"language": "json"}}}
                headers.append({"key": "Content-Type", "value": "application/json"})
            else:
                mime = next(iter(media))
                headers.append({"key": "Content-Type", "value": mime})
                request["body"] = {"mode": "file", "file": {"src": "{{imageFile}}"}}
        success = next(int(x) for x in operation["responses"] if x.startswith("2"))
        pre = ["const base=pm.environment.get('baseUrl')||pm.collectionVariables.get('baseUrl');",
               "if(!/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?$/.test(base)) throw new Error('本集合仅用于本地验收');",
               "pm.variables.set('effectiveCommandKey',pm.environment.get('commandKey')||pm.variables.replaceIn('{{$guid}}'));",
               "pm.variables.set('effectiveSubjectToken',pm.environment.get(pm.environment.get('contentRole')==='ADMIN'?'adminToken':'userToken')||'');",
               f"for(const name of {json.dumps(required_names)}) if(!pm.variables.get(name)) throw new Error('请先准备实际资源变量：'+name);"]
        post = [f"const expected=Number(pm.environment.get('expectedStatus')||{success});",
                "pm.test('状态符合本次用例',()=>pm.expect(pm.response.code).to.eql(expected));",
                "const trace=pm.response.headers.all().filter(h=>h.key.toLowerCase()==='x-request-id');",
                "const cache=pm.response.headers.all().filter(h=>h.key.toLowerCase()==='cache-control');",
                "pm.test('响应追踪号唯一且有效',()=>{pm.expect(trace.length).to.eql(1);pm.expect(trace[0].value).to.match(/^[0-9a-f-]{36}$/i);});",
                f"const privateImage={str(operation_id in ('contentReadImage', 'contentUploadImage')).lower()}&&pm.response.code<300;",
                "pm.test('缓存头唯一且符合合同',()=>{pm.expect(cache.length).to.eql(1);pm.expect(cache[0].value).to.eql(privateImage?'private, no-store':'no-store');});",
                "if(pm.response.code===204) pm.test('204为空',()=>pm.expect(pm.response.text()).to.eql(''));",
                "if(pm.response.headers.get('Content-Type')?.includes('application/json')){",
                " const b=pm.response.json();",
                " if(pm.response.code>=400) pm.test('统一错误体',()=>{for(const k of ['code','message','fieldErrors','requestId'])pm.expect(b).to.have.property(k);pm.expect(b.requestId).to.eql(pm.response.headers.get('X-Request-Id'));});",
                " if(pm.response.code===429)pm.test('限流等待时间一致',()=>{const h=pm.response.headers.get('Retry-After');pm.expect(h).to.match(/^[0-9]+$/);pm.expect(Number(h)).to.eql(b.details.retryAfterSeconds);pm.expect(Number(h)).to.be.above(0);});",
                " if(pm.response.code<300){",
                "  if(b.accessToken)pm.environment.set(pm.environment.get('loginRole')==='ADMIN'?'adminToken':'userToken',b.accessToken);",
                "  if(b.registrationToken)pm.environment.set('registrationToken',b.registrationToken);",
                "  for(const key of ['challengeId','emailChangeId','oldChallengeId','newChallengeId','sessionId','accountId','accountCode','subjectId','chapterId','questionId','revisionId','importId','fileId','epoch'])if(b[key]!==undefined&&b[key]!==null)pm.environment.set(key,b[key]);",
                "  if(b.version!==undefined)pm.environment.set('expectedVersion',b.version);",
                "  if(b.accountVersion!==undefined)pm.environment.set('expectedVersion',b.accountVersion);",
                "  if(b.contentVersion!==undefined)pm.environment.set('expectedContentVersion',b.contentVersion);",
                " }",
                "}"]
        if operation_id == "authorizationCreateCollege":
            post.append("if(pm.response.code===201)pm.environment.set('collegeId',pm.response.json().resourceId);")
        if operation_id == "authorizationCreateMajor":
            post.append("if(pm.response.code===201)pm.environment.set('majorId',pm.response.json().resourceId);")
        id_fields = {"contentGetSubject": "subjectId", "contentGetQuestion": "questionId",
                     "contentGetManagedRevision": "revisionId", "contentPrevalidateImport": "importId", "contentGetImport": "importId"}
        if operation_id in id_fields:
            post.append(f"if(pm.response.code<300)pm.environment.set('{id_fields[operation_id]}',pm.response.json().id);")
        version_fields = {"contentCreateSubject": "subjectVersion", "contentGetSubject": "subjectVersion",
                          "contentUpdateSubject": "subjectVersion", "contentSetSubjectStatus": "subjectVersion",
                          "contentCreateChapter": "chapterVersion", "contentUpdateChapter": "chapterVersion",
                          "contentCreateQuestion": "questionVersion", "contentGetQuestion": "questionVersion",
                          "contentReviseQuestion": "questionVersion", "contentSetQuestionStatus": "questionVersion",
                          "contentPrevalidateImport": "importVersion", "contentGetImport": "importVersion",
                          "contentCommitImport": "importVersion", "contentCancelImport": "importVersion"}
        if operation_id in version_fields:
            post.append(f"if(pm.response.code<300)pm.environment.set('{version_fields[operation_id]}',pm.response.json().version);")
        if operation_id in ("contentListChapters", "contentListQuestions"):
            prefix = "chapter" if operation_id == "contentListChapters" else "question"
            post.append(f"if(pm.response.code<300){{const item=pm.response.json().items.find(x=>x.id===pm.variables.get('{prefix}Id'));if(item)pm.environment.set('{prefix}Version',item.version);}}")
        folder_items[folder].append({"name": operation_id, "request": request,
            "event": [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": pre}},
                      {"listen": "test", "script": {"type": "text/javascript", "exec": post}}]})
        inputs.append({"operationId": operation_id, "status": status, "requestBody": body_sample,
                       "requiredPathVariables": required_names, "defaultExpectedStatus": success})
    destination = ROOT / "apps/api/postman"
    destination.mkdir(exist_ok=True)
    collection = {"info": {"name": "QandA MVP · 101接口验收目录", "_postman_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "qanda/mvp/101")),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        "description": "由 apps/api/contracts 生成的接口验收目录，包含76项已实现接口和25项未实现草案。按验收说明准备组织、身份与资源版本。contentRole选择ADMIN或USER；验证码和凭据只填本地私有环境。"},
        "variable": [{"key": "baseUrl", "value": variables["baseUrl"]}],
        "item": [{"name": name, "item": items} for name, items in sorted(folder_items.items())]}
    environment = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "qanda/local/acceptance")), "name": "QandA Local · 空凭据",
        "values": [{"key": k, "value": v, "enabled": True, "type": "secret" if k in secret_keys or "Token" in k or "Code" in k and k != "accountCode" else "default"} for k, v in sorted(variables.items())],
        "_postman_variable_scope": "environment"}
    for filename, content in [("QandA-MVP.postman_collection.json", collection),
                              ("QandA-Local.postman_environment.json", environment),
                              ("QandA-MVP.examples.json", {"scope": "结构样例；资源/版本需由实际响应填充，待验条目不代表业务成功", "operations": inputs})]:
        (destination / filename).write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n")
    assert sum(len(x["item"]) for x in collection["item"]) == 101
    result = {"operations": 101, "independentlyAcceptedOperations": len(verified),
              "independentlyExercisedPositiveOperations": sum(x["positiveHttpObserved"] for x in states.values()),
              "requestExampleSchemaIssues": issues, "blankCredentialEnvironment": True}
    (EVIDENCE / "postman-generation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
