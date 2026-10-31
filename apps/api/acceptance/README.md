# 后端接口验收

当前 `1.0.0` 合同包含 118 个操作，聚合入口为 [`../contracts/openapi.yaml`](../contracts/openapi.yaml)，9 个模块合同引用其中的共享模型。合同从运行中的 Controller 和 DTO 导出；实际 HTTP 观察另行验证路径、参数、请求体、状态、响应媒体、全部响应头值和响应体。

## Maven 验收

从仓库根目录执行，需要 JDK 21、Node.js、Python 3 和运行中的 Docker：

```sh
node apps/api/scripts/backend.mjs test
node apps/api/scripts/backend.mjs verify
```

`test` 执行单元测试；`verify` 还执行 Testcontainers PostgreSQL 和 Mailpit 的 HTTP 验收，并通过打包后的 JAR 检查数据库初始化与交互式首管创建。测试数据库均为临时隔离容器，测试结束后删除。

验收覆盖注册和资料、身份隔离、内容权限、发布导入、不可变修订、推荐与课程收藏、两种练习反馈、并发保存和交卷、离线快照、跨设备写入交接、简答自评、错题掌握、反馈处理、公告、上海日期边界和安全策略。命令行验收使用真实 PTY 输入随机首管凭据，并检查重复初始化、重复首管创建、运行模式与数据库名称保护。

默认运行证据位于忽略目录 `.backend-runtime/verification/`：

| 文件 | 内容 |
| --- | --- |
| `openapi.json` | 本次服务运行导出的合同 |
| `http-redacted.json` | 去除密码、验证码及令牌的 HTTP 请求与响应 |
| `bootstrap-cli.json` | 打包程序和真实终端验收结果 |
| `spec-validation.json` | 全部合同文档结构校验 |
| `http-schema-validation.json` | 逐次 HTTP Schema 校验 |
| `operation-coverage.json` | 逐操作成功观察与 Schema 状态 |
| `miniapp-live.json` | 真实小程序请求层、Repository、ViewModel 对接临时 PostgreSQL 与 HTTP 的练习闭环 |
| `practice-sync-observation.json` | 4 题练习 30 次串行保存的响应大小、进程 CPU 与用时观察 |

已注册、实际成功观察、Schema 通过是不同证据。台账依据当前运行文件生成，缺少记录时显示未观察；不会依据接口存在自动声称验收通过。构建报告位于 `target/surefire-reports/` 和 `target/failsafe-reports/`。

## 合同与 Postman

QA 依赖见 [`requirements-qa.txt`](requirements-qa.txt)。首次使用可在忽略目录创建工具环境：

```sh
uv venv --python 3.12 apps/api/.backend-runtime/verification/quality/tools/python
uv pip install --python apps/api/.backend-runtime/verification/quality/tools/python/bin/python \
  -r apps/api/acceptance/requirements-qa.txt
```

运行集成验收后，从仓库根目录执行：

```sh
QA_PY=apps/api/.backend-runtime/verification/quality/tools/python/bin/python
"$QA_PY" apps/api/acceptance/contracts.py export
"$QA_PY" apps/api/acceptance/contracts.py spec \
  > apps/api/.backend-runtime/verification/spec-validation.json
"$QA_PY" apps/api/acceptance/contracts.py exchanges \
  < apps/api/.backend-runtime/verification/http-redacted.json \
  > apps/api/.backend-runtime/verification/http-schema-validation.json
"$QA_PY" apps/api/acceptance/postman.py
"$QA_PY" apps/api/acceptance/ledger.py
```

可用 `QANDA_QUALITY_EVIDENCE_DIR` 指定另一批运行证据。`export --source` 可指定该次运行的 OpenAPI JSON。合同校验包含格式、类型、必填、重复值、未知字段及数值边界的反例自检。

导入生成的 [Postman 集合](../postman/QandA-MVP.postman_collection.json)和[本地环境](../postman/QandA-Local.postman_environment.json)。账号、密码、邮箱、验证码和令牌变量为空，由运行者填写；资源 ID、并发字段和当前令牌由响应脚本提取。每个写意图生成幂等键，需要模拟同一意图重试时设置 `commandKey` 为之前的 `lastCommandKey`。请求样例见 [`QandA-MVP.examples.json`](../postman/QandA-MVP.examples.json)。

本次自动化验收使用本地 SMTP 捕获和明确的测试微信身份。真实腾讯云 SES、官方微信、客户端联调及容量压测各自需要对应的运行证据。
