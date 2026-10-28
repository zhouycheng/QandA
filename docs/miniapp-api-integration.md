# 小程序接口接入台账

核对日期：2026-10-28。接口集合取自 `apps/api/contracts/openapi.yaml`；逐项以当前 Controller 和小程序页面调用链核对。表中“已接入待验收”表示代码已有真实页面或生命周期调用，真实设备及完整 HTTP 业务验收须结合运行记录确认。仅存在导出函数的能力不计为接入。

## 调用与数据约定

- 正式运行由 App 启用在线仓储，公共请求统一经 `repositories/api-transport.js` 使用 `/api/v1`、学生 Bearer token、请求追踪及写入幂等键；管理员接口使用独立管理员身份。
- 页面只通过 ViewModel 和 Repository 组织业务。目录按服务端分页完整读取；课程、题库元数据预载后渲染，题目正文按需读取。资料与学习快照按账号隔离，并发刷新合并，学习及目录刷新设置 10 秒复用窗口。
- `remote-data-repository.js` 的题目展示映射不等于练习快照；答题使用 `online-practice.js` 的修订快照。答案展示遵守确认状态、反馈模式及交卷状态；题目详情在无对应练习上下文时展示题干和选项。
- 最近练习首批读取 20 条；后台等待记录独立保留并提供返回入口。
- 同一练习的草稿、在途命令和业务版本分别保存；同步确认前保留本地答案。队列限频与跨端接管规则见本轮实现及测试，新增字段优先保持 `/api/v1` 既有调用兼容。

## 版本与扩展约束

- 当前 `/api/v1` 保留原接口的路径和既有参数；新增练习配置、离线判题与写入所有权字段为可选能力。未启用写入所有权的既有会话沿用版本校验；启用后的写请求必须使用本次有效凭证。
- 练习配置、题目修订与题序在创建时固定。业务版本用于并发校验，本机序号用于确认同步，两者分别递增；接管后服务端为新写入方从零确认序号。
- 后续增加字段优先保持可选；改变题型含义、计分、字段类型或必填条件时使用新接口或新版本。客户端草稿格式独立版本化，未知格式保留数据并提示更新。
- 管理端使用独立认证；用户 Web 复用学生接口、业务版本、幂等及交接协议。统计使用服务端统一口径，答案展示由题型、确认状态和反馈模式共同决定。

## 逐接口记录

权限列“学生”表示登录学生且受资源所有权/可见性校验；“管理员”表示独立后台权限，具体写权限由各 Controller/Service 校验。证据列指静态调用链及自动检查，正式运行验收另行追加。

| 方法与路径 | operationId | 用途 | 适用端 / 权限 | 小程序入口与触发动作 | 调用链 | 接入状态 / 未使用原因与后续建议 | 兼容约束 / 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/v1/admin/administrators` | `Admin_list_GET` | 读取管理员 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/administrators` | `Admin_create_POST` | 创建管理员 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `DELETE /api/v1/admin/administrators/{id}` | `Admin_disable_DELETE` | 删除或撤销管理员 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/administrators/{id}` | `Admin_update_PUT` | 更新管理员 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/announcements` | `Operations_adminAnnouncements_GET` | 读取公告 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/announcements` | `Operations_createAnnouncement_POST` | 创建公告 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `DELETE /api/v1/admin/announcements/{id}` | `Operations_deleteAnnouncement_DELETE` | 删除或撤销公告 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/announcements/{id}` | `Operations_updateAnnouncement_PUT` | 更新公告 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/audit-logs` | `Admin_logs_GET` | 读取操作日志 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/auth/logout` | `Admin_logout_POST` | 创建注销登录 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/auth/me` | `Admin_me_GET` | 读取当前身份 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/auth/sessions` | `Admin_login_POST` | 创建登录会话 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/colleges` | `Catalog_adminColleges_GET` | 读取学院 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/colleges` | `Catalog_createCollege_POST` | 创建学院 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/colleges/{id}` | `Catalog_updateCollege_PUT` | 更新学院 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/colleges/{id}/majors` | `Catalog_adminMajors_GET` | 读取专业 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/course-requests` | `Operations_adminRequests_GET` | 读取缺课需求 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/course-requests/{id}` | `Operations_handleRequest_PUT` | 更新缺课需求 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/dashboard` | `Operations_dashboard_GET` | 读取后台概览 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/majors` | `Catalog_createMajor_POST` | 创建专业 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/majors/{id}` | `Catalog_updateMajor_PUT` | 更新专业 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/question-banks` | `Content_adminBanks_GET` | 读取题库 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/question-banks` | `Content_createBank_POST` | 创建题库 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `DELETE /api/v1/admin/question-banks/{bankId}/chapters/{id}` | `Content_deleteChapter_DELETE` | 删除或撤销章节 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/question-banks/{bankId}/chapters/{id}` | `Content_updateChapter_PUT` | 更新章节 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/question-banks/{id}` | `Content_adminBank_GET` | 读取题库 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/question-banks/{id}` | `Content_updateBank_PUT` | 更新题库 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/question-banks/{id}/chapter-order` | `Content_reorder_PUT` | 更新章节顺序 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/question-banks/{id}/chapters` | `Content_adminChapters_GET` | 读取章节 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/question-banks/{id}/chapters` | `Content_createChapter_POST` | 创建章节 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/question-banks/{id}/images` | `File_upload_POST` | 创建题库图片 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/question-banks/{id}/import-preview` | `Content_preview_POST` | 创建题目导入预览 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/question-banks/{id}/imports` | `Content_importQuestions_POST` | 创建题目导入 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/question-banks/{id}/publication` | `Content_publish_PUT` | 更新题库发布状态 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/question-banks/{id}/questions` | `Content_adminQuestions_GET` | 读取题目 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/question-feedback` | `Operations_adminFeedback_GET` | 读取题目反馈 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/question-feedback/{id}` | `Operations_handleFeedback_PUT` | 更新题目反馈 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/questions` | `Content_createQuestion_POST` | 创建题目 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `DELETE /api/v1/admin/questions/{id}` | `Content_deactivateQuestion_DELETE` | 删除或撤销题目 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/questions/{id}` | `Content_adminQuestion_GET` | 读取题目 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/questions/{id}` | `Content_updateQuestion_PUT` | 更新题目 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/security-policy` | `Admin_policy_GET` | 读取管理员安全策略 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/security-policy` | `Admin_policy_PUT` | 更新管理员安全策略 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/statistics/activity` | `Learning_activity_GET` | 读取平台活跃统计 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/statistics/organizations` | `Learning_organizations_GET` | 读取组织学习统计 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/statistics/rankings` | `Learning_rankings_GET` | 读取学习排名 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/statistics/summary` | `Learning_adminSummary_GET` | 读取学习统计汇总 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/students/{id}/practice-history` | `Learning_studentHistory_GET` | 读取练习历史 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/students/{id}/practice-history/{sessionId}` | `Learning_studentResult_GET` | 读取练习历史 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/students/{id}/statistics` | `Learning_studentSummary_GET` | 读取学习统计 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/subjects` | `Catalog_adminSubjects_GET` | 读取课程 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `POST /api/v1/admin/subjects` | `Catalog_createSubject_POST` | 创建课程 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/subjects/{id}` | `Catalog_updateSubject_PUT` | 更新课程 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/users` | `Admin_users_GET` | 读取学生账号 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/admin/users/{id}` | `Admin_user_GET` | 读取学生账号 | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `PUT /api/v1/admin/users/{id}/status` | `Admin_userStatus_PUT` | 更新status | 管理端 / 管理员 | — | — | 其他端专用；随管理端接入验收 | 独立管理员令牌；Controller + OpenAPI |
| `GET /api/v1/announcements` | `Operations_announcements_GET` | 读取公告 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/auth/email-challenges` | `Identity_requestPublicEmailChallenge_POST` | 验证码挑战 | 小程序、用户 Web / 公开挑战/注册或登录 | 注册/找回密码发送验证码 | register/forgot-password → AuthFormViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/email-registrations` | `Identity_registerEmail_POST` | 邮箱注册 | 小程序、用户 Web / 公开挑战/注册或登录 | 注册页提交 | register → RegisterViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/password-resets` | `Identity_resetPassword_POST` | 重置密码 | 小程序、用户 Web / 公开挑战/注册或登录 | 找回密码页提交 | forgot-password → ForgotPasswordViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/sessions` | `Identity_login_POST` | 创建学生会话 | 小程序、用户 Web / 公开挑战/注册或登录 | 登录页输入邮箱密码 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `DELETE /api/v1/auth/sessions/current` | `Identity_logout_DELETE` | 撤销当前会话 | 小程序、用户 Web / 学生 | 我的退出登录 | my → MyViewModel → auth-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/wechat-registrations` | `Identity_registerWechat_POST` | 注册微信用户 | 小程序、用户 Web / 公开挑战/注册或登录 | 首次微信登录 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/wechat-sessions` | `Identity_wechatLogin_POST` | 微信身份交换 | 小程序、用户 Web / 公开挑战/注册或登录 | 登录页微信登录 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/colleges` | `Catalog_colleges_GET` | 学院目录 | 小程序、用户 Web / 公开目录 | 账号页学院选项 | account → AccountViewModel → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/colleges/{id}/majors` | `Catalog_majors_GET` | 读取专业 | 小程序、用户 Web / 公开目录 | — | — | 无入口；已预留目录读取方法，专业选择控件待补 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/files/{id}` | `File_read_GET` | 读取题目图片 | 各端 / 按文件可见性 | — | — | 基础设施接口；文件 UI 接入状态需逐题核验 | 文件授权与缓存规则；Controller + OpenAPI |
| `GET /api/v1/health` | `Health_health_GET` | 健康检查 | 各端 / 公开 | — | — | 基础设施接口；由服务健康检查调用 | 保持状态及版本字段兼容；Controller + OpenAPI |
| `GET /api/v1/me` | `Identity_me_GET` | 读取账号资料 | 小程序、用户 Web / 学生 | 我的/账号页刷新及登录后 | my/account → MyViewModel/AccountViewModel → remote-data-repository → api-transport；登录 → auth-gateway | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/course-requests` | `Operations_requests_GET` | 读取缺课需求 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/course-requests` | `Operations_requestCourse_POST` | 创建缺课需求 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/email-binding` | `Identity_changeEmail_PUT` | 更新邮箱绑定 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/email-challenges` | `Identity_requestOwnEmailChallenge_POST` | 创建邮箱验证码挑战 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/favorites` | `Discovery_favorites_GET` | 收藏列表 | 小程序、用户 Web / 学生 | 首页/复盘/收藏刷新 | subject-list/stats/wrong-book → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `DELETE /api/v1/me/favorites/{id}` | `Discovery_unfavorite_DELETE` | 取消收藏 | 小程序、用户 Web / 学生 | 答题/详情取消收藏及收藏本管理 | practice/question-detail/wrong-book → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/me/favorites/{id}` | `Discovery_favorite_PUT` | 收藏题目 | 小程序、用户 Web / 学生 | 答题或题目详情收藏 | practice/question-detail → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/me/password` | `Identity_changePassword_PUT` | 更新密码 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/practice-history` | `Learning_history_GET` | 读取练习历史 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/practice-history/{id}` | `Learning_record_GET` | 读取练习历史 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/profile` | `Identity_profile_GET` | 读取个人资料 | 小程序、用户 Web / 学生 | — | — | 无入口；账号资料统一经 GET /me 读取，保留此接口兼容其他客户端 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/profile` | `Identity_updateProfile_PUT` | 更新昵称与院系资料 | 小程序、用户 Web / 学生 | 账号页保存资料 | account → AccountViewModel → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/question-feedback` | `Operations_feedback_GET` | 读取题目反馈 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/question-feedback` | `Operations_submitFeedback_POST` | 创建题目反馈 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/question-progress` | `Learning_questionProgress_GET` | 逐题最近已判定结果与题库进度 | 小程序、用户 Web / 学生 | 首页/题库进度与收藏已练习筛选 | subject-list/bank-detail/wrong-book → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/recent-learning` | `Learning_recent_GET` | 最近练习 | 小程序、用户 Web / 学生 | 首页继续练习 | subject-list → SubjectListViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/recommendations` | `Discovery_recommendations_GET` | 读取课程推荐 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/sessions` | `Identity_listSessions_GET` | 读取登录会话 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `DELETE /api/v1/me/sessions/{id}` | `Identity_revokeSession_DELETE` | 删除或撤销登录会话 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/statistics` | `Learning_summary_GET` | 个人统计；WEEK/MONTH/ALL | 小程序、用户 Web / 学生 | 复盘指标与首页摘要 | stats/subject-list → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/statistics/days` | `Learning_days_GET` | 每日学习量 | 小程序、用户 Web / 学生 | 复盘趋势和热力图 | stats → StatsViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/subjects` | `Discovery_courses_GET` | 读取课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `DELETE /api/v1/me/subjects/{id}` | `Discovery_removeCourse_DELETE` | 删除或撤销课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/subjects/{id}` | `Discovery_saveCourse_PUT` | 更新课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/wechat-binding` | `Identity_bindWechat_PUT` | 更新微信绑定 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/wrong-questions` | `Learning_wrong_GET` | 错题与已掌握列表 | 小程序、用户 Web / 学生 | 首页/复盘/错题本刷新 | subject-list/stats/wrong-book → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/wrong-questions/{id}/history` | `Learning_wrongHistory_GET` | 读取历次答题记录 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/practice/scope-preview` | `Practice_preview_POST` | 创建练习范围预览 | 小程序、用户 Web / 学生 | — | — | 无入口；创建时服务端校验范围，后续需要题量预览时接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/practice/sessions` | `Practice_create_POST` | 创建配置及题目快照 | 小程序、用户 Web / 学生 | 题库配置确认/首页模拟练习/错题收藏练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}` | `Practice_read_GET` | 读取会话 | 小程序、用户 Web / 学生 | 恢复云端练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/cancel` | `Practice_cancel_POST` | 创建取消练习 | 小程序、用户 Web / 学生 | — | — | 无入口；离开页面保留草稿，显式取消练习入口待补 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/practice/sessions/{id}/finish` | `Practice_finish_POST` | 后端判题与正式结果 | 小程序、用户 Web / 学生 | 交卷及联网后补交 | practice → PracticeViewModel → online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/practice/sessions/{id}/items/{itemId}/self-assessment` | `Practice_assess_PUT` | 保存自评结果 | 小程序、用户 Web / 学生 | 简答题自评同步 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/practice/sessions/{id}/progress` | `Practice_progress_PUT` | 更新progress | 小程序、用户 Web / 学生 | — | — | 无入口；在线同步采用紧凑确认接口，保留既有客户端兼容 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/practice/sessions/{id}/progress-ack` | `Practice_progressAck_PUT` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/result` | `Practice_result_GET` | 读取正式结果 | 小程序、用户 Web / 学生 | 交卷/恢复已完成练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/snapshot` | `Practice_snapshot_GET` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/writer-acquire` | `Practice_acquireWriter_POST` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/writer-release` | `Practice_releaseWriter_POST` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/writer-state` | `Practice_writerState_GET` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/question-banks` | `Content_banks_GET` | 已发布题库目录 | 小程序、用户 Web / 学生 | 首页/题库刷新 | subject-list/bank-detail → SubjectListViewModel/BankDetailViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/question-banks/{id}` | `Content_bank_GET` | 获取内容版本和题量 | 小程序、用户 Web / 学生 | 直接进入练习且无目录缓存 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/question-banks/{id}/chapters` | `Content_chapters_GET` | 读取章节 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/question-banks/{id}/questions` | `Content_questions_GET` | 读取题目 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/questions` | `Content_search_GET` | 跨题库分页检索题干及选项；输入合并300毫秒 | 小程序、用户 Web / 学生 | 首页搜索关键词和加载更多 | subject-list → SubjectListViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/questions/{id}` | `Content_question_GET` | 读取题目正文 | 小程序、用户 Web / 学生 | 错题/收藏进入题目详情 | question-detail → QuestionDetailViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/subjects` | `Catalog_subjects_GET` | 课程目录 | 小程序、用户 Web / 学生 | 首页/题库刷新 | subject-list/bank-detail → SubjectListViewModel/BankDetailViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/subjects/{id}` | `Catalog_subject_GET` | 读取课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |

当前合同合计 **117** 项操作。本表以方法和路径为唯一键，合同新增或修改后重新核对调用点与状态。

## 小程序能力与接口缺口

| 现有能力 | 当前处理 | 后续需要 |
| --- | --- | --- |
| 头像 | 当前账号本地显示；`ProfileInput` 未提供头像字段 | 确认头像文件所有权及资料字段后实现上传与跨端展示 |
| 邮箱提醒 | 设置为本地偏好；服务端未提供订阅及发送计划接口 | 明确订阅、时区、取消及投递规则后接入 |
| 自定义考试倒计时、字号及布局 | 本地偏好；答题生效配置随练习快照管理 | 如需多端同步，增加用户偏好合同 |
| 全科练习 | 多题库时先选择题库，再进入共同配置流程 | 扩展跨题库选题需独立合同和题目归属校验 |
| 错题手动移除 | 云端错题按后端学习结果更新，页面提示复习掌握 | 如需人工归档，增加保留学习历史的状态接口 |
| 用户上传题库 | 题库页入口关闭，直接导入路由由正式应用阻止 | 独立产品阶段确定所有权与管理流程 |
| 历史记录 | 现有最近练习入口可继续未完成练习或查看最近已完成结果 | 后台等待练习可从最近练习选择；独立历史列表和筛选入口待补 |

## 验证记录

- `tests/remote-data.check.js`：目录/学习/逐题进度 DTO 映射、分页搜索、账号隔离及迟到响应、并发刷新合并、完整资料更新、答案展示时机通过。
- `tests/bank-detail-entry.check.js`：75 项通过；`tests/result-review.check.js`：38 项通过。
- `tests/compile.check.js`：23 个 WXSS、20 个 WXML 编译通过，通配符与闭合标签检查通过。
- 上述证据来自本地自动检查；真实接口闭环与请求开销观察见[验收记录](miniapp-integration-verification.md)，微信真机及外部服务验收继续按该记录执行。
