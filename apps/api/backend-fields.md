# 旧版 QandA 练习同步数据字典

本文配套[旧版后端设计方案](backend-design.md)和[本地优先同步协议](local-first-sync-design.md)，记录练习同步原型的数据模型。当前 Kotlin API 的数据库结构以 `src/main/resources/db/migration/` 下的迁移为准。

首版同步迁移未包含在当前 API 源码中。下文其他实体为整体设计记录；成绩统一为 CLIENT_REPORTED，云端不核对标准答案。

## 1. 公共约定

- `ID`：UUID，API 字符串；`time`：带时区时间戳，存 UTC；`date`：日历日期；`enum`：受约束字符串；`decimal`：`numeric(8,2)`；正文 `text`；结构化字段 `jsonb`。
- 除显式复合主键／单例表外，每表 `id: ID`。可编辑实体默认有 `createdAt: time`、`updatedAt: time`、`version: bigint`；不可变事实只有 `createdAt`。下表不重复写这些公共字段。
- `?` 表示允许为空；未标 `?` 必填。默认值明确写出；没有默认值的字段由业务流程提供。所有字符串均应配置长度上限，建议名称 100、标题 200、邮箱 254、题干／解析 50,000 字符，并根据真实导入样本调整。
- 关联字段除特别说明均为外键；外部身份、用户编号、邮箱等由唯一约束保证。关系删除默认 RESTRICT，业务显式处理，避免级联删除历史。
- 配置 JSON 使用固定 schema 和版本，禁止接收任意可执行内容。题目内容 JSON 便于存不同题型，权限关系和答案事实保持结构化可查询。
- 后台名称与数据库列可分别采用 camelCase、snake_case；本文统一以 API 命名表达。逻辑实体可以映射表或受控 JSON，不为每个开关单独建表。

## 2. 身份、验证、组织

### 2.1 `user` 用户

| 字段 | 类型／默认 | 含义与约束 |
|---|---|---|
| userCode | string，唯一，服务端生成 | 展示编号，如 A103；不因改邮箱变化 |
| email | string? | 已验证联系邮箱；微信待绑定流程可能为空 |
| normalizedEmail | string?，唯一 | 邮箱登录匹配值；统一规范化策略 |
| emailVerifiedAt | time? | 与当前邮箱绑定，换邮箱重新写入 |
| passwordHash | string? | 微信用户可能尚未设置密码；不返回客户端 |
| passwordChangedAt | time? | 会话撤销与安全审计依据 |
| displayName | string? | 管理端人员姓名；与昵称分开 |
| nickname | string，自动生成初始值 | 用户展示称呼 |
| avatarFileId | ID? → file_asset | 只能引用该用户可用的头像资源 |
| majorId | ID? → major | 学院从 major 推导；未分配时无继承权限 |
| status | ACTIVE / DISABLED；待验证是否建用户待定 | 业务禁用与临时登录锁定不同 |
| registeredVia | EMAIL / WECHAT | 首次注册渠道，不当作当前登录方式 |
| timezone | string，Asia/Shanghai | 个人统计和提醒时区，校验合法 IANA 值 |
| termsVersion / privacyVersion | string | 注册时同意的条款版本 |
| consentedAt | time | 同意时间；条款内容在发布配置管理 |
| lastLoginAt / lastActiveAt | time? | 可重建摘要，分别表示登录与业务活跃 |

UI 的 `wechatBound`、`passwordSet`、`emailVerified`、`collegeName`、作答数、可见科目数、常用端均由关系／统计推导。管理员不应直接填写这些摘要字段。

### 2.2 `wechat_identity` 微信身份

`userId: ID → user`、`appId: string`、`openId: string`、`unionId: string?`、`boundAt: time`。唯一 `(appId, openId)`；建议每用户每 AppID 仅绑定一个身份。unionId 有值才用于受验证的账号关联，不能假定存在。服务端兑换所需秘密放密钥配置；临时敏感材料只保留必要生命周期。

### 2.3 `auth_challenge` 身份验证挑战

| 字段 | 类型 | 规则 |
|---|---|---|
| realm | USER / ADMIN | 两个认证域隔离 |
| purpose | REGISTER / RESET_PASSWORD / CHANGE_PASSWORD / BIND_EMAIL / VERIFY_OLD_EMAIL / VERIFY_NEW_EMAIL / LINK_WECHAT / ADMIN_DEVICE | 验证码不能跨用途使用 |
| principalId | ID? | 可选主体；按 realm 校验关联 |
| recipient | string | 规范化邮箱，响应脱敏 |
| secretDigest | string | 验证码用服务端密钥保护的摘要，防低熵离线枚举 |
| context | jsonb | 绑定事务标识、旧／新邮箱关联、微信临时身份等受控数据；不含明文密码 |
| expiresAt / consumedAt | time / time? | 一次性消费，过期禁止 |
| failedAttempts / maxAttempts | int / int | 校验原子递增，到阈值失效 |
| nextSendAt | time | 发送冷却；另按邮箱/IP/设备做频控 |
| deliveryStatus | QUEUED / SENT / FAILED | 与实际发送结果区分 |

更换邮箱的两份验证证明绑定同一变更事务和 userId，不能拼接别人的成功凭据。注册密码在最终确认时提交，不写进邮件任务。

### 2.4 `auth_session` 登录会话

`realm: USER/ADMIN`、`userId: ID?`、`adminId: ID?`（恰好一项，分别为外键）、`tokenDigest: string unique`、`client: WEB/MINI/ADMIN_WEB`、`deviceId: string`、`deviceLabel: string?`、`issuedAt: time`、`expiresAt: time`、`lastSeenAt: time`、`revokedAt: time?`、`revokeReason: string?`、`ip: inet?`、`userAgent: string?`、`persistent: bool=false`。管理员会话执行空闲超时；设备 ID 不作为身份证明。

登录失败计数放独立可过期记录 `login_guard`：复合键 `(realm, identifierDigest, bucket)`，`failedCount:int`、`windowStartedAt:time`、`lockedUntil:time?`、`expiresAt:time`；账户与 IP 两类限流分别计算，避免单一共享 IP 锁死所有用户。

### 2.5 `college`、`major` 组织

| 实体 | 字段 | 约束 |
|---|---|---|
| college | name:string、code:string?、sortOrder:int=0、status:ACTIVE/DISABLED | 名称／编码唯一策略由学校数据确认 |
| major | collegeId:ID、name:string、code:string?、sortOrder:int=0、status:ACTIVE/DISABLED | 同学院名称唯一；用户指向专业 |

已有专业或人员时禁止直接删除学院；已有人员时禁止直接删除专业，先迁移归属或停用。组织停用建议停止继承授权；组织 CRUD 页面缺失，操作交互需补齐。

## 3. 内容与文件

### 3.1 `subject` 科目

`name:string`、`description:text?`、`category:string?`、`coverFileId:ID?`、`sortOrder:int=0`、`status:DRAFT/ACTIVE/ARCHIVED`、`isPublic:bool=false`、`createdBy:ID → admin_account`、`updatedBy:ID → admin_account`。

分类对应公共课选择弹窗标签页；先用受控字符串集合，确有独立分类管理再建实体。单元数、题数、用户已做数与正确率为聚合，不由管理员填写。

### 3.2 `unit` 单元

`subjectId:ID`、`name:string`、`description:text?`、`sortOrder:int=0`、`status:DRAFT/ACTIVE/ARCHIVED`、`createdBy:ID`、`updatedBy:ID`。索引 `(subjectId,status,sortOrder,id)`。建议同科目单元名称唯一或显式提示重名。

### 3.3 `question` 题目身份

`unitId:ID`、`sourceKey:string?`、`currentRevisionId:ID`、`sortOrder:int=0`、`status:DRAFT/ACTIVE/ARCHIVED`、`createdBy:ID`、`updatedBy:ID`、`archivedAt:time?`。非空 sourceKey 在单元内唯一；currentRevision 必须属于自己，在同一事务创建题目与首版。题目跨单元移动会影响权限和进度，首版建议通过显式移动操作预览影响，不提供随意改外键的通用 PATCH。

### 3.4 `question_revision` 不可变题目版本

| 字段 | 类型 | 规则 |
|---|---|---|
| questionId / revisionNo | ID / int | 联合唯一，版本只增 |
| type | SINGLE_CHOICE / MULTIPLE_CHOICE / TRUE_FALSE / SHORT_ANSWER | 简答评分另定 |
| stem | text | 清洗后的富文本 |
| options | jsonb array，默认 [] | `{key:string, content:string, order:int}`；选择题必填；键唯一 |
| answer | jsonb | 选择题 `{optionKeys:string[]}`；判断 `{value:bool}`；简答 `{referenceText:string}` |
| explanation | text? | 清洗后的解析；建议正式题目有解析，导入可给缺失警告 |
| score | decimal，建议 1.00 | >=0；自测总分从题目快照累加 |
| tags | string[]，默认 [] | 简单知识点标签，去重 |
| searchText | text | 从正文、选项、答案、解析提取的可检索纯文本，不含标记代码 |
| contentHash | string | 内容指纹，用于重复导入警告；不直接当唯一身份 |
| createdBy | ID → admin_account | 编辑者 |

文件引用嵌入受控文档结构中的 fileId。正文渲染链接经权限验证或使用有期限签名 URL，避免猜测私有资源地址。

### 3.5 `file_asset` 文件元数据

`ownerUserId:ID?`、`ownerAdminId:ID?`（上传主体恰好一个）、`purpose:AVATAR/SUBJECT_COVER/QUESTION_IMAGE/ANNOUNCEMENT_IMAGE/IMPORT_SOURCE`、`storageKey:string unique`、`originalName:string`、`mimeType:string`、`byteSize:bigint`、`sha256:string`、`width:int?`、`height:int?`、`status:TEMP/READY/REJECTED`、`expiresAt:time?`。

按真实内容校验类型和尺寸，限制图片像素与文件体积；删除只清理无引用文件。导入源为临时文件，确认后的必要审计仅留哈希与结果，不无限保留上传副本。

## 4. 权限关系

| 实体 | 字段／主键 | 规则 |
|---|---|---|
| college_subject | `(collegeId,subjectId)` 复合主键；createdAt、createdBy | 学院可供专业选择的上限 |
| major_subject | `(majorId,subjectId)` 复合主键；createdAt、createdBy | 必须包含于该专业所属学院的授权集合 |
| user_subject_override | `(userId,subjectId)` 复合主键；effect:GRANT/BLOCK_INHERITED、createdAt、updatedAt、updatedBy | 一对关系只有一个效果；公共科目不接受屏蔽操作 |
| access_revision | scopeType:PUBLIC/COLLEGE/MAJOR/USER、scopeId:ID?、version:bigint | 每个授权范围一个版本；公共范围为单例；用于弹窗整集合并发控制 |

公共授权存 `subject.isPublic`，不重复再建一套公共课关系。`major_subject` 的跨表子集校验通过事务及锁定授权版本实现；普通行 CHECK 不能独立保障跨表规则。

## 5. 练习、答案与有效作答

### 5.1 `practice_session` 场次

| 字段 | 类型／默认 | 含义 |
|---|---|---|
| userId | ID | 所有人 |
| sourceType | SUBJECT / UNIT / WRONG_BOOK / FAVORITES / RESULT_WRONG | 来源 |
| subjectId / unitId | ID? / ID? | 按来源校验；跨科目集合可为空 |
| sourceSessionId | ID? → practice_session | 从结果错题重练时的原场次 |
| scopeSnapshot | jsonb | 入场范围名称、筛选条件；快照便于历史展示 |
| mode | PRACTICE / TEST / MEMORIZE | 模式 |
| questionOrder | SEQUENTIAL / RANDOM | 题序类型，实际题序看 items.ordinal |
| feedbackMode | IMMEDIATE / ON_SUBMIT / ALWAYS_VISIBLE | 服务端根据 mode 限制合法组合 |
| autoNext | OFF / WHEN_CORRECT | 本场快照；测试强制 OFF |
| autoCollectWrong | bool | 入场时的用户设置 |
| timeLimitSeconds | int? | >0；null 为不限时；TEST 要求本地限时；云端允许完成后补传 |
| status | IN_PROGRESS / PAUSED / SUBMITTING / SUBMITTED / ABANDONED | 生命周期；接收控制与应用水位见同步协议 |
| startedAt | time | 开始时间 |
| deadlineAt | time? | 客户端使用的计时依据；云端不以它拒绝补传 |
| pausedAt / submittedAt / abandonedAt | time? | 与状态一致 |
| finishReason | USER_SUBMIT / TIMEOUT / REPLACED / USER_ABANDON ? | 非终态为空 |
| currentOrdinal | int，默认 1 | 用户当前定位，范围 1..题数 |
| activeClient / activeDeviceId | enum? / string? | 最近获服务端接受的活动端 |
| lastActivityAt / lastSavedAt | time | 恢复排序、保存反馈 |
| activeDurationSeconds | int=0 | 服务端受限累计，与墙钟时间分别存 |
| resultSummary | jsonb? | 终态计算：total/answered/correct/wrong/unanswered/ungraded/score/maxScore；可由条目重建 |

原型配置中的“只做错题”转换为范围过滤条件，而不是另一个模式。总题数从创建时固定的 items 得出。场次创建失败不能留下空场次。

### 5.2 `practice_item` 场次题目

| 字段 | 类型 | 规则 |
|---|---|---|
| sessionId | ID | 场次外键 |
| questionId / revisionId | ID / ID | 固定题目版本，版本不可改 |
| ordinal | int | 场内唯一，建议同场 questionId 也唯一 |
| sourceLabelSnapshot | jsonb | 科目／单元名称快照，历史改名不影响展示 |
| maxScore | decimal | 入场分值快照 |
| answer | jsonb? | 用户选项键集合、判断值或文本；未答为空 |
| answerState | UNANSWERED / DRAFT / CONFIRMED | 区分保存草稿与有效提交 |
| evaluation | UNGRADED / CORRECT / WRONG / UNANSWERED | 未揭示的测试答案也不向客户端输出内部判定 |
| awardedScore | decimal? | 结算后填写，未答 0 |
| flagged | bool=false | 当前场次标记 |
| firstAnsweredAt / lastAnsweredAt | time? | 草稿编辑时间 |
| confirmedAt / gradedAt | time? | 有效确认／判分时间 |

答案通过批次接收，校验 writerEpoch、连续序号和接收状态；Worker 按应用水位事务更新条目，封闭接收后处理到屏障再结算。服务端不信任客户端传入的 evaluation、分值、题干和答案快照。

### 5.3 `answer_fact` 有效作答事实

不可变：`practiceItemId:ID unique`、`userId:ID`、`questionId:ID`、`revisionId:ID`、`subjectId:ID`、`unitId:ID`、`result:CORRECT/WRONG`、`awardedScore:decimal`、`maxScore:decimal`、`occurredAt:time`、`client:WEB/MINI`。字段是结算当时快照；后续只将客户端上报有效已答客观题记入此表，注明 CLIENT_REPORTED 来源，未答、背题浏览不写。Worker 应用批次时以事务批量写答案、事实和错题变更；交卷只补写未结算的有效答案事实。补充 sourceBatchId、clientOccurredAt?、acceptedAt、processedAt；occurredAt 表示经校验并注明来源的学习时间，不直接取消费时间。

如以后支持人工评分，再扩展评分状态、评分者、评分修订事实；不要先把待评分算作错题。

### 5.4 `idempotency_record` 幂等写请求

`principalRealm`、`principalId`、`operation:string`、`requestId:string`、`payloadHash:string`、`resourceId:ID?`、`resultCode:string?`、`expiresAt:time`，唯一 `(principalRealm,principalId,operation,requestId)`。与业务结果同事务保存；大响应通过 resourceId 重读。成功交卷状态本身也必须幂等，不能只依赖短期记录。

### 5.5 `practice_activity` 前台活动片段

`sessionId:ID`、`deviceId:string`、`client:WEB/MINI`、`sequence:bigint`、`startedAt:time`、`endedAt:time`、`creditedSeconds:int`；唯一 `(sessionId,deviceId,sequence)`。活动区间与答案合批；离线时长为受限估算，服务端限制单次可计时区间，同场两端重叠只计一次；同一用户多场重叠在用户总时长中再去重。保留策略与聚合重建窗口在上线前设定。

## 6. 错题、收藏、偏好

| 实体 | 字段 | 说明 |
|---|---|---|
| wrong_question | `(userId,questionId)` 主键；firstWrongAt、lastWrongAt、wrongCount:int、lastReviewedAt:time?、reviewStatus:NEEDS_REVIEW/REVIEWED、lastFactId:ID | 仅首次有效判定更新，重复保存不增加次数 |
| favorite_question | `(userId,questionId)` 主键；createdAt | 收藏与场次标记分开 |
| user_preferences | userId 唯一；defaultMode、defaultOrder、defaultTimeLimitSeconds?、immediateFeedback:bool、autoNext、autoCollectWrong:bool、onlyWrongDefault:bool=false | 业务偏好跨端共享；非法组合由服务端归一化后返回 |
| client_preferences | `(userId,client)` 主键；fontSize:SMALL/STANDARD/LARGE、hapticsEnabled:bool、layoutOrder:string[]、updatedAt、version | 端特有展示；五个区域必须恰好各出现一次 |

布局区域枚举：`QUESTION_INFO, STEM, EXPLANATION, OPTIONS, ACTIONS`。重置接口按指定范围重置业务或展示偏好，不能误清空收藏／历史。默认值由服务端集中返回，不从原型示例中的开关状态硬编码推断。

## 7. 公告、提醒与后台任务

### 7.1 `announcement` 公告

`title:string`、`summary:string`、`body:text`、`authorLabel:string`、`audienceType:ALL/SELECTED_USERS`、`channels:string[]`（WEB/MINI，非空）、`status:DRAFT/SCHEDULED/PUBLISHED/WITHDRAWN`、`scheduledAt:time?`、`publishedAt:time?`、`withdrawnAt:time?`、`targetType:NONE/SUBJECT/UNIT`、`targetId:ID?`、`createdBy:ID`、`updatedBy:ID`。

`announcement_recipient`：`(announcementId,userId)` 主键。指定用户列表保存快照，后续用户改专业不改变名单；若以后按组织动态投放另加明确受众规则。取消定时任务校验公告版本。未画未读标记，首版无需公告阅读跟踪表。

### 7.2 `reminder_settings` 邮件偏好

`userId:ID unique`、`emailEnabled:bool=false`、`reviewEnabled:bool=false`、`reviewWeekdays:int[]`（ISO 1–7，非空且去重）、`sendLocalTime:time-of-day`、`timezone:string`、`examEnabled:bool=false`、`defaultExamOffsets:int[]`（>=0，去重）。

原型只有一个发送时间，建议复习和考试共用；如果分别设置，再拆字段。每日=七个星期值。邮箱从 user 读取，不复制在设置里变成旧地址。

### 7.3 `personal_exam` 个人考试

`userId:ID`、`name:string`、`examDate:date`、`remindDaysBefore:int[]`、`enabled:bool=true`、`deletedAt:time?`。偏移 0 表示当天；建议新建采用 defaultExamOffsets 的快照，之后改默认值不悄悄改变已有考试。

### 7.4 `scheduled_job` 持久任务

| 字段 | 类型 | 含义 |
|---|---|---|
| type | ANNOUNCEMENT_PUBLISH / REVIEW_EMAIL / EXAM_EMAIL / SESSION_TIMEOUT / AUTH_EMAIL | 受控任务类型 |
| dedupKey | string unique | 单次逻辑任务的唯一标识 |
| sourceId / sourceVersion | ID? / bigint? | 业务来源与计划版本 |
| userId | ID? | 收件主体，公告／超时可为空 |
| payload | jsonb | 最小模板参数；敏感验证码发送载荷需短期加密并在发送后清除 |
| scheduledAt / nextAttemptAt | time / time | 计划与重试时间 |
| status | PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED | 状态 |
| attempts / maxAttempts | int / int | 有限重试 |
| lockedBy / leaseUntil | string? / time? | 工作线程租约，故障后可重新领取 |
| deliveryStatus / publishedAt | PENDING / PUBLISHED；time? | RabbitMQ 通知投递状态；失败补偿重投，执行状态单独管理 |
| providerMessageId | string? | 邮件服务返回凭证 |
| lastErrorCode | string? | 脱敏失败原因 |
| sentToMasked | string? | 发送审计摘要，避免存不必要完整邮箱 |
| finishedAt | time? | 完成时间 |

任务创建与业务变更同事务；调度器把到期任务通知投递到 RabbitMQ 对应队列，发布确认后记投递状态，消费者幂等执行；租约、补偿扫描和重复投递处理遵循同步方案。告警对连续失败的任务生效，不把排队成功显示为送达成功。

## 8. 导入记录

| 实体 | 字段 | 规则 |
|---|---|---|
| import_batch | targetUnitId:ID、createdBy:ID、status:UPLOADING/VALIDATING/READY/COMMITTED/FAILED/CANCELLED、totalFiles:int、totalQuestions:int、validCount:int、errorCount:int、warningCount:int、confirmedAt:time?、expiresAt:time | READY 才可确认；确认对 batch 加锁 |
| import_file | batchId:ID、fileId:ID、originalName:string、sha256:string、byteSize:bigint、status:WAITING/PARSING/VALID/INVALID、processedItems:int、totalItems:int?、parsedQuestions:jsonb? | 可存校验后的暂存结构，过期／确认后清理；大文件按容量验证决定是否拆行 |
| import_issue | fileId:ID → import_file、itemIndex:int?、fieldPath:string?、severity:ERROR/WARNING、code:string、message:string | 错误定位到具体文件及题目，不只“导入失败” |

移除文件只允许确认前；删除后重算批次摘要与状态。READY 确认前再次验证外部引用、重复键和目标状态，避免校验期间另一管理员抢先导入。

## 9. 统计与运营

### 9.1 `activity_bucket` 活跃时间桶

复合键 `(userId,client,bucketStartUtc)`，`activeSeconds:int`、`lastSeenAt:time`。时间桶建议分钟粒度，值限制 0–60；可信业务请求或受限前台心跳产生。可回答活动日、常用时间、常用端、留存；不能用页面无限后台轮询刷活跃。

### 9.2 `learning_daily` 可重建日聚合

复合键 `(userId,localDate,timezone)`，`answeredCount:int`、`correctCount:int`、`wrongCount:int`、`activeDurationSeconds:int`、`submittedSessionCount:int`、`updatedAt:time`。事实是源，聚合可重算；切换时区不能直接把旧聚合当新时区数据。小规模可先直接查询事实，不必首天建立异步统计服务。

按科目／单元统计使用事实关联及当期内容范围，若形成新聚合表，必须保留相同指标定义。学习日与一般活跃日分别计算。

### 9.3 主要聚合响应字段

| 页面 | 响应字段 |
|---|---|
| 用户首页 | todayAnswered、todayAccuracy、streakDays、recentSubjects[]、resumeSession?、announcements[]、wrongPendingCount、favoriteCount |
| 科目／单元列表 | availableQuestionCount、answeredDistinctCount、coverageRate、answeredAccuracy、completedSessionCount、resumableSession? |
| 答题卡 | total、answered、unanswered、flagged、currentOrdinal、items[{ordinal,answerState,flagged,result?}] |
| 结果 | total、answered、correct、wrong、unanswered、ungraded、answeredAccuracy、score、maxScore、activeDurationSeconds、items[] |
| 个人统计 | period、timezone、answered、accuracy、durationSeconds、streakDays、previousPeriod、changes、dailySeries[]、heatmap[] |
| 管理仪表盘 | userCount、subjectCount、unitCount、questionCount、answerFactCount、questionTypeDistribution[]、dailyAnswerSeries[] |
| 活跃运营 | dau、wau、mau、day7Retention、comparison、dailyActiveSeries[]、clientDistribution[]、hourDistribution[]、newReturningSeries[] |
| 用户管理 | id、userCode、displayName、nickname、maskedEmail、wechatBound、college、major、answeredCount、commonHours、commonClients、visibleSubjectCount、lastActiveAt、status |
| 活跃排行 | rank、userId、displayName、userCode、activeDays、answeredCount、lastActiveAt |

若最终确认独立题库实体，仪表盘新增 bankCount；在确认前不要拿 unitCount 冒充含义不清的“题库数”。个人统计平均值的分子／分母一并返回，前端不重新猜口径。敏感邮箱完整值仅在授权详情中返回。

## 10. 管理员与审计

### 10.1 `admin_account`

`name:string`、`loginName:string unique`、`passwordHash:string`、`role:SUPER_ADMIN/OPERATOR`、`status:ACTIVE/DISABLED/ARCHIVED`、`email:string?`、`emailVerifiedAt:time?`、`mustChangePassword:bool`、`passwordChangedAt:time`、`lastLoginAt:time?`、`createdBy:ID?`。

首个管理员由受控初始化流程创建，不能公开自助注册管理员。`createdBy` 为空只允许初始化。管理员账号删除保留名称快照与日志关联。

### 10.2 `security_policy` 单例

`realm:ADMIN`、`lockoutEnabled:bool`、`failureThreshold:int`、`lockoutMinutes:int`、`failureWindowMinutes:int`、`idleTimeoutMinutes:int`、`newDeviceVerificationEnabled:bool`、`passwordMinLength:int`、`requireLetters:bool`、`requireDigits:bool`、`requireMixedCase:bool`、`forceFirstLoginPasswordChange:bool`、`updatedBy:ID`，以及公共 version、updatedAt。

原型的示例值可作为评审起点，生产默认值在安全测试时确定。更新策略校验上下限和组合可满足性；启用新设备验证前要求受影响管理员具备可用验证渠道。

### 10.3 `audit_log` 追加式操作记录

`occurredAt:time`、`actorAdminId:ID?`、`actorNameSnapshot:string`、`module:string`、`action:string`、`targetType:string?`、`targetId:string?`、`summary:string`、`result:SUCCESS/FAILURE`、`errorCode:string?`、`beforeRedacted:jsonb?`、`afterRedacted:jsonb?`、`ip:inet?`、`client:string`、`requestId:string`。

索引 `(occurredAt,id)`、`(actorAdminId,occurredAt)`、`(module,result,occurredAt)`。代理后的来源 IP 只信任配置的受信代理头。保留期限、访问权限和清理责任在上线前确定，不提供面向运营人员的任意删日志接口。

## 11. 必须落地的索引与事务

| 类别 | 重点 |
|---|---|
| 唯一约束 | normalizedEmail、userCode、微信 `(appId,openId)`、管理员 loginName、题目 `(unitId,sourceKey)`、版本 `(questionId,revisionNo)`、场次题号／题目、answer_fact.practiceItemId、收藏／错题关系、任务 dedupKey |
| 常用读取 | question(unitId,status,sortOrder,id)、session(userId,status,lastSavedAt)、answer_fact(userId,occurredAt)、favorite(userId,createdAt)、wrong(userId,reviewStatus,lastWrongAt)、announcement(status,publishedAt)、job(status,nextAttemptAt) |
| 账号事务 | 消费挑战 + 创建／修改身份 + 撤销旧会话 |
| 开练事务 | 权限检查 + 固定可用题版本与顺序 + 创建场次与全部条目 |
| 接收事务 | 锁接收控制行 + 校验 epoch／连续序号／格式 + 写 sync_batch + 推进接收水位 |
| 作答应用事务 | 按序读取持久批次 + 批量答案／事实／错题写入 + 推进应用水位 + 标记 APPLIED |
| 交卷流程 | 先封闭接收并固定 barrierSeq；应用水位达到屏障后，事务结算 + 生成结果 + 写终态 + 幂等记录 |
| 授权事务 | 校验范围版本 + 保存集合 + 处理下级受影响授权 + 审计 |
| 导入事务 | 锁批次 + 重验约束 + 创建题目及版本 + COMMITTED |
| 定时事务 | 业务对象及版本变化 + 创建／取消任务 |

并发、频控、超时、附件访问和富文本边界需在实现中做集成测试。本文是字段设计，不等同数据库迁移或生产接口已完成。
