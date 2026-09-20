# 题库导入契约与脚本

面向「开发者 / 运营批量导入题库」这条路径。MVP 阶段没有后端，导入产物直接落到小程序本地数据目录，
后端就绪后同一份契约不变，只是把落地方式换成接口调用。

- 脚本：`apps/miniapp/scripts/import-question-bank.cjs`（零依赖，Node ≥ 18）
- 模板：`apps/miniapp/templates/question-bank-template.csv`

---

## 1. 三步上手

```bash
# 1) 拿一份模板
node apps/miniapp/scripts/import-question-bank.cjs --init-template 我的题库.csv

# 2) 先干跑一遍，只看校验结果、不写文件
node apps/miniapp/scripts/import-question-bank.cjs \
  --file 我的题库.csv \
  --subject-id subject-demo --subject-name 示例科目 \
  --bank-id demo-ch001 --bank-name 第一章 \
  --dry-run

# 3) 正式导入
node apps/miniapp/scripts/import-question-bank.cjs \
  --file 我的题库.csv \
  --subject-id subject-demo --subject-name 示例科目 \
  --bank-id demo-ch001 --bank-name 第一章
```

导入后脚本会自动完成三件事，不需要手改任何代码：

1. 生成 `miniprogram/data/banks/<bankId>.js` 与 `.json`
2. 更新 `miniprogram/data/catalog.js` / `.json`（重算科目与顶层题量）
3. 往 `miniprogram/utils/question-bank-catalog.js` 的 `BANK_LOADERS` 登记一行
   —— 小程序 `require` 不支持动态路径，少这一行题库加载不出来

最后一步在微信开发者工具里「清缓存 → 重新编译」，新题库就会出现在题库页。

> 手里是 `.xlsx`？脚本不解析 Excel（保持零 npm 依赖）。
> 在 Excel 里「另存为 → CSV UTF-8（逗号分隔）」即可；中文乱码时脚本会自动按 GBK 重试。

---

## 2. CSV / TSV 表格契约

分隔符自动探测（`,` 或制表符），编码自动探测（UTF-8 / UTF-8 BOM / GBK）。

### 列名（大小写与空格不敏感，中英文都收）

| 列 | 必填 | 别名 | 说明 |
|---|---|---|---|
| 题型 | ✅ | type / 题目类型 / 类型 | 单选 / 多选 / 判断（或 single / multiple / judge） |
| 题干 | ✅ | stem / 题目 / title | 非空 |
| 选项A…选项F | 二选一 | optionA…optionF / A…F | 分列写法；判断题不需要 |
| 选项 | 二选一 | options / 所有选项 | 合并写法，用 `|` `、` `，` `;` `/` 任一分隔 |
| 答案 | ✅ | answer / 正确答案 / answerKeys | 见下 |
| 解析 | | explanation / 答案解析 | 缺省填「本题暂无解析。」 |
| 难度 | | difficulty | easy / normal / hard（或 简单 / 中等 / 困难） |
| 标签 | | tags / 知识点 | 多个用 `|` 分隔 |
| id | | 题号 / 题目编号 | 不给则按 `<bankId>-q001` 自动生成 |

### 答案写法

| 场景 | 可写 | 归一结果 |
|---|---|---|
| 单选 | `A` / `a` | `['A']` |
| 多选 | `AC` / `A,C` / `A｜C` / `A、C` | `['A','C']` |
| 判断 | `正确` `对` `√` `T` / `错误` `错` `×` `F` | `['A']` / `['B']` |
| 兜底 | 选项文本本身 | 按文本匹配选项 |

判断题的选项由脚本自动补成 `A 正确 / B 错误`，表里留空即可。

### 会被拦下的行（默认一个文件都不写）

- 题型无法识别
- 题干为空
- 非空选项少于两个
- 答案不在选项范围内（例如写了 `D` 但只有 A/B/C）
- 多选题只有 1 个答案；单选 / 判断给了多个答案
- 题目 id 重复

题干重复只给**警告**不拦（同一知识点出现两次是常见情况）。
确认要跳过坏行，加 `--skip-invalid`。

---

## 3. 题目 JSON 契约

脚本产出的 `.json` 与表单一一对应，也是后续后端接口的题目结构：

```json
{
  "status": "released",
  "subjectId": "subject-demo",
  "subjectName": "示例科目",
  "bankId": "demo-ch001",
  "bankName": "第一章",
  "sourceChapterId": "",
  "questionCount": 3,
  "questions": [
    {
      "id": "demo-ch001-q001",
      "type": "single",
      "stem": "下列句子中没有语病的一项是：",
      "options": [
        { "key": "A", "label": "A", "text": "他的写作水平明显提高了" },
        { "key": "B", "label": "B", "text": "他的写作水平明显改进了" }
      ],
      "answerKeys": ["A"],
      "weight": 1,
      "difficulty": "easy",
      "tags": ["病句"],
      "explanation": "「水平」与「提高」搭配，其余动词搭配不当。"
    }
  ]
}
```

字段约束：

| 字段 | 类型 | 约束 |
|---|---|---|
| id | string | 全局唯一，建议 `<bankId>-qNNN` |
| type | enum | `single` / `multiple` / `judge` |
| stem | string | 非空 |
| options | array | ≥ 2 项；`key` 取自 A–F，`label` 一般与 key 相同 |
| answerKeys | string[] | 必须全部命中 `options[].key`；多选 ≥ 2，其余 = 1 |
| weight | number | 计分权重，默认 1 |
| difficulty | enum | `easy` / `normal` / `hard` |
| tags | string[] | 可为空 |
| explanation | string | 可为空，导入时兜底 |

**与运行时的一致性**：导入的题目必须能被 `utils/question-bank-catalog.js` 的
`normalizeQuestionView()` 正确归一化（补出 `typeText` / `isMultiple` / `isJudge`）。
`tests/import-bank.check.js` 里专门有断言守这条——契约与运行时规则一旦分叉，
坏数据会一路流到答题页。

---

## 4. 后端接口契约（阶段 2 落地，现在先冻结）

小程序本地加载与服务端加载共用同一份题目结构，切换来源不影响练习 / 进度 / 错题 / 统计。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/subjects` | 科目列表（含题库计数） |
| GET | `/api/subjects/{subjectId}/question-banks` | 科目下的题库列表 |
| GET | `/api/question-banks/{bankId}/questions` | 题目明细（**当前 API PRD 缺失，需补**） |
| POST | `/api/question-banks/import` | 上传文件导入，导入前走同一套校验规则 |
| GET | `/api/import-tasks/{taskId}` | 导入任务状态（解析中 / 成功 / 失败明细列表） |

导入接口的错误返回要带**行号**，与脚本的校验报告结构一致：

```json
{
  "taskId": "imp_20260920_001",
  "status": "failed",
  "total": 120,
  "accepted": 117,
  "errors": [
    { "line": 35, "field": "答案", "reason": "答案 D 超出选项范围" }
  ]
}
```

小程序侧的对应出口已经就位：`repositories/http-gateway.js` 实现了
`getSubjects` / `getQuestionBanks`，联调时 `setGateway(httpGateway)` 一行切换。

---

## 5. 已知边界

- 暂不支持图片题、公式、富文本题干（schema 里没有对应字段，需要先扩契约）
- 暂不支持 `.xlsx` 直读（零依赖取舍）
- 导入只覆盖同 `bankId` 的题库，不会自动清理已删除的题目——
  需要删题时直接改 `data/banks/<bankId>.json` 后重跑导入，或手动同步 catalog 计数
