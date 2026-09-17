# QandA 用户 Web 端

用户 Web Independent MVP，使用 React、TypeScript、Vite、TanStack Query 和 Zustand 构建。

## 本地运行

```bash
cd apps/web
pnpm install
pnpm dev
```

默认访问 `http://localhost:5173`。开发环境可通过 `/playground` 切换正常、空数据、错误、延迟、提交失败、恢复练习和 100 道题场景。

## MVP 闭环

```text
选择科目和题库
→ 设置练习
→ 答题并自动保存
→ 刷新或重新打开后恢复
→ 模拟提交与失败重试
→ 结果筛选、搜索和解析
```

页面只依赖 `PracticeGateway` 与 `PracticeSessionRepository`。后续联调时注入 HTTP Gateway，页面和练习流程无需重写。
