# 小程序接口接入台账

核对日期：2026-10-31。接口集合取自 `apps/api/contracts/openapi.yaml`；逐项以当前 Controller 和小程序页面调用链核对。表中“已接入待验收”表示代码已有真实页面或生命周期调用，真机验收须结合运行记录确认。仅存在导出函数的能力不计为接入。页面请求预算与缓存规则见[页面加载说明](miniapp-page-loading.md)。

## 调用与数据约定

- 正式运行由 App 启用在线仓储，公共请求统一经 `repositories/api-transport.js` 使用 `/api/v1`、学生 Bearer token、请求追踪及写入幂等键；管理员接口使用独立管理员身份。
- 页面通过 ViewModel 投影展示字段，Repository 使用 MobX 管理独立资源。目录每页 20 条、错题和收藏每页 5 条，按操作加载；题目正文用于详情和练习。目录及资料缓存 5 分钟、学习摘要和集合列表 30 秒，同账号同查询请求合并。
- `remote-data-repository.js` 的题目展示映射不等于练习快照；答题使用 `online-practice.js` 的修订快照。答案展示遵守确认状态、反馈模式及交卷状态；题目详情在无对应练习上下文时展示题干和选项。
- 最近练习首批读取 20 条；后台等待记录独立保留并提供返回入口。
- 首页只读取学习概览和 1 条公告，公告总数决定动画状态；打开弹窗读取 20 条并支持加载更多，缓存 60 秒。切换账号清理展示缓存并拒收旧账号响应。弹窗通过 root-portal 覆盖底栏，底栏保留并随背景变暗。
- 同一练习的草稿、在途命令和业务版本分别保存；同步确认前保留本地答案。队列限频与跨端接管规则见本轮实现及测试，接口按当前 v1.0 合同统一调用。
- 游客通过公开目录浏览已发布、启用的内容，目录省略个人进度。试答使用独立快照接口，本机累计两次，完整快照成功保存后扣次；草稿、结果和额度保存在 `qandaTrialPractice`，账号切换时保留。正式同步仍只处理账号练习。

## 版本与扩展约束

- 当前基线为 v1.0，合同版本 `1.0.0`。创建练习要求设备标识，进行中的写请求要求有效凭证；进度统一使用精简确认接口，账号资料统一通过 `GET /me` 读取。
- 练习配置、题目修订与题序在创建时固定。业务版本用于并发校验，本机序号用于确认同步，两者分别递增；接管后服务端为新写入方从零确认序号。
- 后续增加字段优先保持可选；改变题型含义、计分、字段类型或必填条件时使用新接口或新版本。客户端草稿格式独立版本化，未知格式保留数据并提示更新。
- 管理端使用独立认证；用户 Web 复用学生接口、业务版本、幂等及交接协议。统计使用服务端统一口径，答案展示由题型、确认状态和反馈模式共同决定。

## 逐接口记录

权限列“学生”表示登录学生且受资源所有权/可见性校验；“管理员”表示独立后台权限，具体写权限由各 Controller/Service 校验。证据列指静态调用链及自动检查，正式运行验收另行追加。
“游客”仅表示公开发布内容的读取权限；私人资料和学习记录要求登录。公开图片校验其当前所属内容；已发放的正式练习快照图片继续按账号所有权读取。

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
| `GET /api/v1/announcements` | `Operations_announcements_GET` | 公告摘要与分页正文 | 小程序、用户 Web / 学生 | 首页提示；打开弹窗及加载更多 | subject-list → SubjectListViewModel → practice-repository → remote-data-repository.refreshAnnouncements → api-transport | 已接入待验收 | 首页 1 条，弹窗每页 20；60 秒缓存；remote-data 自检及开发者工具遮罩验收 |
| `POST /api/v1/auth/email-challenges` | `Identity_requestPublicEmailChallenge_POST` | 验证码挑战 | 小程序、用户 Web / 公开挑战/注册或登录 | 注册/找回密码发送验证码 | register/forgot-password → AuthFormViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/email-registrations` | `Identity_registerEmail_POST` | 邮箱注册 | 小程序、用户 Web / 公开挑战/注册或登录 | 注册页提交 | register → RegisterViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/password-resets` | `Identity_resetPassword_POST` | 重置密码 | 小程序、用户 Web / 公开挑战/注册或登录 | 找回密码页提交 | forgot-password → ForgotPasswordViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/sessions` | `Identity_login_POST` | 创建学生会话 | 小程序、用户 Web / 公开挑战/注册或登录 | 登录页输入邮箱密码 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `DELETE /api/v1/auth/sessions/current` | `Identity_logout_DELETE` | 撤销当前会话 | 小程序、用户 Web / 学生 | 我的退出登录 | my → MyViewModel → auth-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/wechat-registrations` | `Identity_registerWechat_POST` | 注册微信用户 | 小程序、用户 Web / 公开挑战/注册或登录 | 首次微信登录 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/auth/wechat-sessions` | `Identity_wechatLogin_POST` | 微信身份交换 | 小程序、用户 Web / 公开挑战/注册或登录 | 登录页微信登录 | login → LoginViewModel → auth-repository → auth-gateway → http-gateway → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/colleges` | `Catalog_colleges_GET` | 学院目录 | 小程序、用户 Web / 公开目录 | 账号页打开院校选择器及加载更多 | account → AccountViewModel → remote-data-repository → api-transport | 已接入待验收 | 每页 100；24 小时缓存；账号页进入不预取；remote-data 自检 |
| `GET /api/v1/colleges/{id}/majors` | `Catalog_majors_GET` | 读取专业 | 小程序、用户 Web / 公开目录 | — | — | 无入口；已预留目录读取方法，专业选择控件待补 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/files/{id}` | `File_read_GET` | 读取题目图片 | 各端 / 按文件可见性 | — | — | 基础设施接口；文件 UI 接入状态需逐题核验 | 文件授权与缓存规则；Controller + OpenAPI |
| `GET /api/v1/health` | `Health_health_GET` | 健康检查 | 各端 / 公开 | — | — | 基础设施接口；由服务健康检查调用 | 保持状态及版本字段兼容；Controller + OpenAPI |
| `GET /api/v1/me` | `Identity_me_GET` | 读取账号资料 | 小程序、用户 Web / 学生 | 我的/账号页缓存过期更新；登录后读取 | my/account → MyViewModel/AccountViewModel → remote-data-repository → api-transport；登录 → auth-gateway | 已接入待验收 | 5 分钟缓存；可选院校/专业名称；资料编辑与账号隔离自检 |
| `GET /api/v1/me/course-requests` | `Operations_requests_GET` | 读取缺课需求 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/course-requests` | `Operations_requestCourse_POST` | 创建缺课需求 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/email-binding` | `Identity_changeEmail_PUT` | 更新邮箱绑定 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/email-challenges` | `Identity_requestOwnEmailChallenge_POST` | 创建邮箱验证码挑战 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/favorites` | `Discovery_favorites_GET` | 分页收藏列表、全量集合管理 | 小程序、用户 Web / 学生 | 收藏本筛选/排序/翻页；清空操作逐页读取 | wrong-book → WrongBookViewModel → practice-repository → remote-data-repository.refreshCollection/clearFavorites → api-transport | 已接入待验收 | 每页 5；来源名称、practiced 可选；30 秒缓存；分页统计 PostgreSQL 验收 |
| `DELETE /api/v1/me/favorites/{id}` | `Discovery_unfavorite_DELETE` | 取消收藏 | 小程序、用户 Web / 学生 | 答题/详情取消收藏及收藏本管理 | practice/question-detail/wrong-book → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/me/favorites/{id}` | `Discovery_favorite_PUT` | 收藏题目 | 小程序、用户 Web / 学生 | 答题或题目详情收藏 | practice/question-detail → 对应 ViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/me/password` | `Identity_changePassword_PUT` | 更新密码 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/practice-history` | `Learning_history_GET` | 读取练习历史 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/practice-history/{id}` | `Learning_record_GET` | 读取练习历史 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/profile` | `Identity_updateProfile_PUT` | 更新昵称与院系资料 | 小程序、用户 Web / 学生 | 账号页保存资料 | account → AccountViewModel → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/me/question-feedback` | `Operations_feedback_GET` | 读取题目反馈 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/me/question-feedback` | `Operations_submitFeedback_POST` | 创建题目反馈 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/question-progress` | `Learning_questionProgress_GET` | 逐题最近已判定结果与题库进度 | 小程序、用户 Web / 学生 | — | — | 无入口；页面使用概览、目录进度和集合摘要；后续逐题进度页可接入 | 保留现有合同；静态调用检索及首页请求计数 |
| `GET /api/v1/me/recent-learning` | `Learning_recent_GET` | 最近练习 | 小程序、用户 Web / 学生 | 点击最近练习；题库最近在刷 | subject-list/bank-detail → 对应 ViewModel → practice-repository → remote-data-repository.refreshRecent → api-transport | 已接入待验收 | 每页 20；30 秒缓存；首页继续答题使用 learning-overview；草稿和等待入口自检 |
| `GET /api/v1/me/recommendations` | `Discovery_recommendations_GET` | 读取课程推荐 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/sessions` | `Identity_listSessions_GET` | 读取登录会话 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `DELETE /api/v1/me/sessions/{id}` | `Identity_revokeSession_DELETE` | 删除或撤销登录会话 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/statistics` | `Learning_summary_GET` | 个人统计；WEEK/MONTH/ALL | 小程序、用户 Web / 学生 | 复盘进入及切换 WEEK/MONTH/ALL | stats → StatsViewModel → practice-repository → remote-data-repository.refreshStatistics → api-transport | 已接入待验收 | 只取当前范围，按 period 缓存 30 秒；remote-data 自检 |
| `GET /api/v1/me/statistics/days` | `Learning_days_GET` | 每日学习量 | 小程序、用户 Web / 学生 | 复盘趋势和热力图 | stats → StatsViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 复盘读取热力图日期范围；30 秒缓存；日期边界 PostgreSQL 验收 |
| `GET /api/v1/me/subjects` | `Discovery_courses_GET` | 读取课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `DELETE /api/v1/me/subjects/{id}` | `Discovery_removeCourse_DELETE` | 删除或撤销课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/subjects/{id}` | `Discovery_saveCourse_PUT` | 更新课程 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `PUT /api/v1/me/wechat-binding` | `Identity_bindWechat_PUT` | 更新微信绑定 | 小程序、用户 Web / 学生 | — | — | 无完整操作入口；账号页提示/找回密码不等于绑定或改密流程，后续补验证码及确认表单 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/wrong-questions` | `Learning_wrong_GET` | 分页错题列表 | 小程序、用户 Web / 学生 | 错题本筛选/排序/翻页 | wrong-book → WrongBookViewModel → practice-repository → remote-data-repository.refreshCollection → api-transport | 已接入待验收 | 每页 5；chip/sort 可选；30 秒缓存；分页统计 PostgreSQL 验收 |
| `GET /api/v1/me/wrong-questions/{id}/history` | `Learning_wrongHistory_GET` | 读取历次答题记录 | 小程序、用户 Web / 学生 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/me/learning-overview` | `Learning_overview_GET` | 学习、目录计数和可续答摘要 | 小程序、用户 Web / 学生 | 首页/复盘刷新；设置复用已有摘要 | subject-list/stats → 对应 ViewModel → practice-repository → remote-data-repository.refreshOverview → api-transport | 已接入待验收 | v1.0 新增能力；30 秒缓存；首页 2 请求自检、PostgreSQL 聚合验收 |
| `GET /api/v1/me/question-collections/summary` | `Learning_collectionSummary_GET` | 集合计数、筛选计数与科目/题库分布 | 小程序、用户 Web / 学生 | 错题本/收藏本统计卡及筛选项 | wrong-book → WrongBookViewModel → practice-repository → remote-data-repository.refreshCollection → api-transport | 已接入待验收 | kind=WRONG 或 FAVORITE；全集合统计，30 秒缓存；7 条集合分页 5+2 的 PostgreSQL 验收 |
| `POST /api/v1/practice/scope-preview` | `Practice_preview_POST` | 创建练习范围预览 | 小程序、用户 Web / 学生、游客 | — | — | 无入口；创建时服务端校验范围，后续需要题量预览时接入 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/practice/trial-snapshots` | `Practice_trialSnapshot_POST` | 下载公开题库试答快照 | 小程序、用户 Web / 游客 | 题库配置或模拟考试开始试答 | practice → PracticeViewModel.loadTrial → trial-practice.prepare → http-gateway/api-transport | 已接入待验收 | v1.0 新增只读能力；配置、修订、题序与独立判题数据；四题型、存储失败及 PostgreSQL 游客验收 |
| `POST /api/v1/practice/sessions` | `Practice_create_POST` | 创建配置及题目快照 | 小程序、用户 Web / 学生 | 题库配置确认/首页模拟练习/错题收藏练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | selectionKind/collectionChip 由后端确定完整范围；快照附带收藏 ID；列表 5 条可创建 7 题，PostgreSQL 验收 |
| `GET /api/v1/practice/sessions/{id}` | `Practice_read_GET` | 读取会话 | 小程序、用户 Web / 学生 | 恢复云端练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/cancel` | `Practice_cancel_POST` | 创建取消练习 | 小程序、用户 Web / 学生 | — | — | 无入口；离开页面保留草稿，显式取消练习入口待补 | 保持当前合同；Controller + OpenAPI |
| `POST /api/v1/practice/sessions/{id}/finish` | `Practice_finish_POST` | 后端判题与正式结果 | 小程序、用户 Web / 学生 | 交卷及联网后补交 | practice → PracticeViewModel → online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/practice/sessions/{id}/items/{itemId}/self-assessment` | `Practice_assess_PUT` | 保存自评结果 | 小程序、用户 Web / 学生 | 简答题自评同步 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `PUT /api/v1/practice/sessions/{id}/progress-ack` | `Practice_progressAck_PUT` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/result` | `Practice_result_GET` | 读取正式结果 | 小程序、用户 Web / 学生 | 交卷/恢复已完成练习 | practice → PracticeViewModel → online-practice → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/snapshot` | `Practice_snapshot_GET` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/writer-acquire` | `Practice_acquireWriter_POST` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `POST /api/v1/practice/sessions/{id}/writer-release` | `Practice_releaseWriter_POST` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/practice/sessions/{id}/writer-state` | `Practice_writerState_GET` | 练习快照与写入所有权 | 小程序、用户 Web / 学生 | 创建/恢复/同步与跨端接管 | practice/App → PracticeViewModel/online-practice → practice-sync-queue/api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/question-banks` | `Content_banks_GET` | 已发布题库目录 | 小程序、用户 Web / 学生、游客 | 题库页当前科目/搜索/翻页；模拟练习选择题库 | bank-detail/subject-list → 对应 ViewModel → practice-repository → remote-data-repository.refreshBanks → api-transport | 已接入待验收 | 每页 20；includeProgress 可选，批量计数；5 分钟缓存；SQL 与分页验收 |
| `GET /api/v1/question-banks/{id}` | `Content_bank_GET` | 获取内容版本和题量 | 小程序、用户 Web / 学生、游客 | 目标题库配置、直达练习及最近练习元数据缺失时 | bank-detail/subject-list/practice → 对应 ViewModel → practice-repository/online-practice → remote-data-repository.loadBank/api-transport | 已接入待验收 | 按 ID 读取元数据；内容版本用于创建校验；保持默认字段行为 |
| `GET /api/v1/question-banks/{id}/chapters` | `Content_chapters_GET` | 读取章节 | 小程序、用户 Web / 学生、游客 | — | — | 无入口；按业务补充入口后接入 | 保持当前合同；Controller + OpenAPI |
| `GET /api/v1/question-banks/{id}/questions` | `Content_questions_GET` | 读取题目 | 小程序、用户 Web / 学生、游客 | — | — | 无入口；按业务补充入口后接入 | 默认完整响应；可选 view=summary；摘要不取答案/解析/选项，PostgreSQL 验收 |
| `GET /api/v1/questions` | `Content_search_GET` | 分页搜索题目摘要 | 小程序、用户 Web / 学生、游客 | 首页搜索关键词和加载更多 | subject-list → SubjectListViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 每页 20；view=summary；300 ms 输入合并；迟到结果忽略；remote-data 自检 |
| `GET /api/v1/questions/{id}` | `Content_question_GET` | 读取题目正文 | 小程序、用户 Web / 学生、游客 | 错题/收藏进入题目详情 | question-detail → QuestionDetailViewModel → practice-repository → remote-data-repository → api-transport | 已接入待验收 | 版本及幂等规则；页面调用链，定向 Node 自检，待客户端真实业务验收 |
| `GET /api/v1/subjects` | `Catalog_subjects_GET` | 课程目录 | 小程序、用户 Web / 学生、游客 | 题库页进入及科目分页 | bank-detail → BankDetailViewModel → practice-repository → remote-data-repository.refreshSubjects → api-transport | 已接入待验收 | 每页 20；includeProgress 可选，批量计数；5 分钟缓存；PostgreSQL 验收 |
| `GET /api/v1/subjects/{id}` | `Catalog_subject_GET` | 读取课程 | 小程序、用户 Web / 学生、游客 | 直接进入未加载的目标科目 | bank-detail → BankDetailViewModel → practice-repository → remote-data-repository.loadSubject → api-transport | 已接入待验收 | 按 ID 读取；includeProgress 可选；5 分钟缓存；目录第一页外直达自检及 PostgreSQL 验收 |

当前合同合计 **118** 项操作。本表以方法和路径为唯一键，合同新增或修改后重新核对调用点与状态。后端 HTTP 覆盖与小程序入口覆盖分别统计。

当前小程序有调用入口 **37** 项，状态为“已接入待验收”；其他端专用 **56** 项、无完整入口 **23** 项、基础设施接口 **2** 项。方法、路径与 operationId 的集合核对无缺项、无多项。

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

- 游客读取已发布目录、分页搜索、详情、缓存隔离与不请求个人统计通过；后端公开试答验证包含未发布内容拒绝、修订检查、答案分层和正式记录数量不变。
- `tests/trial-layout.check.js`：两次共享额度、重复创建合并、超时与存储失败、四类题型、离线恢复、登录后回看、账号切换保留额度、布局保存回滚、取消手势和跨屏滚动位置计算通过。
- 后端 9 项单元、28 项 PostgreSQL 集成测试通过；覆盖游客公开图片可读、停用题目或取消发布后不可读及正式练习已有快照图片的所有权规则。118 项操作的合同与 Postman 同步，617 次 HTTP 交换 Schema 校验及 236 段集合脚本语法通过。运行报告位于忽略目录 `apps/api/.backend-runtime/verification/`。
- `tests/remote-data.check.js`：首页 2 个轻量请求、缓存复用、目标科目直达、服务端摘要映射、分页搜索、账号隔离及迟到响应、完整资料更新、答案展示时机通过。
- 首页公告：有/无公告、公告撤下、关闭后持续提示、60 秒缓存复用及账号切换迟到响应检查通过；此前真实后端临时发布 → 首页 ViewModel 可见 → 撤下恢复空态通过（29 次 HTTP 请求，临时公告已清理）。本轮开发者工具核对弹窗遮罩覆盖底栏且保持底栏可见，真机显示待验收。
- `tests/page-loading.check.js`：请求合并、缓存失效与迟到响应、全局并发 4／后台同步 1、官方绑定合并更新与隐藏时释放、立即调用原生路由、设置页零请求及分页失败重试通过。
- `tests/bank-detail-entry.check.js`：75 项通过；`tests/result-review.check.js`：38 项通过。
- `tests/compile.check.js`：26 个 WXSS、25 个 WXML 及 WXS 编译通过，通配符与闭合标签检查通过。
- 上述证据来自本地自动检查；真实接口闭环与请求开销观察见[验收记录](miniapp-integration-verification.md)，微信真机及外部服务验收继续按该记录执行。
