# 总体架构

## 1. 架构结论

JadeAI Career 采用“模块化单体 Web 应用 + 独立后台 Worker”的自托管架构：

```text
Browser
  |
  v
Next.js Web / Route Handlers
  |-- Auth & Admin
  |-- Resume & Export
  |-- LLM Profiles
  |-- Career Knowledge Base
  |-- Source Integration
  |-- JD & Interview
  |
  +--------------------+
  |                    |
  v                    v
PostgreSQL         Job Queue / Worker
  |                    |
  |                    +--> GitHub API / Webhooks（可选）
  |                    +--> User-selected LLM APIs
  |                    +--> Document parsers
  |
  +--> Object Storage Adapter
       - local filesystem in development
       - S3-compatible storage in production when configured
```

首期不拆分微服务，不引入独立向量数据库。所有领域边界通过 TypeScript 模块、服务接口、
数据库约束和测试隔离，降低自托管复杂度。需要长时间运行、重试或幂等的工作进入 Worker，
HTTP 请求只负责鉴权、参数校验、创建任务和返回状态。

## 2. 上游保留与替换

### 2.1 直接保留

- Next.js、React、next-intl、Zustand 和现有编辑器。
- 简历 Section 模型、模板、主题和预览组件。
- PDF、DOCX、HTML、TXT、JSON 导出基础。
- 面试页面、面试轮次和报告基础。
- AI SDK Provider 适配基础，但调用入口必须改为服务端档案解析。

### 2.2 重构

- 认证：Google/指纹切换改为数据库账号和可扩展身份绑定。
- 数据访问：受保护资源从 `findById(id)` 改为 `findOwnedById(userId, id)`。
- LLM 配置：从浏览器 Header 和 `localStorage` 改为服务端加密档案。
- AI 写回：从 Tool 直接写库改为 `ResumePatch -> Diff -> Apply`。
- PostgreSQL Schema：成为生产唯一事实源，不再依赖 SQLite Schema 描述 PG 运行时。
- 数据迁移：应用启动不再吞掉迁移错误或自动创建演示用户。

### 2.3 新增

- 注册、邀请、管理员、数据库会话、审计日志。
- LLM 档案和按功能绑定。
- 简历版本和变更集。
- 职业事实、来源快照和证据关系。
- 分层来源接入：浏览器目录上传、公共 GitHub URL、Fine-grained PAT，以及可选 GitHub App。
- WorkResume v2 上传/仓库导入器、不可变 Revision 和安全扫描。
- JD 文件导入、结构化要求及事实匹配。

## 3. 领域模块

### 3.1 Identity

负责用户、密码凭证、身份绑定、会话、邀请、注册设置、管理员操作和认证审计。

### 3.2 LLM Gateway

负责解密用户档案、Provider 适配、连通性测试、能力探测、出站网络策略、调用审计和
统一错误。业务模块不能接收或记录明文 API Key。

### 3.3 Resume

负责简历、Section、模板、导出、基准/定向关系、版本快照和恢复。所有更新通过用户
作用域仓储执行。

### 3.4 Resume Change

负责 `ResumePatch` 解析、验证、Diff、冲突检测、部分应用、事务写入和版本生成。
LLM 只能提出变更，不能直接访问仓储。

### 3.5 Career Knowledge Base

负责职业事实、别名、证据、审核、合并和失效。检索默认只返回当前用户的
`approved` 事实；用户可显式查看 Draft 和历史版本。

### 3.6 Source Integration

负责上传或外部来源连接、不可变快照、来源文档、解析器版本和同步任务。当前默认入口是
WorkResume schemaVersion 2 浏览器目录上传和无凭证公共 GitHub URL；Fine-grained PAT 是后续
私有仓库 Adapter，GitHub App 作为需要 Webhook/后台同步时的可选高级入口。

### 3.7 JD

负责原始 JD、文件解析、结构化要求、与事实的匹配、缺口和定向简历请求。

### 3.8 Interview

负责面试会话、轮次、消息和报告。读取简历、JD 与事实时必须经过用户作用域服务。

## 4. 请求与任务边界

### 4.1 同步 HTTP 操作

- 登录、退出、当前用户。
- 简历 CRUD 和编辑器保存。
- ResumePatch 预览和应用。
- 事实审核。
- 有界 WorkResume v2 目录上传和确定性导入。
- 有界公共 GitHub URL 导入和手动 HEAD 更新检查。
- LLM 档案 CRUD。
- 查询同步、导入和导出状态。

### 4.2 后台任务

- GitHub 首次或增量同步（PAT/App 按各自能力启用；公共 URL 首切为同步有界导入）。
- 仓库文件解析和事实候选生成。
- PDF/DOCX/图片 JD 解析。
- 大型简历导出。
- 长耗时 LLM 生成和面试报告。
- 定时 GitHub 对账及失败重试。

后台任务载荷只保存资源 ID，不复制明文密钥或完整私有文档。Worker 开始执行后重新加载
资源并重新验证归属和状态。

## 5. 多租户约束

1. 每个用户资源表都直接或间接归属一个 `user_id`。
2. 受保护仓储方法第一个参数必须是 `userId`。
3. Route Handler 不允许把未经作用域验证的资源对象传入 AI、导出或任务队列。
4. Job 创建和执行两个时间点都验证租户。
5. 公共分享只通过独立随机 Token 和显式发布快照读取，不复用内部资源查询。
6. 管理员读取用户内容必须有独立权限、理由和审计；默认管理后台只显示元数据。
7. Phase 8 评估 PostgreSQL RLS 作为纵深防御，不替代应用层作用域。

## 6. 代码组织目标

```text
src/
  app/api/
  modules/
    identity/
    llm/
    resume/
    resume-change/
    knowledge/
    sources/
      upload/
      github/
      work-resume/
    jd/
    interview/
    audit/
  infrastructure/
    db/
    crypto/
    jobs/
    object-storage/
    http-egress/
  shared/
    authz/
    validation/
    errors/
```

不要求一次性搬迁现有目录。每个 Phase 在修改旧功能时逐步迁入，避免大爆炸式重构。

## 7. 基线风险

原始上游基线确认的风险及本 Fork 处理状态：

- [Phase 1 已处理] AI Chat 在读取 Resume 或创建可执行 Tool 前验证所属用户。
- [Phase 1 已处理] 受保护仓储和 Route 改为同时使用 `userId + resourceId`。
- [Phase 2 已处理] LLM API Key 改为服务端加密档案，业务请求不再携带浏览器 Key。
- [Phase 3 核心已处理] AI Chat 已移除可执行写库 Tool，改为 `ResumePatch -> 服务端 Diff -> 用户选择 -> 原子应用 -> 新版本`。
- [Phase 3 发布前续项] 旧 `/api/ai/translate` 覆盖模式及 `/api/ai/generate-resume` 初始生成流程仍需迁移到 Change Set/受控导入边界；在此之前不得宣告“所有 AI 写入均经过 ResumePatch”发布 Gate 已通过。
- [Phase 1 已处理] 数据库迁移 Fail Closed，Demo Seed 仅允许显式开发 Fixture。

## 8. 发布拓扑

推荐首期以 Docker Compose 运行：

- `web`：Next.js。
- `worker`：同镜像、不同启动命令。
- `postgres`：PostgreSQL。
- `object-storage`：开发可用挂载卷；生产可切换 S3-compatible。
- 反向代理与 TLS 由现有自托管环境负责。

生产启动必须在迁移成功后进行。迁移失败、加密主密钥缺失或数据库不可用时应 Fail Closed。
