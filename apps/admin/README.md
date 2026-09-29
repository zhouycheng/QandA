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
- 专业下的科目增删改查、筛选和状态管理；
- 题库创建、编辑、删除、筛选、关联科目和状态管理；
- 单选题、多选题、判断题的创建、查看、编辑、删除、搜索和筛选；
- 正常、空数据、请求失败、写入失败、慢请求和 1000 道题 Playground 场景；
- 浏览器本地保存 Mock 数据。

学院、专业、科目按层级关联。存在下级数据时不能删除上级数据，避免产生孤立记录。

页面只依赖 `AdminContentGateway`。后续联调时可注入 HTTP Gateway，无需重写页面和表单。
