# 旧版练习同步接口合同

本文描述旧版练习同步服务的 7 个路由。当前 Kotlin API 的接口合同见[聚合合同](contracts/openapi.yaml)。

前缀 `/api/v1/practice/sessions`，开发／测试使用 `Authorization: Bearer <配置令牌>`。未认证401；其他用户场次404。默认请求体上限256KiB。

## 场次与题包

`POST /` 请求：

```json
{"writerId":"device-a","mode":"PRACTICE"}
```

模式为 PRACTICE 或 TEST；TEST 必须附 `timeLimitSeconds`（1至86400）。201响应含 sessionId、package、mode、writerId、writerEpoch、两个同步水位、snapshot、createdAt、syncPolicy。题包均含标准答案、解析、固定版本和判题规则版本；TEST 模拟器仅在交卷后显示结果。

`GET /{id}` 返回相同结构的当前快照；`GET /{id}/sync-status` 返回去除题包和快照后的状态。水位分别为 acceptedThroughSeq、appliedThroughSeq。默认普通练习同步参数为30秒／10题，最大100个操作／256KiB。

## 上传变化

`POST /{id}/sync-batches`：

```json
{
  "batchId":"00000000-0000-4000-8000-000000000001",
  "writerId":"device-a",
  "writerEpoch":1,
  "firstSeq":1,
  "lastSeq":2,
  "changes":[
    {"seq":1,"type":"ANSWER_CONFIRM","itemId":"item-001","answer":{"optionKeys":["opt_1"]},"evaluation":"CORRECT","awardedScore":"1.00"},
    {"seq":2,"type":"SET_POSITION","itemId":"item-002"}
  ]
}
```

ANSWER_CONFIRM 仅供 PRACTICE，包含客户端判定和得分，首次答案锁定。ANSWER_DRAFT 仅供 TEST，只包含用户答案，完成时提交最终判定。判断题 answer 为 `{"value":true}`；选择题 optionKeys 必须存在、唯一，单选恰好一个。

SET_FLAG 带 flagged 布尔值；SET_POSITION 带 itemId。所有变化序号从1起连续，换端继续上一序号。云端不接收题干／标准答案替换。

202表示批次已持久接收；receipt=ACCEPTED 与双水位用于跟踪。未应用不能显示为跨端已同步。batchId 重试保持原负载；服务端对对象字段顺序规范化后校验摘要，数组顺序保持。

## 接管

`POST /{id}/takeover`：`{"requestId":"UUID","writerId":"device-b"}`。

先固定接收屏障，等待应用后返回新 epoch、writerId 和完整快照。处理未完时 ingressState=HANDOVER，使用同 requestId 查询重试。不能把旧本地未上传数据直接合并到新 epoch。

## 完成

`POST /{id}/finish` 包含 requestId、writerId、writerEpoch、finalSeq、result。必须先获得全部批次接收凭据；finalSeq 等于当前接收水位。

result 包含 completedAt（ISO UTC）、items（本场全部20题，每题 itemId/answer/evaluation/awardedScore）、summary（total/answered/correct/wrong/unanswered/score/maxScore）。未答 answer=null、evaluation=UNANSWERED、awardedScore=0.00。选择题客观评分仅支持全对满分／错误0分；这是结果内部一致性规则，不校验标准答案。

完成时关闭新接收并等待应用水位。逐题用户答案必须等于已应用快照；PRACTICE 的判定／得分还须与首次确认记录一致。TEST 的最终判定由客户端提供。汇总须与逐题数据一致。客户端时间不证明实际作答时间，云端允许本地超时完成后补传。

`GET /{id}/result` 返回 status 与 source=CLIENT_REPORTED。FINISHING表示等待应用；COMPLETED附 result。快照不一致返回 FINISH_REJECTED，接收重新开放以便排查后重新同步、使用新 requestId 完成；已完成结果不可改。同 requestId 同负载重试返回已有状态，不同负载409。

## 错误与重试

响应错误体含 code、message；业务校验错误附 requestId。主要错误：INVALID_JSON、INVALID_FIELD、INVALID_ANSWER、INVALID_ITEM、INVALID_SEQUENCE、SEQUENCE_GAP、BATCH_CONTENT_CONFLICT、WRITER_CHANGED、SESSION_SEALED、FINAL_SEQUENCE_MISMATCH、INCONSISTENT_SUMMARY、INCONSISTENT_SCORE、SYNC_OVERLOADED。

400为格式错误，401未认证，404不存在／其他用户，409状态／序号冲突，413体积上限，422业务校验，503接收积压超限。网络失败或503保留原批次退避重试；409检查冲突，不能自动更换 epoch 覆盖。消费阻塞时 blocked=true，必须修复并重放，不能跳过水位。
