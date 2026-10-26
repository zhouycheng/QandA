"""Exercise the real non-Web command through a PTY; never emit secret inputs."""
import json
import os
import pty
import re
import secrets
import select
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


def http(url, method="GET", body=None, token=None):
    headers = {}
    if body is not None:
        body = json.dumps(body, separators=(",", ":")).encode()
        headers.update({"Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4())})
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    return response.code, json.loads(raw) if raw else {}


def capture_code(base, recipient):
    status, listing = http(base + "/api/v1/messages")
    if status != 200:
        return None
    for message in listing.get("messages", []):
        if any(item.get("Address") == recipient for item in message.get("To", [])):
            _, detail = http(base + "/api/v1/message/" + message["ID"])
            found = re.search(r"(?<!\d)(\d{6})(?!\d)", detail.get("Text", ""))
            if found:
                return found.group(1)
    return None


phase = "configuration"
process = None
try:
    with open(sys.argv[1], encoding="utf8") as source:
        config = json.load(source)
    environment = {key: value for key, value in os.environ.items() if not key.startswith(("TENCENT_", "BACKEND_"))}
    environment.update(config["environment"])
    master, slave = pty.openpty()
    process = subprocess.Popen([config["java"], "-Xmx256m", "-jar", config["jar"], "bootstrap"], stdin=slave, stdout=slave, stderr=slave, env=environment)
    os.close(slave)
    password = secrets.token_urlsafe(24)
    buffer = ""
    stage = 0
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline and process.poll() is None:
        readable, _, _ = select.select([master], [], [], 0.1)
        if readable:
            try:
                buffer += os.read(master, 65536).decode("utf8", "replace")
            except OSError:
                break
        if stage == 0 and "验证邮箱：" in buffer:
            phase = "email_stdin"
            os.write(master, (config["recipient"] + "\n").encode())
            stage, buffer = 1, ""
        elif stage == 1 and "邮箱验证码：" in buffer:
            phase = "captured_register_proof"
            code = capture_code(config["capture"], config["recipient"])
            if code:
                os.write(master, (code + "\n").encode())
                stage, buffer, code = 2, "", None
        elif stage == 2 and "密码：" in buffer:
            phase = "password_stdin"
            os.write(master, (password + "\n").encode())
            stage, buffer = 3, ""
        elif stage == 3 and "确认密码：" in buffer:
            phase = "confirmation_stdin"
            os.write(master, (password + "\n").encode())
            stage, buffer = 4, ""
    if process.poll() is None:
        process.terminate()
    if process.wait(timeout=10) != 0 or stage != 4:
        raise RuntimeError("BOOTSTRAP_PROCESS_FAILED")
    phase = "normal_admin_login"
    status, grant = http(config["api"] + "/api/v1/auth/sessions", "POST", {"email": config["recipient"], "password": password, "clientType": "ADMIN_WEB", "deviceId": str(uuid.uuid4()), "rememberMe": False})
    if status != 201:
        raise RuntimeError("LOGIN_FAILED")
    password = None
    token = grant["accessToken"]
    status, _ = http(config["api"] + "/api/v1/admin/users", token=token)
    if status != 200:
        raise RuntimeError("ADMIN_GUARD_FAILED")
    phase = "real_organization_setup"
    status, college = http(config["api"] + "/api/v1/admin/colleges", "POST", {"name": "平台邮件验收学院"}, token)
    if status != 201:
        raise RuntimeError("COLLEGE_SETUP_FAILED")
    college_id = college["resourceId"]
    status, major = http(config["api"] + "/api/v1/admin/colleges/" + college_id + "/majors", "POST", {"name": "平台邮件验收专业"}, token)
    if status != 201:
        raise RuntimeError("MAJOR_SETUP_FAILED")
    token = None
    print(json.dumps({"status": "PASS", "realPty": True, "proofAndPasswordInArgumentsOrEnvironment": False, "capturedRegisterProof": True, "normalAdminLogin": True, "adminGuard": True, "collegeId": college_id, "majorId": major["resourceId"]}, ensure_ascii=False))
except Exception as error:
    if process and process.poll() is None:
        process.terminate()
    print(json.dumps({"status": "FAIL", "phase": phase, "errorType": type(error).__name__}))
    sys.exit(1)
