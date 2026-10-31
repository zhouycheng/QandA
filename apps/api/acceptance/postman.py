"""从当前 OpenAPI 合同生成 Postman 集合、空凭据环境和请求样例。"""
import json
import uuid
from urllib.parse import urlencode
from contracts import Contracts, ROOT

ALIASES = {"question-banks": "questionBankId", "questions": "questionId", "chapters": "chapterId", "subjects": "subjectId", "colleges": "collegeId", "majors": "majorId", "administrators": "administratorId", "users": "userId", "students": "userId", "sessions": "sessionId", "question-feedback": "feedbackId", "course-requests": "courseRequestId", "announcements": "announcementId", "favorites": "questionId", "images": "fileId", "email-challenges": "challengeId", "email-registrations": "userId", "wechat-registrations": "userId", "finish": "resultId"}


def main():
    contracts = Contracts()
    variables = {"baseUrl": "http://127.0.0.1:8083", "adminToken": "", "userToken": "", "commandKey": "", "password": "", "newPassword": "", "email": "", "code": "", "oldCode": "", "newCode": "", "registrationToken": "", "imageFile": "", "username": "", "writerToken": "", "deviceId": "", "clientSequence": 1, "acknowledgedSequence": 0}

    def sample(schema, owner, field=""):
        schema, owner = contracts.resolve(schema, owner)
        if "allOf" in schema:
            result = {}
            for item in schema["allOf"]:
                result.update(sample(item, owner))
            return result
        if "enum" in schema:
            return schema["enum"][0]
        kind = schema.get("type", "object" if "properties" in schema else "string")
        if isinstance(kind, list):
            kind = next((x for x in kind if x != "null"), "null")
        if kind == "object":
            result = {key: sample(value, owner, key) for key, value in schema.get("properties", {}).items() if key in schema.get("required", [])}
            if "type" in schema.get("properties", {}) and "stem" in schema.get("properties", {}):
                result.update(type="SINGLE_CHOICE", stem="示例题干", options=[{"key": "A", "content": "选项甲"}, {"key": "B", "content": "选项乙"}], correctAnswer=["A"], explanation="示例解析")
            if "selectionKind" in schema.get("properties", {}):
                result.update(count=1, order="SEQUENTIAL", selectionKind="NORMAL")
            return result
        if kind == "array":
            return [sample(schema["items"], owner) for _ in range(schema.get("minItems", 0))]
        if kind in ("integer", "number"):
            return {"count": 1, "maxAttempts": 5, "lockMinutes": 30, "sessionMinutes": 30, "minPasswordLength": 12, "durationSeconds": 0, "currentIndex": 0, "sortOrder": 0}.get(field, max(schema.get("minimum", 1), 1))
        if kind == "boolean":
            return field in ("lockEnabled", "requireLetter", "requireNumber")
        if kind == "null":
            return None
        if schema.get("format") == "uuid":
            return str(uuid.UUID(int=1))
        if schema.get("format") == "date-time":
            return "2026-10-28T00:00:00.000Z"
        if schema.get("format") == "date":
            return "2026-10-29" if field == "endDateExclusive" else "2026-10-28"
        return {"scopeType": "ALL", "status": "ACTIVE", "role": "CONTENT_ADMIN", "feedback": "AFTER_FINISH", "order": "SEQUENTIAL", "selectionKind": "NORMAL", "purpose": "REGISTER", "email": "student@example.test", "password": "Example-password-123", "newPassword": "New-example-password-123", "code": "000000", "oldCode": "000000", "newCode": "000000", "category": "ANSWER", "assessment": "CORRECT", "username": "content_editor"}.get(field, "示例内容")

    def template(value, field=""):
        if isinstance(value, dict):
            return {key: template(item, key) for key, item in value.items()}
        if isinstance(value, list):
            return [template(item, field) for item in value]
        if field.endswith("Id") or field in variables or field in ("expectedVersion", "expectedContentVersion", "clientSequence"):
            variables.setdefault(field, 1 if isinstance(value, int) else "")
            return "{{" + field + "}}"
        return value

    folders, examples = {}, []
    for operation_id, entry in contracts.operations.items():
        operation, owner, route = entry["operation"], entry["file"], entry["route"]
        parameters = operation.get("parameters", [])
        path = route
        for parameter in parameters:
            if parameter["in"] == "path":
                name = parameter["name"]
                prefix = route.split("{" + name + "}")[0].rstrip("/").split("/")[-1]
                variable = ALIASES.get(prefix, name) if name == "id" else "questionBankId" if name == "bankId" else name
                variables.setdefault(variable, "")
                path = path.replace("{" + name + "}", "{{" + variable + "}}")
        headers = [{"key": "X-Request-Id", "value": "{{$guid}}"}]
        if any(x["in"] == "header" and x["name"] == "Idempotency-Key" for x in parameters):
            headers.append({"key": "Idempotency-Key", "value": "{{effectiveCommandKey}}"})
        for parameter in parameters:
            if parameter["in"] == "header" and parameter["name"] == "X-Practice-Writer":
                headers.append({"key": "X-Practice-Writer", "value": "{{writerToken}}"})
        query = [{"key": p["name"], "value": str(sample(p["schema"], owner, p["name"])), "disabled": not p.get("required", False)} for p in parameters if p["in"] == "query"]
        for parameter in query:
            if parameter["key"] in ("expectedVersion", "deviceId"):
                variables.setdefault(parameter["key"], 1 if parameter["key"] == "expectedVersion" else "")
                parameter["value"] = "{{" + parameter["key"] + "}}"
        token_variable = "adminToken" if "/admin/" in route else "userToken"
        auth = {"type": "bearer", "bearer": [{"key": "token", "value": "{{" + token_variable + "}}", "type": "string"}]} if operation.get("security") else {"type": "noauth"}
        required_query = urlencode({q["key"]: q["value"] for q in query if not q["disabled"]}, safe="{}")
        request = {"method": entry["method"], "header": headers, "auth": auth, "url": {"raw": "{{baseUrl}}" + path + ("?" + required_query if required_query else ""), "host": ["{{baseUrl}}"], "path": path.lstrip("/").split("/"), "query": query}, "description": operation_id}
        body_sample = None
        if "requestBody" in operation:
            media = operation["requestBody"]["content"]
            if "application/json" in media:
                schema = media["application/json"]["schema"]
                concrete = sample(schema, owner)
                if route == "/api/v1/practice/sessions":
                    concrete["deviceId"] = str(uuid.UUID(int=1))
                if route.startswith("/api/v1/practice/sessions/{id}/") and entry["method"] in ("PUT", "POST") and not route.endswith(("writer-acquire", "self-assessment")):
                    concrete["writerToken"] = str(uuid.UUID(int=1))
                    if route.endswith(("progress", "progress-ack")):
                        concrete["clientSequence"] = 1
                assert not contracts.errors(concrete, schema, owner), operation_id
                body_sample = template(concrete)
                if route.endswith("writer-release"):
                    body_sample["clientSequence"] = "{{acknowledgedSequence}}"
                raw = json.dumps(body_sample, ensure_ascii=False, indent=2)
                for field in ("expectedVersion", "expectedContentVersion", "clientSequence", "acknowledgedSequence"):
                    raw = raw.replace('"{{' + field + '}}"', '{{' + field + '}}')
                request["body"] = {"mode": "raw", "raw": raw, "options": {"raw": {"language": "json"}}}
                headers.append({"key": "Content-Type", "value": "application/json"})
            else:
                headers.append({"key": "Content-Type", "value": "image/png"})
                request["body"] = {"mode": "file", "file": {"src": "{{imageFile}}"}}
        success = next(int(code) for code in operation["responses"] if code.startswith("2"))
        parts = route.rstrip("/").split("/")
        resource = ALIASES.get(parts[-2] if parts[-1] == "{id}" else parts[-1])
        pre = ["const base=pm.environment.get('baseUrl');", "if(!/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?$/.test(base))throw new Error('本集合用于本地验收');", "const key=pm.environment.get('commandKey')||pm.variables.replaceIn('{{$guid}}');", "pm.variables.set('effectiveCommandKey',key);pm.environment.set('lastCommandKey',key);"]
        post = [f"pm.test('状态符合合同',()=>pm.expect(pm.response.code).to.eql({success}));", "pm.test('禁止缓存',()=>pm.expect(pm.response.headers.get('Cache-Control')).to.eql('no-store'));", "if(pm.response.headers.get('Content-Type')?.includes('application/json')&&pm.response.code<300){const b=pm.response.json();", "const session=b.session||b;", f"if(session.accessToken)pm.environment.set({json.dumps(token_variable)},session.accessToken);", "if(b.registrationToken)pm.environment.set('registrationToken',b.registrationToken);", "if(b.version!==undefined)pm.environment.set('expectedVersion',b.version);if(b.contentVersion!==undefined)pm.environment.set('expectedContentVersion',b.contentVersion);"]
        if resource:
            variables.setdefault(resource, "")
            post.append(f"if(b.id)pm.environment.set({json.dumps(resource)},b.id);")
        post.append("const w=b.writer||b;if(w.writerToken)pm.environment.set('writerToken',w.writerToken);if(w.acknowledgedSequence!==undefined){pm.environment.set('acknowledgedSequence',w.acknowledgedSequence);pm.environment.set('clientSequence',w.acknowledgedSequence+1);}")
        post.append("for(const key of ['sessionId','revisionId','subjectId','questionBankId']){if(b[key])pm.environment.set(key,b[key]);}")
        post.append("}")
        folders.setdefault(entry["owner"], []).append({"name": operation_id, "request": request, "event": [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": pre}}, {"listen": "test", "script": {"type": "text/javascript", "exec": post}}]})
        examples.append({"operationId": operation_id, "method": entry["method"], "path": route, "body": body_sample})
    destination = ROOT / "apps/api/postman"
    destination.mkdir(parents=True, exist_ok=True)
    collection = {"info": {"name": "QandA 1.0.0", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"}, "item": [{"name": name, "item": items} for name, items in sorted(folders.items())]}
    environment = {"name": "QandA Local", "values": [{"key": key, "value": value, "enabled": True, "type": "secret" if key in ("password", "newPassword", "adminToken", "userToken", "registrationToken", "writerToken") else "default"} for key, value in variables.items()], "_postman_variable_scope": "environment"}
    for name, value in [("QandA-MVP.postman_collection.json", collection), ("QandA-Local.postman_environment.json", environment), ("QandA-MVP.examples.json", examples)]:
        (destination / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"operations": len(examples), "folders": len(folders)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
