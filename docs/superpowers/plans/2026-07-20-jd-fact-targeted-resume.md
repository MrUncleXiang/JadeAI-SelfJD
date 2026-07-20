# JD × 职业事实库定向简历实施计划

日期：2026-07-20  
关联需求：`JD-003`、`JD-004`、`AI-001` 至 `AI-003`、`RES-003`

## 1. 结论

用户理解正确，产品主链路应为：

```text
Approved Career Facts
  + Confirmed JD Requirements
  + 可选的基准简历
  -> AI 生成有证据引用的 ResumePatch
  -> 用户审阅 Diff
  -> 应用到独立 Targeted Resume
  -> PDF / DOCX 导出
```

当前实现只完成了两条互不相连的支线：

- Approved Fact 可以生成一份基线简历 Change Set；
- JD 可以导入、结构化、人工确认；
- ResumePatch 已支持 `evidenceIds` 和 `jdRequirementIds`，但生成提示词明确要求
  `jdRequirementIds` 为空，且页面没有从 JD 发起定向生成的入口。

因此这不是产品理念分歧，而是 Phase 6C/6D 尚未实现。

## 2. 首个可运行切片

本次先实现用户能直接使用的最小闭环：

1. 仅允许选择当前用户的 `confirmed` JD。
2. 仅加载当前用户的 `approved` Career Fact 和 Approved Evidence。
3. 用户可选择：
   - 从事实库新建定向简历；
   - 从一份现有简历复制为定向副本。
4. 新简历记录类型、父简历和目标 JD，基准简历不被修改。
5. AI 只生成 Change Set，不直接写入简历正文。
6. 每个新增事实仍必须引用 Approved Evidence；JD 引用只能来自当前选中的已确认 JD。
7. 用户进入现有 Change Set 审阅页，选择后应用。

## 3. 数据模型

在 `resumes` 增加：

- `kind`: `baseline | targeted | general-copy`，默认 `baseline`；
- `parent_resume_id`: 可空，自关联，记录被复制的基准简历；
- `target_jd_source_id`: 可空，关联用于定向生成的 JD。

首个切片不持久化 `jd_fact_matches`。生成的 ResumePatch Operation 已同时保存
`evidenceIds` 与 `jdRequirementIds`，足以形成可审计的最小关联。后续再增加
strong / partial / gap / conflict 匹配矩阵及单独的缺口分析界面。

## 4. API 与交互

新增：

```http
POST /api/jd-sources/{jdSourceId}/target-resume
```

请求可包含 `baseResumeId`、`title`、`template`、`language`、`instruction`。
响应返回 `resumeId`、`changeSetId`、`operationCount`，页面随后打开现有 Diff 审阅界面。

`/jd` 中只有 `confirmed` 卡片显示“生成定向简历”。默认选择“从事实库新建”，
也允许选一份当前用户已有简历作为基准。

## 5. 安全与一致性门禁

- 非本租户 JD、事实和简历均返回不可用。
- `draft/rejected/superseded` Fact 不进入模型上下文。
- 非 `confirmed` JD 不允许生成。
- 模型返回的 `evidenceIds` 必须属于 Approved Evidence。
- 模型返回的 `jdRequirementIds` 必须属于所选 JD。
- JD 被重新编辑而撤销确认后，旧 Change Set 应用时失败关闭。
- 生成失败删除刚创建的 Targeted Resume，不留下空壳。
- 基准 Resume 的正文、版本号和元数据保持不变。

## 6. 自动化验收

聚焦测试：

1. 已确认 JD + Approved Fact 能生成带双重引用的 Change Set。
2. 未确认 JD 被拒绝，且不创建 Resume。
3. 没有 Approved Fact 被拒绝，且不创建 Resume。
4. 跨租户基准简历不可复制。
5. 非法 JD Requirement ID 被 ResumePatch 校验拒绝。
6. Targeted Resume 生成后基准简历及其 Version 不变。
7. 生成异常时 Targeted Resume 被回收。
8. API 强制账号 Session、可信 Origin 和严格请求 Schema。
9. TypeScript、Migration Replay、规格检查、生产构建全部通过。

## 7. 后续切片

首个闭环稳定后实现独立 `analyze`：

- 持久化 Requirement ↔ Fact 匹配；
- 展示 strong / partial / gap / conflict；
- 允许用户排除不希望用于该岗位的事实；
- 将用户确认后的匹配集合送入定向 ResumePatch；
- 加入 PDF/DOCX 导出内容与内部证据泄漏门禁。
