"""Verify packaged database commands and interactive bootstrap on an isolated test database."""
import json
import os
import pty
import secrets
import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

phase = "configuration"
server = None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = opener.open(request, timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    return response.code, json.loads(response.read())


def command(args, overrides=None):
    result = subprocess.run(java + args, env={**environment, **(overrides or {})}, capture_output=True, timeout=45)
    return result.returncode, result.stdout + result.stderr


def bootstrap():
    master, slave = pty.openpty()
    process = subprocess.Popen(java + ["bootstrap"], stdin=slave, stdout=slave, stderr=slave, env=environment)
    os.close(slave)
    buffer, stage = b"", 0
    prompts = ["管理员用户名：", "管理员姓名：", "管理员密码："]
    values = [username, "命令行验收管理员", password]
    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline and process.poll() is None:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    buffer += os.read(master, 65536)
                except OSError:
                    break
            if stage < len(prompts) and prompts[stage].encode() in buffer:
                os.write(master, (values[stage] + "\n").encode())
                stage, buffer = stage + 1, b""
        assert stage == 3, "INTERACTIVE_PROMPTS"
        return process.wait(timeout=5)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        os.close(master)


def start(log):
    process = subprocess.Popen(java, env=environment, stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline and process.poll() is None:
            try:
                if http("/health")[0] == 200:
                    return process
            except (OSError, ValueError):
                pass
            time.sleep(0.2)
        raise AssertionError("SERVER_READINESS")
    except BaseException:
        process.terminate()
        process.wait(timeout=10)
        raise


try:
    config = json.loads(Path(sys.argv[1]).read_text())
    environment = {key: value for key, value in os.environ.items() if not key.startswith(("TENCENT_", "BACKEND_"))}
    environment.update(config["environment"])
    assert environment["BACKEND_MODE"] == "test", "ISOLATED_TEST_MODE_REQUIRED"
    java = [config["java"], "-Xmx256m", "-jar", config["jar"]]
    base = "http://127.0.0.1:" + environment["BACKEND_API_PORT"] + "/api/v1"
    username, password = "cli_" + uuid.uuid4().hex[:12], secrets.token_urlsafe(24) + "Aa7"
    phase = "startup_requires_explicit_schema"
    status, output = command([])
    assert status != 0 and b"db-init" in output
    phase = "empty_database_initialization"
    assert command(["db-init"])[0] == 0
    phase = "existing_database_protection"
    assert command(["db-init"])[0] != 0
    phase = "noninteractive_bootstrap_protection"
    assert command(["bootstrap"])[0] != 0
    phase = "interactive_bootstrap"
    assert bootstrap() == 0
    phase = "repeat_bootstrap_protection"
    assert bootstrap() != 0
    phase = "production_reset_protection"
    assert command(["db-reset"], {"BACKEND_MODE": "production"})[0] != 0
    phase = "wrong_database_protection"
    assert command(["db-reset"], {"BACKEND_DB_URL": environment["BACKEND_DB_URL"].replace("/qanda_backend", "/other")})[0] != 0
    with tempfile.TemporaryFile() as log:
        phase = "packaged_http_login"
        server = start(log)
        status, session = http("/admin/auth/sessions", {"username": username, "password": password, "deviceId": str(uuid.uuid4())})
        assert status == 200
        status, actor = http("/admin/auth/me", token=session["accessToken"])
        assert status == 200 and actor["role"] == "PLATFORM_ADMIN"
        assert http("/me", token=session["accessToken"])[0] == 403
        server.terminate()
        server.wait(timeout=10)
        server = None
        phase = "explicit_test_database_reset"
        assert command(["db-reset"])[0] == 0
        server = start(log)
        assert http("/admin/auth/sessions", {"username": username, "password": password, "deviceId": str(uuid.uuid4())})[0] == 401
    print(json.dumps({"status": "PASS", "realPty": True, "emptyInitialization": True, "resetGuards": True, "normalAdminLogin": True, "repeatBootstrapRejected": True, "explicitReset": True, "credentialsInArgumentsOrEnvironment": False}))
except Exception as error:
    print(json.dumps({"status": "FAIL", "phase": phase, "errorType": type(error).__name__}))
    sys.exit(1)
finally:
    if server and server.poll() is None:
        server.terminate()
        server.wait(timeout=10)
