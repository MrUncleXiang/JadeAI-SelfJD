# JadeAI Career 分阶段实施计划

状态：Phase 5B 文件/目录、Phase 5C 公共 URL、Phase 5D Fine-grained PAT 已完成；GitHub App 为可选高级模式
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
- [x] 获得正式 GitHub Fork/Remote 写权限，并使用仓库专用 Deploy Key 推送阶段分支。
- [x] 从正式 Fork 恢复完整上游 Git 历史，并移植既有阶段 Commit。
- [x] 清理可重建 `.next` 产物并确认当前空间可完成聚焦测试与单次构建；活动服务目录不做破坏性清理。

Gate：

- `pnpm spec:check`
- 文档链接、需求 ID 和 YAML 结构检查。
- Git 工作区仅包含预期 Phase 0 文件。

## 4. Phase 1：账号、管理员和租户隔离

关联：AUTH-001 至 AUTH-008、OPS-001、SEC-001。

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
12. [x] Playwright E2E 和全资源租户参数化验收。
13. [x] 账号级简历个人信息：账号页可编辑，模板/导入/知识库/JD 定向/AI 生成简历自动带入或补空。

自动测试：

- Auth Service Unit。
- PostgreSQL Integration。
- SQLite 空库/旧库 Migration Replay。
- 两用户跨租户 Route 参数化测试。
- Playwright 注册/邀请/登录/退出/禁用。
- Session 撤销、并发 Last Admin、CSRF、限流。

Gate：所有现有测试和 Phase 1 安全测试通过。

账号级简历个人信息补丁（2026-07-20）：

- `users.settings.resumePersonalInfo` 作为非机密账号偏好保存，无数据库迁移。
- 自动化验收：`src/app/api/user/resume-personal-info.route.test.ts`、`src/lib/user/resume-personal-profile.test.ts`、`src/lib/resume/from-knowledge.test.ts`、`src/lib/resume/targeted.test.ts`。


人工 Gate：Schema、密码参数、Bootstrap Admin 和迁移方案评审。

自动化证据（2026-07-16）：

- `pnpm test:e2e`：3 个真实浏览器场景通过，覆盖 closed/open/invite 注册、登录/退出、禁用、Session 失效、CSRF、Last Admin 和跨租户 Resume 读写/复制/删除/导出。
- `pnpm test`：17 个测试文件、80 个测试通过；全资源 Route Guard 和仓储租户参数化测试包含 Resume、Chat、Share、Analysis、Interview。
- `pnpm test:migration`、PostgreSQL `pnpm test:integration`、`pnpm type-check`、`pnpm spec:check` 和 `pnpm build` 通过。
- 本阶段新增/修改文件通过 ESLint；上游模板代码仍有既存全量 Lint 债务，未通过放宽规则或批量无关修改掩盖。

## 5. Phase 2：用户级 LLM 档案

关联：LLM-001 至 LLM-005。

实现：

1. [x] `llm_profiles`、Feature Binding 和 AES-GCM Key Version。
2. [x] 服务端 Provider Resolver，业务 Route 不再读取 `x-api-key`。
3. [x] 设置页支持多档案 CRUD、掩码、模型列表和连接测试。
4. [x] JSON、Tool、Vision 能力探测。
5. [x] 出站 URL 策略、DNS/IP 校验、实际请求 IP Pinning、重定向拒绝和管理员私网 Allowlist。
6. [x] 档案/能力测试审计、请求超时和稳定错误分类。
7. [x] 旧浏览器 Key 一次性迁移，且仅在服务端档案和绑定成功后清除。
8. [ ] 完整 AI 调用用量审计、统一响应大小及进程级并发配额作为发布加固项继续补齐。

自动测试：

- 加解密和 Key Rotation。
- 用户隔离。
- Mock OpenAI-compatible、Anthropic、Gemini。
- Tool 不支持、JSON 不支持、Vision 不支持。
- SSRF 地址和重定向矩阵。

Gate：浏览器、日志、API 和数据库扫描无明文 Key。

当前进度（2026-07-16）：

- [x] SQLite/PostgreSQL `llm_profiles`、`llm_feature_bindings` 前向迁移。
- [x] 版本化 AES-256-GCM Keyring、随机 IV、AAD 租户绑定和轮换单测。
- [x] 租户化档案 CRUD、Feature Binding API、安全 DTO、审计与集成测试。
- [x] 保存阶段 HTTPS、DNS/IP 分类、精确 Origin/CIDR Allowlist 门禁及单测。
- [x] 服务端 Provider Resolver、每次实际请求复检/IP Pinning、重定向拒绝和业务 Route 去除 `x-api-key`。
- [x] JSON/Tool/Vision 能力探测、超时和稳定错误分类。
- [x] 设置页多档案管理、Feature 选择、模型列表和旧浏览器 Key 安全迁移。
- [x] Playwright 旧 Key 迁移与绑定 Gate；单元测试、TypeScript 和生产构建通过。
- [ ] 完整 Mock Provider 浏览器矩阵、全 AI 调用用量审计、统一响应上限及进程级并发配额。

自动化证据（2026-07-16）：

- `pnpm test`：24 个测试文件、111 个测试通过。
- `pnpm test:e2e`：4 个真实浏览器场景通过，新增场景覆盖旧浏览器 Key 迁移、四类 Feature 绑定、成功后清除和 API 不回传密钥材料。
- `pnpm type-check`、`pnpm build`、`pnpm test:migration`、`pnpm test:integration` 和 `pnpm spec:check`。
- 新增 LLM 核心文件通过 ESLint；上游/既有组件仍保留全量 Lint 债务，未放宽规则。

## 6. Phase 3：ResumePatch、Diff 和版本

关联：RES-003、AI-001 至 AI-004。

实现：

1. [x] Resume Version、Change Set 和 Operation Schema，含 SQLite/PostgreSQL 前向迁移。
2. [x] LLM Tool 候选生成、文本 JSON 降级和有界修复。
3. [x] Schema、领域、租户、哈希和证据引用策略框架。
4. [x] 服务端确定性 Diff 与编辑器审阅 UI。
5. [x] 应用单项/全部、乐观并发、事务回滚和审计。
6. [x] 恢复旧版本且保留完整历史。
7. [x] 将现有 Chat Tool 改造成显式“提出变更”，普通对话禁止直接写库。
8. [x] 显式拒绝 Change Set；提案编辑后重校验仍待补齐。
9. [~] AI 初始简历生成 `/api/ai/generate-resume` 已迁移到 Change Set/事实库边界；翻译覆盖模式仍待迁移。
10. [x] 接入真实数据源：Phase 4 Approved Fact/Forbidden Claim 与 Phase 6A 已确认 JD Requirement
    共同约束定向 ResumePatch；显式匹配矩阵与缺口分析留在 Phase 6C.2。

自动测试：

- 所有 Operation 类型。
- 非法/双重编码/Code Fence JSON。
- Stale Version、部分选择和事务回滚。
- Tool 与 JSON-only Provider Contract。
- Playwright Chat -> Diff -> Apply -> Undo。

Gate：任何 AI 请求都不能绕过 Change Set 直接修改 Resume。

当前进度（2026-07-16）：

- ResumePatch v1 九类 Operation、严格 Schema、服务端 Diff、Stale 检测、部分选择、事务回滚和版本恢复已实现。
- AI Chat 已完全移除仓储写入 Tool；“生成提案”与普通聊天分离，提案持久化不会修改在线简历。
- 真实浏览器已覆盖 `candidate -> 审阅 -> 只应用选中项 -> 恢复 Version 1`，并验证 Change Set 历史仍可查询。
- SQLite 空库/旧库迁移和真实 PostgreSQL 临时实例均已覆盖新增三张表及 Apply/Restore 流程。
- Gate 仍为 **partial**：Phase 4 已提供 AI-003 的真实事实证据闭环，Phase 6C.1 已接入已确认
  JD Requirement 并生成独立定向 ResumePatch；上游遗留 `/api/ai/translate` 与
  `/api/ai/generate-resume` 尚未迁移，Phase 6C.2 的显式事实匹配与缺口分析仍待实现。

自动化证据（2026-07-16）：

- `pnpm test`：26 个测试文件、119 个测试通过。
- `pnpm test:e2e`：5 个真实浏览器场景通过。
- `pnpm test:migration`、真实 PostgreSQL `pnpm test:integration`、`pnpm type-check`、`pnpm build` 和 `pnpm spec:check` 通过。
- Phase 3 新增/修改核心文件通过聚焦 ESLint；未放宽全局规则掩盖既有债务。

## 7. Phase 4：职业知识库和 WorkResume v2

关联：KB-001、KB-002、MYR-001。

实现：

1. [x] Source Repository、Snapshot、Document、Career Fact、Evidence、Claim、Relation 和 Review Schema。
2. [x] 事实列表、详情、编辑、批准、拒绝和合并 UI。
3. [x] WorkResume v2 JSON/Markdown 解析器与安全路径/文本边界。
4. [x] `allowedClaims`、`forbiddenClaims` 和 ResumePatch 应用前重校验策略。
5. [x] 合成 Fixture、黄金输出和重复导入幂等测试。
6. [x] 本地私有 `MyUnityResume` 干净 Git Commit 绑定的只读验收命令。

自动测试：

- Schema Version 和配置路径。
- 内容哈希、JSON Pointer、Markdown 行定位。
- 重复导入幂等。
- Fact 状态机。
- 黄金文件对比。

人工 Gate：用真实本地仓库检查事实质量，但不将个人内容写入测试日志。

当前进度（2026-07-16）：

- SQLite/PostgreSQL 前向迁移和租户化仓储已覆盖来源、快照、文档、事实、证据、Claim、合并关系与审核事件。
- `/knowledge` 提供状态/类型筛选、来源定位、编辑版本、批准、拒绝和合并；GitHub 授权与自动增量同步明确保留到 Phase 5。
- WorkResume v2 只读取受配置约束的已跟踪 UTF-8 文本，拒绝符号链接、秘密文件名、越界路径、二进制内容、脏工作树和未跟踪文档。
- Approved Evidence 可跨简历复用；ResumePatch 在提案和应用时加载策略，事实撤销后不会把旧提案写入在线简历。
- 私有 `MyUnityResume` 只读检查已在不输出个人正文和绝对路径的前提下完成，个人仓库不会进入公开 Fixture。

自动化证据（2026-07-16）：

- `pnpm test`：29 个测试文件、137 个测试通过；覆盖解析 golden、重复导入、状态机、租户隔离、API 生命周期、无效筛选错误关联、跨简历复用和应用前证据撤销。
- `pnpm test:e2e`：6 个真实浏览器场景通过，新增 `/knowledge` 登录保护、页面渲染和租户化事实查询。
- `pnpm test:migration` 与真实临时 PostgreSQL `pnpm test:integration` 通过，验证旧库升级、八张知识库表和 WorkResume 导入/审核。
- `pnpm type-check`、聚焦 ESLint、`pnpm spec:check` 和 `pnpm build` 通过。
- 私有仓库只读检查：19 个文档、46 条事实、142 条证据、445 条声明；聚合哈希 `sha256:bb1dbd6e2dc95a5b89efce2de58050a4ea52e68ddbcec99f97104154cb3c6335`，无警告代码。

## 8. Phase 5：分层个人信息来源与 GitHub 同步

关联：KB-003、GH-001 至 GH-007。

### 8.1 Phase 5A：可选 GitHub App 高级模式

1. [x] GitHub App Setup Callback、哈希 Pending State 和 Repository Selection。
2. [x] Installation 元数据和短期 Token 获取；Token 不进入仓储参数或数据库。
3. [x] 有界 GitHub API Client、Git Blob SHA 校验、超时、限流和稳定错误映射。
4. [x] 首次同步、不可变 Snapshot、WorkResume v2 适配器和只下载变化 Blob。
5. [x] Webhook 验签、Delivery 去重、数据库 Job、生命周期和定时补偿。
6. [x] 知识库页面的授权、仓库选择、同步状态、错误和轮询 UI。
7. [ ] 仅当部署者启用 App 时，使用测试私有仓库执行真实安装/Webhook 浏览器 Gate。

### 8.2 Phase 5B：无 GitHub App 的上传入口

1. [x] 浏览器文件夹选择和 WorkResume v2 相对路径传输。
2. [x] `GET/POST /api/sources/workresume-upload`、账号 Session、Origin 校验和数据库限流。
3. [x] 最多 500 文件、单文件 1 MiB、总正文 12 MiB、请求体 14 MiB 的边界。
4. [x] 路径规范化、生成目录/非白名单忽略、UTF-8/二进制/Secret/Prompt Injection 检查。
5. [x] 规范化文件集合 SHA-256 Revision、重复上传幂等、新 Revision 父快照和旧证据 Stale。
6. [x] 用户作用域来源状态、不可变文档/事实/证据和不含路径/正文的审计元数据。
7. [x] 知识库页面上传卡片及中英文状态/错误文案。
8. [x] 真实 Chromium 文件夹选择 E2E 覆盖 UI 上传、受保护 API 和租户化事实查询。

### 8.3 Phase 5C：远程仓库的简化连接

1. [x] 公共 GitHub URL 规范化和固定 GitHub API Adapter，不执行任意 URL Clone。
2. [x] 公共 URL 与 App 共用安全扫描、WorkResume 解析、快照、事实审核和幂等语义。
3. [x] 公共 URL SSRF/无凭证 Contract、增量 Blob、租户 API 和浏览器 E2E。

### 8.4 Phase 5D：Fine-grained PAT 私有仓库连接

1. [x] 用户级 Fine-grained PAT 加密保存、明确仓库选择、手动同步和定时轮询。
2. [x] PAT Adapter 接入同一安全扫描、解析、快照和事实审核管线。
3. [x] PAT 密文 AAD 绑定用户/连接，列表与任务 DTO 脱敏，撤销时删除密文并取消仓库选择。
4. [x] 固定 `https://api.github.com`、拒绝重定向、有界超时与响应、稳定错误映射。
5. [x] SQLite/PostgreSQL 前向迁移、租户 API、知识库 UI 和浏览器不持久化令牌验收。
6. [x] PAT 格式、加密、轮换兼容、撤销、统一同步和明文扫描自动化测试。

当前进度（2026-07-17）：

- 默认 MVP 不需要 GitHub App；当前账号登录仍是用户名/密码，所有 GitHub 凭证只属于来源连接。
- 文件夹上传已经打通 UI -> 受保护 API -> 安全解析 -> 不可变快照 -> Draft Fact 的窄端到端链路。
- 相同上传 Revision 返回幂等结果；选中文档变化时创建子快照，并将缺失 Blob 对应旧证据标为 Stale。
- 公共 GitHub URL 已打通知识库 UI -> 受保护 API -> 固定无凭证 GitHub API ->
  增量 Blob -> 共用安全解析与 Draft Fact 的窄端到端链路。
- 相同公共仓库 HEAD 重复检查不读取 Tree/Blob；单 Blob 改变时其余文档按 Git Blob SHA 复用，
  并将旧证据标为 Stale。
- App 模式本地 Mock、迁移、同步/Webhook、DTO 脱敏和 UI 已完成；真实 App Gate 只约束启用该模式的部署。
- Fine-grained PAT 已打通知识库 UI -> 受保护 API -> 固定 GitHub API -> 加密凭证 -> 明确仓库选择 ->
  共用后台同步/安全解析/不可变快照/Draft Fact 的窄端到端链路。
- PAT 只接受 `github_pat_`，密文 AAD 绑定用户和连接；API、审计与 Job 不含明文。主动撤销或
  GitHub 401 会删除密文、取消仓库选择并停止后续同步。
- Phase 5D 完整 Gate 已通过；真实 GitHub PAT 仅保留为部署者自愿执行的人工只读 Gate，不进入 CI、日志或仓库。
- 上游既存全量 ESLint 债务继续单独跟踪，不通过放宽规则或无关批量修改掩盖。

自动化证据（2026-07-17）：

- `pnpm test`：40 个测试文件、191 个测试通过；上传入口聚焦测试覆盖认证、Origin、流式请求上限、幂等、新 Revision、Stale Evidence、Secret 与正文不落库。
- `pnpm test:e2e`：7 个真实 Chromium 场景通过；新增真实目录选择、UI 上传、受保护 API 和租户化 Career Fact 查询，且预热动态 Binding Route 避免开发服务器首次编译影响断言。
- `pnpm test:migration`、一次性真实 PostgreSQL 临时容器 `pnpm test:integration`、`pnpm type-check`、`pnpm spec:check` 和 `pnpm build` 通过。
- Phase 5B 新增/修改 TypeScript 文件通过聚焦 ESLint；全量 ESLint 仍受上游既存债务约束。
- 私有 `MyUnityResume` 浏览器上传适配器只读检查：108 个上传文件、38 个忽略文件、19 个选中文档、46 条事实、142 条证据、445 条声明；聚合 Revision `sha256:bb1dbd6e2dc95a5b89efce2de58050a4ea52e68ddbcec99f97104154cb3c6335`，无警告代码且未输出个人正文。

Phase 5C 公共 URL 自动化证据（2026-07-17）：

- `pnpm test`：43 个测试文件、219 个测试通过；其中公共 URL/无凭证 Client/导入服务/路由
  聚焦测试为 4 个文件、32 个测试。
- `pnpm test:e2e`：7 个真实 Chromium 场景通过；知识库页面显示公共 URL 入口，且受保护的
  `GET /api/sources/github-public` 返回当前用户来源列表。
- `pnpm test:migration`、一次性 PostgreSQL 18 临时容器 `pnpm test:integration`、`pnpm type-check`、
  `pnpm spec:check` 和 `pnpm build` 通过。
- Phase 5C 新增/修改 TypeScript 文件通过聚焦 ESLint；构建和 E2E 产物验收后已清理，
  未修改生产安装 `/home/ubuntu/apps/JadeAI`。

Phase 5D Fine-grained PAT 自动化证据（2026-07-17）：

- `pnpm test`：46 个测试文件、232 个测试通过；PAT/加密/Client/Service/同步/Route 聚焦测试为
  6 个文件、32 个测试，包含既有 LLM 密文 `profileId` AAD 升级兼容回归。
- `pnpm test:e2e`：7 个真实 Chromium 场景通过；知识库页面显示 PAT 入口，提交后立即清空
  密码输入框，并验证 `localStorage`/`sessionStorage` 不含令牌。
- `pnpm test:migration`、一次性 PostgreSQL 18 临时容器 `pnpm test:integration`、`pnpm type-check`、
  `pnpm spec:check` 和 `pnpm build` 通过。
- Phase 5D 新增/修改 TypeScript 文件通过聚焦 ESLint。全量 ESLint 仍有上游既存的
  1211 个错误和 64 个警告，未放宽规则或批量修改无关模板代码。
- 生产安装 `/home/ubuntu/apps/JadeAI` 未修改；真实 Fine-grained PAT 不进入自动化环境，部署后由
  用户本人在 UI 中一次性提交即可完成可选人工 Gate。

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

### 用户反馈闭环（2026-07-21）

- [x] `RES-002`：PDF 导出改为优先嵌入 `public/fonts/NotoSansSC-*.otf`，并强制覆盖模板 `Inter` 内联字体；
  服务器 `pdftotext` 可抽取中文正文，字体 `emb=yes`。DOCX 中文继续使用 East Asia 字体 `Microsoft YaHei`。
- 生产验收：`http://43.138.159.58:3000` 登录后导出定向简历 PDF/DOCX，中文正文可抽取。

### 用户反馈闭环（2026-07-21 · JD-003）

- [x] 新增确定性 JD↔事实匹配矩阵：`strong` / `partial` / `gap` / `conflict`，输出支持事实、缺口、禁止声明冲突与推荐事实。
- [x] `GET/POST /api/jd-sources/{id}/match` 租户隔离同步返回矩阵；未确认 JD 与无批准事实 fail closed。
- [x] `/zh/jd` 已确认卡片提供“匹配分析”入口；定向简历生成自动注入匹配矩阵摘要。

### 用户反馈闭环（2026-07-21 · Change Set / AI 入口）

- [x] Change Set 支持显式拒绝：`POST /api/resumes/{id}/change-sets/{changeSetId}/reject`，审阅面板提供“拒绝提案”。
- [x] 旧 `/api/ai/generate-resume` 不再直接写库；改为基于已批准事实生成 Change Set，返回 `reviewRequired`。
- [ ] `/api/ai/translate` 覆盖模式迁移到 Change Set 仍待完成。

### Phase 6A 进展：文本 JD 结构化

- [x] 新增租户隔离的 `jd_sources`、`jd_requirements` 及 SQLite/PostgreSQL 迁移。
- [x] 文本规范化、每用户内容哈希去重、LLM 结构化提取和不可信数据边界。
- [x] JD Requirement 审核、修正、确认 API 与 `/[locale]/jd` UI。
- [x] 重新解析或编辑自动撤销确认；只有 `confirmed` 状态可供后续阶段使用。
- [x] 单元/Repository 验收覆盖去重、来源定位、租户隔离、审核与确认门禁。
- [x] 真实浏览器 E2E 覆盖保存、人工修正、确认状态和租户 API。
- [x] 生产部署验收：`8783d06` 已部署至 `http://43.138.159.58:3000`，未登录访问根路径会跳转至账号登录页；认证 API、JD 工作区、SQLite 迁移和公网监听验收通过。
- [ ] Phase 6B：PDF、DOCX 安全导入（图片 Phase 6B.1 已完成）。
- [x] Phase 6C.1：Approved Fact + confirmed JD 约束定向 ResumePatch；支持从事实库新建或复制基准，
  生成独立 Targeted Resume 并进入 Change Set 审阅。
- [x] Phase 6C.2：strong/partial/gap/conflict 显式匹配矩阵、缺口分析和人工调整。

### 用户反馈闭环（2026-07-18）

- [x] `KB-002`：待审队列改为紧凑卡片，详细证据按需展开，支持全选及批量批准/拒绝。
- [x] `KB-002` / `AI-001`：工作台和知识库显式提供“从已批准知识生成简历”，结果进入 Change Set 审阅而不直接写入。
- [x] `JD-002` Phase 6B.1：上传 PNG/JPEG/WebP，完成 MIME/Magic/尺寸/像素门禁、Vision 能力校验、识别及人工复核。

### 用户反馈闭环（2026-07-19）

- [x] 页面登录重定向与个人 API 鉴权解耦；`AUTH_REQUIRED=false` 时允许访问页面，但不匿名暴露租户数据。
- [x] 未登录工作区显示稳定登录提示，桌面、移动端和工作区 Header 均提供明确登录入口。
- [x] 登录入口保留当前 locale 和 callback URL，避免 `/login` 无语言前缀导致入口失效。

### 用户反馈闭环（2026-07-20）

- [x] 已确认 JD 卡片提供“生成定向简历”入口，可选择从 Approved Fact 新建或复制已有简历。
- [x] 新增 `baseline | targeted | general-copy` 类型、父简历和目标 JD 关系及 SQLite/PostgreSQL 迁移。
- [x] 定向生成同时加载 Approved Evidence 和目标 JD Requirement 白名单，AI 输出进入可审核 Change Set。
- [x] 未确认 JD、跨租户基准、无 Approved Fact、Provider 失败均 fail closed；失败不保留空壳。
- [x] 应用定向 Change Set 后基准简历内容与版本保持不变。

自动化证据（2026-07-20）：

- `pnpm test`：58 个测试文件、277 个测试通过；覆盖定向克隆、双引用策略、应用后基准不变、
  租户边界、确认门禁、无事实门禁和 Provider 失败回收。
- `pnpm test:e2e`：9 个真实 Chromium 场景通过；覆盖已确认 JD 的定向入口、对话框和不覆盖基准提示。
- `pnpm type-check`、`pnpm spec:check`、`pnpm test:migration`、一次性 PostgreSQL 18
  `pnpm test:integration` 和 `pnpm build` 通过；新增/修改 TypeScript/TSX 文件通过聚焦 ESLint。
- 全量 ESLint 仍受上游既存约 1210 个错误和 64 个警告阻断；本次未放宽规则或批量修改无关模板代码。

自动化证据（2026-07-18）：

- `pnpm test`：55 个测试文件、260 个测试通过；覆盖批量审核原子性/租户隔离、Approved Fact
  生成 Change Set、图片格式/Magic/解码/尺寸门禁、Vision 绑定和图片 JD 路由。
- `pnpm test:e2e`：9 个真实 Chromium 场景通过；知识库入口、生成对话框、目录导入后的全选批量批准，
  以及 JD 图片控件和格式约束均有浏览器断言。
- 新增/修改 TypeScript/TSX 文件通过聚焦 ESLint；全量 ESLint 仍有上游既存的
  1210 个错误和 64 个警告，未放宽规则或批量修改无关模板代码。
- `pnpm type-check`、`pnpm spec:check`、`pnpm test:migration`、一次性 PostgreSQL 18
  `pnpm test:integration` 和 `pnpm build` 全部通过。

### 用户反馈闭环（2026-07-19）

- [x] `KB-002`：将事实审核从堆叠卡片改为固定高度滚动表格 + 右侧详情工作台，支持搜索、
  类型/状态筛选、当前可见 Draft 全选和批量审核。
- [x] `KB-002`：单条及批量审核改为本地原位更新；审核后保留当前行、详情和滚动上下文，
  不自动重新请求并重排队列，用户可主动应用筛选条件收起已处理项。
- [x] `JD-002`：图片进入模型前完成自动方向修正、白底展平、元数据移除、最长边 4096
  像素限制及 JPEG 规范化，并移除对 OpenAI 专用 JSON Mode 参数的强依赖。
- [x] `JD-002`：上传区增加 Vision 绑定/档案探测预检和设置入口；Provider 失败映射为可操作的
  稳定错误码并显示请求 ID，服务端诊断不记录密钥、Base URL 或原始响应。

自动化证据（2026-07-19）：

- `pnpm test`：55 个测试文件、263 个测试通过；新增图片规范化、结构化调用兼容性、安全错误
  分类和路由请求 ID 覆盖。
- `pnpm test:e2e`：9 个真实 Chromium 场景通过；新增事实审核不重新拉取列表、审核后行保持
  可见，以及 JD Vision 配置预检入口的浏览器断言。
- `pnpm type-check` 和新增/修改文件聚焦 ESLint 通过；`pnpm spec:check`、生产构建与部署验收
  在本次发布 Gate 中执行。

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
