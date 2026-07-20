# 数据模型

## 1. 原则

- PostgreSQL 是生产事实源。
- UUID 作为业务主键；外部系统 ID 使用独立字段并建立唯一约束。
- 所有用户数据显式保存 `user_id`，避免仅通过多级 Join 推断租户。
- 原始来源快照不可变；解析结果通过版本和状态演进。
- 机密字段不放入通用 JSON；使用专用加密列。
- 时间统一使用带时区时间戳。
- 删除用户资源先进入可恢复状态，真正物理删除由单独任务执行。

## 2. 身份与管理

### `users`

| 字段 | 说明 |
|---|---|
| id | 用户 ID |
| username | 唯一登录名，规范化后唯一 |
| email | 可选，规范化后唯一 |
| display_name | 展示名 |
| avatar_url | 头像 |
| role | `admin` 或 `user` |
| status | `active`、`disabled`、`pending` |
| token_version | 密码修改、禁用时递增 |
| last_login_at | 最近登录 |
| created_at/updated_at/deleted_at | 生命周期 |
| settings | JSON 非机密账号偏好；当前包含 `resumePersonalInfo`，用于新简历 `personal_info` 默认值 |

#### `users.settings.resumePersonalInfo`

不保存密码、Token 或 API Key，仅保存用户主动填写的简历默认个人信息：姓名、目标职位、邮箱、电话、微信、所在地、个人网站、LinkedIn、GitHub、年龄、性别、籍贯、工作年限、学历等。

读取时服务端会用账号显示名和登录邮箱作为空字段默认值；写入时完整替换并按字段长度归一化。新建模板简历、知识库简历、无基准 JD 定向简历和 AI 生成简历使用该值初始化 `personal_info`；导入简历只用它补空，避免覆盖上传文件中已有的姓名或联系方式。

### `password_credentials`

- `user_id` 唯一外键。
- `password_hash`。
- `password_changed_at`。
- 不保存可逆密码或密码提示。

### `auth_identities`

- `user_id`。
- `provider_type`，如 `google`、`github-login`。
- `provider_subject`。
- `verified_at` 和最小必要元数据。
- `(provider_type, provider_subject)` 唯一。

GitHub 登录身份不等于 GitHub App 安装授权。

### `sessions`

- 随机不透明 Session Token 的哈希。
- `user_id`、`token_version`、到期时间、最近使用时间。
- 可选设备名称、IP 前缀和 User-Agent 摘要。

### 其他

- `invitations`：邀请码哈希、使用次数、到期和创建者。
- `verification_tokens`：邮箱验证、密码重置等一次性 Token 哈希。
- `system_settings`：注册开关等非秘密设置。
- `audit_events`：操作者、动作、目标、结果、请求关联 ID 和脱敏元数据。

## 3. LLM

### `llm_profiles`

| 字段 | 说明 |
|---|---|
| id/user_id | 档案及所属用户 |
| name | 用户自定义名称 |
| provider | OpenAI-compatible、Anthropic、Gemini 等 |
| base_url | 规范化地址 |
| model_name | 模型 |
| encrypted_api_key | AES-GCM 密文 |
| key_iv/key_tag/key_version | 解密元数据 |
| capabilities | JSON：json、tools、vision 等探测结果 |
| status | active、invalid、disabled、untested |
| last_tested_at | 最近测试 |

### `llm_feature_bindings`

- `user_id`。
- `feature`：`resume`、`jd`、`vision`、`interview`。
- `llm_profile_id`。
- 每个用户每种 Feature 唯一。

业务日志仅记录档案 ID、Provider、Model、耗时和 Token 统计，不记录 API Key。

## 4. 来源与同步

### `source_connections`

来源连接的统一父记录：

- `id/user_id`。
- `provider`，当前为 `github`（GitHub App）或 `github-pat`；仅用于需要远程凭证/授权的
  连接，浏览器上传和无凭证公共 URL 不伪造连接记录。
- `status`、`last_synced_at`、`last_error_code`。

### `github_connection_states`

- `user_id/source_connection_id`。
- 一次性随机 State 的 SHA-256 哈希、受限 Return Path、到期和消费时间。
- 明文 State 只返回给浏览器，不写入数据库。

### `github_installations`

- `source_connection_id`。
- GitHub `installation_id`、Account ID 和 Account Login。
- 安装权限摘要。
- 不保存 installation access token。

### `github_pat_credentials`

- `user_id/source_connection_id`，每个 PAT 连接唯一且显式归属租户。
- 用户自定义 Label、GitHub Account ID 和 Account Login。
- `encrypted_token/token_iv/token_tag/key_version` 保存 AES-256-GCM 密文和版本元数据。
- 加密 AAD 绑定用户 ID、连接 ID 与 `jadeai.github-fine-grained-pat.v1` Scope，密文不能跨用户
  或跨连接复用。
- 列表查询、API DTO、审计和 Job 不选择或返回密文列；解密只发生在固定 GitHub API 出站边界。
- 主动撤销或 GitHub 返回 401 时物理删除凭证行，并取消该连接下的仓库选择。

### `source_repositories`

- `user_id/source_type`；当前支持 `local-workresume`、`uploaded-workresume`、`github-public`、
  `github-pat`、`github`。
- `source_connection_id` 对本地、浏览器上传和无凭证公共 GitHub 为空，GitHub App 同步时
  关联 Installation 连接，PAT 同步时关联加密凭证连接。
- 外部不可变 Repository ID、`full_name`、默认分支。
- 是否被用户选中、最近 HEAD SHA 和最近同步时间。
- `(user_id, source_type, external_repository_id)` 唯一；本地来源使用稳定内容寻址 ID，不保存本机绝对路径。
- 浏览器上传首切每用户使用一个逻辑 `primary` 来源；再次上传更新展示名和最后 Revision，
  不覆盖历史快照。
- 公共 GitHub 按 GitHub 不可变 Repository ID 去重，保存规范 `full_name`、默认分支和
  最近导入 Commit，不保存凭证。

### `source_snapshots`

- `user_id/source_repository_id`。
- 不可变 Revision、树摘要、父快照、创建时间。兼容期复用 `commit_sha/tree_sha` 物理列：
  GitHub 保存 Commit SHA，浏览器上传保存规范化文档集合的 64 位 SHA-256。
- `(source_repository_id, commit_sha, parser_id, parser_version)` 唯一；解析器升级可对相同
  Revision 形成新的不可变解析快照。
- 状态：pending、processing、ready、failed。
- 后续在来源模式稳定后迁移为显式 `revision_kind + revision_id`；兼容字段在完成双写、
  回填和回滚验证前保留。

### `source_documents`

- `user_id/source_snapshot_id`。
- 相对路径、Blob/规范化正文 SHA-256、内容哈希、MIME、大小。
- 对象存储位置或受控文本内容。
- 解析状态、解析器 ID 和解析器版本。
- `security_findings` 保存脱敏风险代码；`llm_eligible` 决定文档能否进入模型上下文。
- `(source_snapshot_id, path)` 唯一。

### `sync_jobs` 和 `webhook_deliveries`

- Job 保存触发类型、状态、尝试次数、`repository + commit + parser` 幂等键、目标 Commit、
  错误代码、重试时间和请求关联 ID。
- Webhook Delivery ID 唯一，保存事件类型、Payload 哈希、Installation/Repository ID、必要
  Commit/Ref 和处理状态；验签失败在任何数据库写入前拒绝。
- 不保存完整 Webhook Payload、Installation Access Token、GitHub App 私钥或 PAT 明文；PAT Job
  只保存连接和仓库 ID。
- 浏览器上传是同步 HTTP 导入，不创建伪造的远程 `sync_job`；它通过请求上限、用户限流和
  `(source, revision, parser)` 唯一约束获得有界与幂等语义。
- 公共 GitHub URL 首切同样是同步有界 HTTP 导入；它先比较默认分支 HEAD，再依靠
  `(source, commit, parser)` 唯一约束幂等，不与 PAT/App 的后台 Job 混用。

## 5. 职业知识库

### `career_facts`

| 字段 | 说明 |
|---|---|
| id/user_id | 事实及所属用户 |
| fact_type | profile、employment、project、skill、education、certificate、achievement |
| canonical_key | 去重和合并键 |
| title/summary | 人可读内容 |
| structured_data | 按 fact_type 校验的 JSON |
| status | draft、approved、rejected、superseded |
| confidence | 0 至 1，仅用于提示，不代替审核 |
| content_hash | 规范化事实内容哈希，用于幂等和版本判断 |
| supersedes_fact_id/superseded_by_fact_id | 新旧事实双向版本关系 |
| created_by | import、ai、user |
| approved_by/approved_at | 审核记录 |
| source_parser_id/source_parser_version | 创建该事实的解析器身份 |

### `career_fact_evidence`

- `career_fact_id`。
- 必须关联 `source_document_id`，用户手工输入也需要先形成受控来源文档。
- 不可变来源 Revision（兼容列名仍为 Commit SHA）、路径、行区间或 JSON Pointer。
- 引用内容哈希和简短证据摘要。
- 解析器 ID、版本和 `stale` 状态。

同一个事实可有多个证据；相同来源定位可分别支撑多个事实，但每条关联均保留独立租户归属。

### `career_fact_claims`

- 保存 `allowed` 与 `forbidden` 两类陈述、规范化文本和内容哈希。
- Approved Fact 的 allowed claim 可进入 ResumePatch 提示词；任何未 supersede 事实的 forbidden claim 都参与阻断夸大陈述。

### `career_fact_relations`

- 保存事实间显式关系；当前关系类型为 `merged-from`。
- 合并先创建可审核 Draft，只有该 Draft 获批后才将来源事实标记为 superseded。

### `fact_review_events`

记录编辑前后、批准、拒绝、合并和失效操作。事实审核不可通过覆盖原记录来抹除历史。

## 6. 简历与变更

保留 `resumes` 和 `resume_sections` 的基本概念，并新增：

### `resume_versions`

- `user_id/resume_id`。
- 单调递增 `version_number`。
- 完整规范化快照或内容寻址对象。
- 来源：manual、ai-change-set、restore、import。
- 创建者和创建时间。

### `resume_change_sets`

- `user_id/resume_id/base_version_id`。
- 状态：proposed、validated、stale、partially_applied、applied、rejected、failed。
- LLM Profile、Model、Prompt 模板版本和请求关联 ID。
- 摘要、警告和验证结果。

### `resume_change_operations`

- `change_set_id`、稳定 Operation ID 和排序。
- 操作类型、目标 Section/Item、前置哈希、值。
- Evidence IDs、JD Requirement IDs、理由和置信度。
- 是否被用户选中、应用结果和错误码。

### `resume_fact_links`

记录正式简历字段或 Item 与职业事实的关系。导出时不显示内部证据，但用于追踪和再生成。

### 基准和定向关系

`resumes` 新增：

- `kind`：baseline、targeted、general-copy。
- `parent_resume_id`。
- `target_jd_source_id`。

## 7. JD

### `jd_sources`

- `user_id`、输入类型 text/pdf/docx/image。
- 标题、公司、岗位名、原始对象位置和内容哈希。
- 解析状态、解析器版本和用户修订后的规范文本。

### `jd_requirements`

- `jd_source_id`。
- requirement_type：responsibility、hard_skill、soft_skill、experience、education、preferred。
- 文本、规范化术语、重要度、是否硬性。
- 原文位置。

### `jd_fact_matches`

- `user_id/jd_requirement_id/career_fact_id`。
- match_level：strong、partial、gap、conflict。
- 理由、证据和模型/规则版本。

## 8. 面试

保留现有会话、轮次、消息和报告表，但必须：

- 在每个表直接或通过不可变父项保存并验证 `user_id`。
- 会话引用 `resume_version_id` 而不是只引用可变简历。
- 可选引用 `jd_source_id`。
- 报告记录生成模型和模板版本。

## 9. 关键唯一约束

- `users(lower(username))` 唯一。
- 非空 `users(lower(email))` 唯一。
- `auth_identities(provider_type, provider_subject)` 唯一。
- `source_snapshots(source_repository_id, commit_sha, parser_id, parser_version)` 唯一。
- `source_documents(source_snapshot_id, path)` 唯一。
- `webhook_deliveries(delivery_id)` 唯一。
- `resume_versions(resume_id, version_number)` 唯一。
- `llm_feature_bindings(user_id, feature)` 唯一。

## 10. 保留和删除

- 被 GitHub 新 Commit 或上传新 SHA-256 替代的快照不立即删除，以保持证据可验证。
- 用户可删除连接并选择保留或清除已审核事实。
- 删除 LLM 档案立即清除密文并使绑定失效。
- 删除账号采用可恢复期，期满后异步物理删除用户内容。
- 审计记录按配置保留，但不得保留明文秘密或完整私有内容。
