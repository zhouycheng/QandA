# QandA 微信小程序

QandA 微信小程序面向课程复习与题库练习场景，基于微信原生技术构建。正式运行使用统一 `/api/v1`，目录与学习记录由后端维护。已下载的练习支持离线续答，答题草稿持久化到本机并在联网后同步。接口覆盖见[接入台账](../../docs/miniapp-api-integration.md)。

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

正式入口读取服务端目录、资料、收藏、错题及统计。练习创建时固定配置、修订和顺序；客户端判题数据留在模型层，页面按反馈模式展示。正式成绩由服务端计算。旧本地学习记录保留，在线账号使用独立缓存和草稿命名空间。

开发场景保留静态题库与显式测试适配器。用户上传题库入口暂时关闭。相关 API 合同见 [apps/api/contracts/openapi.yaml](../api/contracts/openapi.yaml)。

首页封面源素材保存在 `design/home-covers`，由 `scripts/prepare-home-covers.cjs` 生成 `miniprogram/assets/home` 中的运行资源。tabBar、首页和菜单图标也通过脚本生成。修改资源时请保留源素材，并通过对应脚本更新生成文件。

## 本地开发

使用微信开发者工具导入 `apps/miniapp` 目录并编译。项目运行不需要执行 `npm install` 或“构建 npm”。

将 `miniprogram/ext.example.json` 复制为忽略的 `miniprogram/ext.json`，填写当前小程序 AppID 和 `extConfig.apiBaseUrl`（服务根地址）；App 通过 `wx.getExtConfigSync()` 读取配置。真机使用可访问的 HTTPS 服务和合法请求域名。接口地址或登录未配置成功时，页面会显示对应错误。

已有后端数据库先按 API README 执行练习同步结构升级；新建隔离数据库直接使用完整 schema。开发配置、令牌和真实连接参数保存在忽略文件或仓库外。

## 检查

仓库包含 Node 自检脚本和真实编译检查。进入 `apps/miniapp` 目录后运行：

```bash
for f in tests/*.check.js; do
  node "$f" || exit 1
done
```

`tests/compile.check.js` 调用微信开发者工具内置编译器检查 WXML 与 WXSS。代码提交前的完整验证要求见本目录的 `AGENTS.md`。
