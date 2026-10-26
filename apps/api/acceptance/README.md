# 后端接口验收

验收合同位于 [`../contracts/`](../contracts/)，包含 8 个模块合同和 1 个聚合合同，共 101 个操作。身份、授权、管理和内容模块包含 76 项已实现操作；练习、学习记录和统计模块的 25 项操作标记为未实现草案。

合同根据现存 Postman 集合、服务实现、测试和去敏 HTTP 观察整理。此前版本的 OpenAPI 原件未能恢复，当前合同不保证与其逐字一致；草案中没有证据支持的响应细节保持待定。

## 静态合同校验

QA 工具依赖列在 [`requirements-qa.txt`](requirements-qa.txt)。可使用 `uv` 在被忽略的运行目录建立独立环境：

```sh
uv venv --python 3.12 apps/api/.backend-runtime/verification/quality/tools/python
uv pip install --python apps/api/.backend-runtime/verification/quality/tools/python/bin/python \
  -r apps/api/acceptance/requirements-qa.txt
```

从仓库根目录校验全部 OpenAPI 文档：

```sh
apps/api/.backend-runtime/verification/quality/tools/python/bin/python \
  apps/api/acceptance/contracts.py spec
```

`contracts.py exchanges` 从标准输入读取 HTTP 观察 JSON 数组，并验证合同中的路径、方法、请求参数、请求体、状态、响应媒体、响应头和响应体。运行产物默认写入 `.backend-runtime/verification/quality/`；可用 `QANDA_QUALITY_EVIDENCE_DIR` 指定当前运行批次的证据目录。

```sh
QANDA_QUALITY_EVIDENCE_DIR=apps/api/.backend-runtime/verification/quality \
  apps/api/.backend-runtime/verification/quality/tools/python/bin/python \
  apps/api/acceptance/contracts.py exchanges \
  < apps/api/.backend-runtime/verification/quality/a-http-redacted.json
```

合同、Postman 和台账生成命令：

```sh
QANDA_QUALITY_EVIDENCE_DIR=apps/api/.backend-runtime/verification/quality \
  apps/api/.backend-runtime/verification/quality/tools/python/bin/python apps/api/acceptance/postman.py
QANDA_QUALITY_EVIDENCE_DIR=apps/api/.backend-runtime/verification/quality \
  apps/api/.backend-runtime/verification/quality/tools/python/bin/python apps/api/acceptance/ledger.py
```

Postman 生成器更新 `postman/QandA-MVP.postman_collection.json`、空凭据环境与结构样例。台账写入运行证据目录下的 `ledger/`。

## Kotlin 测试

从仓库根目录运行：

```sh
node apps/api/scripts/backend.mjs test
node apps/api/scripts/backend.mjs postgresTest
```

PostgreSQL 验收使用 Testcontainers 创建独立测试数据库。邮件测试通过本地捕获传输检查邮件流程。

## Postman

导入 [`../postman/QandA-MVP.postman_collection.json`](../postman/QandA-MVP.postman_collection.json) 与 [`../postman/QandA-Local.postman_environment.json`](../postman/QandA-Local.postman_environment.json)。集合的基础地址为本地回环 `8083`；环境凭据字段为空，由运行者在本机填写。请求样例见 [`../postman/QandA-MVP.examples.json`](../postman/QandA-MVP.examples.json)。25 项草案只用于识别操作入口，不代表服务已实现相应行为。
