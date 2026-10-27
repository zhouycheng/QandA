# QandA 微信小程序

QandA 微信小程序面向课程复习与题库练习场景，基于微信原生技术构建。题库与学习记录当前保存在本地；身份适配层提供 HTTP Gateway 与本地降级，练习业务仍需与统一 API 完成联调。

- [小程序 MVP 产品需求](../../docs/prd/miniapp-mvp.md)
- [API 实现与合同](../api/README.md)
- [开发者操作与验证约定](AGENTS.md)

## 技术架构

小程序运行时采用 JavaScript、WXML、WXSS 与微信原生组件，不依赖 npm 包，也不需要 TypeScript 构建。代码按页面、视图模型、业务模型和数据仓储分层：

| 层次 | 目录 | 职责 |
| --- | --- | --- |
| 页面 | `miniprogram/page` | 处理界面状态、微信 API 调用与导航 |
| 视图模型 | `miniprogram/viewmodels` | 组织页面数据、用户操作与页面命令 |
| 业务模型 | `miniprogram/models`、`miniprogram/utils` | 实现练习会话、判题及可独立验证的业务规则 |
| 数据仓储 | `miniprogram/repositories` | 管理题库、练习进度、错题、收藏、偏好和学习日志 |
| 共享组件 | `miniprogram/components` | 提供题库行、弹层、答题卡及路由加载界面 |

## 页面与功能

| 页面组 | 路由目录 | 功能 |
| --- | --- | --- |
| 主导航 | `subject-list`、`bank-detail`、`stats`、`my` | 首页、题库、复盘和个人中心 |
| 练习 | `practice`、`question-detail`、`wrong-book` | 答题、题目查看、错题复习与收藏练习 |
| 账户与设置 | `login`、`register`、`forgot-password`、`account`、`reminder`、`settings` | 登录、注册、密码重置、账户管理、提醒与学习偏好 |
| 内容工具 | `import-bank` | 导入并管理本地题库 |
| 开发工具 | `playground` | 供开发人员检查练习流程与边界场景 |

路由目录均相对于 `miniprogram/page`；页面配置以 `miniprogram/app.json` 为准。自定义组件位于 `miniprogram/components`。

## 数据与资源

题库目录和题目同时保留 JavaScript 运行格式与 JSON 审阅格式。练习进度、错题、收藏、偏好及学习日志由本地存储维护。

身份功能通过 Gateway 适配 HTTP 请求，并在本地服务不可用时提供降级行为。题库、练习和学习记录目前由本地数据驱动；相关 API 合同见 [apps/api/contracts/openapi.yaml](../api/contracts/openapi.yaml)。

首页封面源素材保存在 `design/home-covers`，由 `scripts/prepare-home-covers.cjs` 生成 `miniprogram/assets/home` 中的运行资源。tabBar、首页和菜单图标也通过脚本生成。修改资源时请保留源素材，并通过对应脚本更新生成文件。

## 本地开发

使用微信开发者工具导入 `apps/miniapp` 目录并编译。项目运行不需要执行 `npm install` 或“构建 npm”。

## 检查

仓库包含 24 个 Node 自检脚本。进入 `apps/miniapp` 目录后运行：

```bash
for f in tests/*.check.js; do
  node "$f" || exit 1
done
```

`tests/compile.check.js` 调用微信开发者工具内置编译器检查 WXML 与 WXSS。代码提交前的完整验证要求见本目录的 `AGENTS.md`。
