# QandA 管理端

QandA 管理端 Independent MVP，使用 React、TypeScript、Vite、Arco Design、TanStack Query 和 Zustand 构建。

## 本地运行

```bash
cd apps/admin
pnpm install
pnpm dev
```

默认访问地址为 `http://localhost:5174`，测试账号为：

```text
admin / mock
```

## 可用功能

- Mock 登录和未登录路由保护；
- 数据概览；
- 当前大学下的学院增删改查、搜索和状态管理；
- 学院下的专业增删改查、筛选和状态管理；
- 科目增删改查、筛选、状态管理，并可关联多个专业；
- 题库创建、编辑、删除、筛选、关联科目和状态管理；
- 单选题、多选题、判断题的创建、查看、编辑、删除、搜索和筛选；
- 正常、空数据、请求失败、写入失败、慢请求和 1000 道题 Playground 场景；
- 浏览器本地保存 Mock 数据。

学院与专业按层级关联，科目通过关联关系供多个专业共用。存在专业时不能删除学院，专业仍关联科目时不能删除专业，避免产生孤立记录。

页面只依赖 `AdminContentGateway`。后续联调时可注入 HTTP Gateway，无需重写页面和表单。
