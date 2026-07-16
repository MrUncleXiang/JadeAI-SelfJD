# JadeAI Career 分阶段实施计划

状态：Phase 1 active
基线：JadeAI v0.4.1 / `ca38294960e4b6f8a1ba66d0106059fcf97c323c`

## 1. 执行原则

1. 每个阶段只在前一阶段 Gate 通过后开始。
2. 每个需求 ID 对应实现任务、测试和验收证据。
3. 生产安装 `/home/ubuntu/apps/JadeAI` 在发布阶段前不修改。
4. 真实 `MyUnityResume` 是私有本地 Fixture，不提交到公开仓库。
5. 失败测试不得被删除、跳过或放宽来制造通过。
6. 数据库、安全策略和外部授权属于人工 Gate。

## 2. Codex 自动推进循环

每个任务使用以下有界循环：

```text
load frozen requirement and ADR
  -> create focused branch/commit scope
  -> add failing test or baseline reproduction
  -> implement smallest change
  -> run targeted tests
  -> run phase gate
  -> failure: classify and repair
  -> same failure signature max 3 repair rounds
  -> pass: record evidence and commit
  -> next task
```

达到三次相同失败或需要外部凭证时停止该任务，记录阻塞，不通过修改需求或跳过测试绕过。

## 3. Phase 0：规格、工作区和基线

目标：形成可执行且机器可检查的规格，不修改生产。

任务：

- [x] 从上游 `v0.4.1` 建立校验 Blob SHA 的本地源码快照。
- [x] 建立独立目录 `/home/ubuntu/jadeai-career`。
- [x] 创建 `codex/phase-0-spec` 分支。
- [x] 冻结微信、QQ、`opentalking`、语音和数字人排除范围。
- [x] 生成 PRD、需求矩阵、架构、威胁模型和 ADR。
- [x] 生成实施计划和验收矩阵。
- [ ] 获得正式 GitHub Fork/Remote 写权限。
- [ ] 从正式 Fork 恢复完整上游 Git 历史，并移植 Phase 0 Commit。
- [ ] 准备至少 10GB 可用开发空间。

Gate：

- `pnpm spec:check`
- 文档链接、需求 ID 和 YAML 结构检查。
- Git 工作区仅包含预期 Phase 0 文件。

## 4. Phase 1：账号、管理员和租户隔离

关联：AUTH-001 至 AUTH-006、OPS-001、SEC-001。

实现：

1. [x] PostgreSQL/SQLite 账号 Schema、旧库冲突保留策略和迁移重放。
2. [x] 用户名、可选邮箱、密码凭证和数据库 Session。
3. [x] 注册模式、邀请和密码修改；邮件密码重置暂不进入首个可运行切片。
4. [x] Admin 用户列表、禁用、恢复和最后管理员保护。
5. [x] 账号、邀请、管理员操作和登录失败审计事件。
6. [x] 统一 `ActorContext` 和账号密码 UI。
7. [x] 所有 Resume、Chat、Share、Analysis、Interview 受保护 Route 改用用户作用域仓储，公共分享改用显式 Token 能力查询。
8. [x] AI Chat 在加载 Resume 和创建模型请求前校验 Ownership。
9. [x] 移除旧 NextAuth/Google 入口、生产指纹账号和自动 Demo Seed。
10. [x] 登录/注册数据库限流、Origin 校验和会话撤销。
11. [x] PostgreSQL 旧库迁移、登录和 Session 撤销集成验收。
12. [ ] Playwright E2E 和全资源租户参数化验收。

自动测试：

- Auth Service Unit。
- PostgreSQL Integration。
- SQLite 空库/旧库 Migration Replay。
- 两用户跨租户 Route 参数化测试。
- Playwright 注册/邀请/登录/退出/禁用。
- Session 撤销、并发 Last Admin、CSRF、限流。

Gate：所有现有测试和 Phase 1 安全测试通过。

人工 Gate：Schema、密码参数、Bootstrap Admin 和迁移方案评审。

## 5. Phase 2：用户级 LLM 档案

关联：LLM-001 至 LLM-005。

实现：

1. `llm_profiles`、Feature Binding 和 AES-GCM Key Version。
2. 服务端 Provider Resolver，业务 Route 不再读取 `x-api-key`。
3. 设置页支持多档案 CRUD、掩码和连接测试。
4. JSON、Tool、Vision 能力探测。
5. 出站 URL 策略、DNS/IP 校验和管理员私网 Allowlist。
6. 调用审计、超时、并发和错误分类。
7. 清除浏览器 `localStorage` 中旧 API Key，并提供一次迁移提示。

自动测试：

- 加解密和 Key Rotation。
- 用户隔离。
- Mock OpenAI-compatible、Anthropic、Gemini。
- Tool 不支持、JSON 不支持、Vision 不支持。
- SSRF 地址和重定向矩阵。

Gate：浏览器、日志、API 和数据库扫描无明文 Key。

## 6. Phase 3：ResumePatch、Diff 和版本

关联：RES-003、AI-001 至 AI-004。

实现：

1. Resume Version、Change Set 和 Operation Schema。
2. LLM 候选生成及 JSON 降级。
3. Schema、领域、租户和证据校验框架。
4. 确定性 Diff UI。
5. 应用单项/全部、乐观并发和事务。
6. 恢复旧版本。
7. 将现有 Chat Tool 改造成“提出变更”，禁止直接写库。

自动测试：

- 所有 Operation 类型。
- 非法/双重编码/Code Fence JSON。
- Stale Version、部分选择和事务回滚。
- Tool 与 JSON-only Provider Contract。
- Playwright Chat -> Diff -> Apply -> Undo。

Gate：任何 AI 请求都不能绕过 Change Set 直接修改 Resume。

## 7. Phase 4：职业知识库和 WorkResume v2

关联：KB-001、KB-002、MYR-001。

实现：

1. Source Snapshot、Document、Career Fact、Evidence 和 Review Schema。
2. 事实列表、详情、编辑、批准、拒绝和合并 UI。
3. WorkResume v2 JSON/Markdown 解析器。
4. `allowedClaims` 和 `forbiddenClaims` 策略。
5. 合成 Fixture 和黄金输出。
6. 本地私有 `MyUnityResume` 只读验收命令。

自动测试：

- Schema Version 和配置路径。
- 内容哈希、JSON Pointer、Markdown 行定位。
- 重复导入幂等。
- Fact 状态机。
- 黄金文件对比。

人工 Gate：用真实本地仓库检查事实质量，但不将个人内容写入测试日志。

## 8. Phase 5：GitHub App 与增量同步

关联：GH-001 至 GH-005。

实现：

1. GitHub App Setup Callback、Pending State 和 Repository Selection。
2. Installation 元数据和短期 Token 获取。
3. GitHub API Client、条件请求和限流处理。
4. 首次同步、Blob 校验和适配器调度。
5. Webhook 验签、Delivery 去重和后台队列。
6. Push 增量、定时对账和手动同步。
7. 路径过滤、Secret Scan 和 Prompt Injection 防护。
8. 同步状态和错误 UI。

自动测试：

- Mock GitHub Contract。
- 私有选中/未选中仓库。
- 同 SHA 幂等、单文件变化、删除和重命名。
- Webhook 验签、重放和权限撤销。
- 恶意仓库 Fixture。

人工 Gate：用户创建测试 GitHub App，并对一个测试私有仓库完成 E2E。

## 9. Phase 6：JD 与定向简历

关联：JD-001 至 JD-004、RES-002。

实现：

1. 文本、PDF、DOCX、图片上传。
2. 安全文本抽取和 Vision/OCR Adapter。
3. JD Requirement 审核 UI。
4. Fact Match 和缺口分析。
5. Targeted Resume Clone。
6. ResumePatch 定向建议。
7. PDF/DOCX 内容与泄漏门禁。

自动测试：

- 上传格式和资源限制。
- 恶意 DOCX/PDF Fixture。
- Draft Fact 排除。
- 基准简历不变。
- PDF/DOCX 可打开、文本正确、无内部证据。

## 10. Phase 7：面试和现有功能回归

关联：INT-001、INT-002、RES-001。

实现：

1. 面试资源全面租户化。
2. 会话绑定不可变 Resume Version 和 JD。
3. 基于证据的追问和结构化报告。
4. Resume-agent 的追问与验证思想在本项目中重新实现。
5. 全模板编辑、预览、分享和导出回归。

自动测试：

- 面试跨租户。
- 轮次恢复和报告生成。
- 模板视觉快照。
- 分享发布快照与内部版本隔离。

## 11. Phase 8：迁移、发布和运行

关联：OPS-002、SEC-002 和全量需求。

实现：

1. 从现有 JadeAI 数据库迁移用户、简历、聊天和面试。
2. 旧指纹用户认领策略。
3. Docker Compose Web/Worker/PostgreSQL。
4. 备份、恢复、密钥轮换和升级 Runbook。
5. 全量安全扫描、性能基线和故障演练。
6. 灰度部署，旧实例只读保留，验证后切换。

发布 Gate：

```text
spec
  -> lint
  -> type-check
  -> unit
  -> PostgreSQL integration
  -> contract
  -> Playwright E2E
  -> security
  -> migration replay
  -> export artifact
```

人工 Gate：生产备份、迁移计划、外部凭证和最终切换。

## 12. 提交和证据规范

提交示例：

```text
feat(auth): add invitation registration [AUTH-002]
test(ai): cover stale resume patch rejection [AI-002]
fix(github): deduplicate webhook delivery [GH-003]
```

每个阶段完成后记录：

- Commit SHA。
- 已实现需求 ID。
- 测试命令和结果。
- 迁移文件。
- 已知限制。
- 回滚步骤。
