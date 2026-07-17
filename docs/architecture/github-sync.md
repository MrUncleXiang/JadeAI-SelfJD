# 个人信息来源与 GitHub 同步设计

关联需求：KB-003、GH-001 至 GH-007、MYR-001、KB-001、KB-002。

## 1. 分层来源模型

| Adapter | 凭证 | Revision | 更新能力 |
|---|---|---|---|
| `uploaded-workresume` | 无 | 规范化文件集合 SHA-256 | 重新上传 |
| `github-public` | 无 | Git Commit SHA | 手动检查 |
| `github-pat` | 加密 Fine-grained PAT | Git Commit SHA | 手动、定时轮询 |
| `github-app` | 按需生成 Installation Token | Git Commit SHA | 手动、定时、Webhook |

统一接口只负责读取不可变 Revision 和文档，不负责执行来源内容：

```ts
interface SourceAdapter {
  resolveRevision(): Promise<SourceRevision>;
  listDocuments(): Promise<SourceEntry[]>;
  readDocument(entry: SourceEntry): Promise<Buffer>;
}
```

所有 Adapter 共用路径规范化、资源上限、秘密检测、提示注入隔离、不可变快照、WorkResume
解析和 Draft Fact 审核。未配置 GitHub App 时，其他三种入口仍可正常工作。

上传首切只接受带相对路径的白名单文件集合，单文件最多 1 MiB、最多 500 个文档、有效正文
总量最多 12 MiB。ZIP 等待流式解压和 Zip Slip/符号链接/压缩炸弹门禁完成后再开放。

公共 URL 只允许 `https://github.com/{owner}/{repo}`，且只调用固定 GitHub API；PAT 仅接受
Fine-grained PAT，并使用与 LLM Key 同等级的服务端版本化加密，任务只传连接 ID。

已实现的公共 URL Adapter 是同步、有界的手动导入：服务端忽略用户提交 URL 的
任何主机派生信息，只向 `https://api.github.com` 发起不含 `Authorization` 的请求，
且禁止跟随重定向。用户再次点击“检查更新”时只先读取默认分支 HEAD；HEAD 未变则
不再读取 Tree 或 Blob。

已实现的 PAT Adapter 只接受 `github_pat_` 前缀的 Fine-grained PAT，不接受 Classic PAT。
用户在知识库页面一次性提交令牌，服务端先通过固定 `https://api.github.com/user` 和
`/user/repos` 校验账号及可访问仓库，再以 AES-256-GCM 加密保存。加密 AAD 绑定用户 ID、
连接 ID 和独立 Secret Scope；浏览器、API DTO、审计元数据和同步 Job 均不返回或携带明文。
用户随后显式选择最多 100 个仓库，手动同步和定时对账与 GitHub App 共用同一条不可变
快照、安全扫描、WorkResume 解析和 Draft Fact 管线。检测到 401 时立即删除密文、撤销连接
并取消仓库选择；用户也可以主动撤销连接。

## 2. 可选 GitHub App 授权模型

启用 GitHub App 时：

- 用户在 JadeAI Career 登录后发起安装。
- 用户在 GitHub 页面选择允许访问的账号和仓库。
- 申请 Repository Contents 只读权限。
- Repository Metadata 使用 GitHub App 必需的只读权限。
- 首期不申请写入、Issues、Pull Requests、Actions 或 Secrets 权限。
- 安装 Access Token 按任务实时生成，任务结束后丢弃，不持久化。

GitHub App 的 State、Setup URL 和 Callback 必须绑定当前登录用户及短期一次性 Nonce，
避免安装结果被绑定到错误账号。

## 3. GitHub App 连接流程

```text
POST /api/github/connect
  -> create short-lived pending installation state
  -> redirect to GitHub App installation
  -> GET /api/github/callback
  -> validate state and installation
  -> list accessible repositories
  -> user confirms selected repositories
  -> user triggers initial sync
```

State 在数据库中只保存 SHA-256 哈希，有效期 10 分钟且仅可消费一次。Callback 只允许回到
`/zh/knowledge` 或 `/en/knowledge`，阻止开放重定向。

如果一个 Installation 被多个本系统用户尝试绑定，系统必须显式阻止或进入管理员审核，
不能按 GitHub 登录名自动共享私有仓库。

## 4. 统一首次同步

每个仓库按以下顺序执行：

1. 获取 Repository 不可变 ID、默认分支和权限。
2. 获取默认分支当前 HEAD Commit SHA 和 Tree SHA。
3. 如果相同 Commit 快照已存在，直接复用。
4. 读取递归 Tree，先按路径、扩展名和大小过滤。
5. 下载允许的 Blob，逐个验证 Git Blob SHA 和内容哈希。
6. 创建不可变 `source_snapshot` 和 `source_document`。
7. 识别适配器。
8. 解析为职业事实候选。
9. 保存为 Draft，并生成可审核差异。
10. 标记快照 Ready，更新仓库最后同步 SHA。

不得在文件下载完成前把仓库标记为同步成功。

## 5. 更新检测

采用三层机制：

### 5.1 GitHub App Webhook

处理：

- `push`
- `installation`
- `installation_repositories`
- Repository 重命名、归档或删除相关事件

所有 Webhook：

- 使用原始请求体校验 `X-Hub-Signature-256`。
- 以 Delivery ID 建立唯一记录。
- 验签失败不入队。
- 重复 Delivery 返回成功但不重复处理。
- Route 只完成验签、最小解析和入队。

### 5.2 PAT/App 定时对账

定期检查选中仓库的默认分支 HEAD SHA，用于补偿 Webhook 丢失、服务停机和权限变化。
当前实现直接比较默认分支 HEAD SHA；没有变化时命中统一幂等键，不创建新 Job 或快照。
部署者每 15 分钟调用 `pnpm github:reconcile`，并处理 GitHub 限流或短暂网络错误产生的到期
重试任务；后续可在不改变幂等语义的前提下增加 ETag。

### 5.3 手动检查

公共 URL、PAT 和 App 用户都可点击“检查更新”。三种模式共享
`repository + revision + parser` 的幂等语义，不能为同一 Commit 生成多个快照。
公共 URL 首切通过 `POST /api/sources/github-public` 同步执行有界导入，不创建
`sync_job`；PAT/App 的手动、Webhook 和定时触发仍通过 Job 幂等键去重。上传来源通过
重新上传检查内容摘要，不伪装成远端自动同步。

## 6. 增量解析

- 对比上一个 Ready 快照和新 Commit。
- 未变化 Blob 复用已有文档内容、内容哈希和安全检查结果，不再次下载。
- 新增或修改 Blob 才重新下载并执行编码、Secret 和 Prompt Injection 检查；WorkResume
  领域解析器仍会对本次选中的完整文档集合做一致性校验，避免混用不完整快照。
- 删除文件不会立刻删除已批准事实，而是将相关证据标记为 Stale，要求用户复核。
- 文件重命名优先通过 Blob SHA 识别，避免错误地生成全新事实。
- 解析器升级可以针对旧快照创建新的解析运行，但不能修改旧解析记录。

## 7. 路径和内容策略

默认允许：

- `.md`、`.txt`、`.json`、`.yaml`、`.yml`。
- 图片、PDF 和 DOCX 留到 Phase 6 的 JD/文档管线，不在 GitHub 职业事实同步中读取。

默认忽略：

- `.git`、`node_modules`、`vendor`、构建产物和缓存目录。
- `.env*`、常见密钥文件、证书、SSH Key、数据库和压缩备份。
- 二进制程序、超大文件和无法识别的编码。
- 用户配置的排除 Glob。

同步前后执行秘密检测。秘密文件按 Tree 元数据直接阻断且不下载；正文命中高风险秘密时不
保存明文，只保存内容哈希、大小和脱敏告警。提示注入文档可保留供人工定位，但
`llm_eligible=false`。WorkResume 必需文档命中正文秘密时返回 `SECRET_DETECTED`，命中提示
注入时返回 `PARSER_VALIDATION_FAILED`；两者都不创建新快照，并保留上一个 Ready 快照。

## 8. 不可信内容边界

仓库和上传文件是数据，不是指令：

- 系统 Prompt 明确标记来源边界。
- 解析器不执行仓库脚本、宏、HTML JavaScript 或 Git Hook。
- LLM 上下文只包含任务所需片段和结构化元数据。
- 忽略文件中要求泄露密钥、修改系统规则、访问其他资源或调用工具的文字。
- LLM 输出必须经过领域 Schema、证据关系和租户校验。

## 9. WorkResume v2 适配器

识别条件：

- 根目录存在 `WorkResume.config.json`。
- `schemaVersion === 2`。
- 配置中的关键路径存在且 JSON Schema 合法。

首期读取：

- `targetRole`、`defaultLanguage`。
- `paths.capabilityPool`。
- `paths.jdTermPool`。
- `paths.jdMapping`。
- 项目证据源和项目简历资产目录中的 Markdown。
- 简历版本只作为来源和历史样例，不自动覆盖系统简历。

映射：

| WorkResume 内容 | 系统目标 |
|---|---|
| 实际技术证据池 | skill/project/achievement facts |
| projectEvidence | career_fact_evidence |
| allowedClaims | 可公开陈述候选 |
| forbiddenClaims | 生成阻断规则 |
| JD 技术术语池 | jd_sources/jd_requirements |
| JD 证据映射 | jd_fact_matches |
| 项目证据 Markdown | source_documents 和证据片段 |
| 简历版本 | 可选导入草稿，不作为事实源 |

适配器必须保留通用 Revision（Git Commit 或上传 SHA-256）、路径、JSON Pointer 或
Markdown 行区间、解析器版本和内容哈希。

CI 使用去个人化的合成 WorkResume v2 Fixture。真实 `MyUnityResume` 仅作为本地私有验收
Fixture，不提交到公开二开仓库。

## 10. 状态与错误

连接：

- pending、active、suspended、revoked、error。

同步任务：

- queued、running、retrying、succeeded、failed、cancelled。

当前稳定错误码：

- `INVALID_REPOSITORY_URL`
- `REPOSITORY_NOT_PUBLIC`
- `INVALID_UPLOAD`
- `UNSAFE_PATH`
- `TOO_MANY_FILES`
- `PAYLOAD_TOO_LARGE`
- `TOO_MANY_ATTEMPTS`
- `IMPORT_CONFLICT`
- `INVALID_PAT_FORMAT`
- `INVALID_PAT`
- `PAT_INSUFFICIENT_PERMISSIONS`
- `PAT_REVOKED`
- `PAT_ENCRYPTION_UNAVAILABLE`
- `CONNECTION_NOT_FOUND`
- `INVALID_REPOSITORY_SELECTION`
- `INSTALLATION_REVOKED`
- `REPOSITORY_INACCESSIBLE`
- `GITHUB_RATE_LIMITED`
- `GITHUB_UNAVAILABLE`
- `INVALID_SIGNATURE`
- `UNSUPPORTED_LAYOUT`
- `SECRET_DETECTED`
- `PARSER_VALIDATION_FAILED`

内部日志保存错误码和请求关联 ID，不记录 Installation Token 或完整私有文件。

## 11. 自动验收

- 未配置 GitHub App 时仍可上传 WorkResume 文件并形成 Draft Fact。
- 相同上传内容重复提交只生成一个快照，新内容生成新快照。
- 公共 GitHub URL 不携带 Authorization Header 且不能请求任意主机。
- 公共 GitHub URL 相同 HEAD 重复检查不读取 Tree/Blob，单一 Blob 变更时只下载变化内容。
- PAT 明文不出现在数据库可读列、API、日志、任务参数或 LLM Prompt。
- 用户只能列出 App 安装中已选择的仓库。
- 同一 Commit 连续同步两次只生成一个快照。
- 修改一个文件后只重新下载并安全检查该 Blob，未变化文档按 Blob SHA 复用。
- 重放相同 Delivery ID 不会创建第二个 Job。
- 错误签名 Webhook 不创建任何数据。
- 删除或撤销仓库权限后后续任务停止，旧事实不会被静默删除。
- 恶意 Markdown 中的提示注入不能触发工具、读取密钥或越权修改简历。
- WorkResume v2 Fixture 导入后的事实数量、ID、证据位置和禁止声明与黄金文件一致。

## 12. 当前与计划入口

| 能力 | 入口 |
|---|---|
| WorkResume 文件/目录上传 | `GET/POST /api/sources/workresume-upload`（已实现） |
| 公共仓库列表/导入/手动检查 | `GET/POST /api/sources/github-public`（已实现） |
| PAT 连接列表/创建 | `GET/POST /api/github/pat-connections`（已实现） |
| PAT 可访问仓库/选择 | `GET/PUT /api/github/pat-connections/{connectionId}/repositories`（已实现） |
| PAT 撤销与密文删除 | `DELETE /api/github/pat-connections/{connectionId}`（已实现） |
| 发起安装 | `POST /api/github/connect` |
| 安装回调 | `GET /api/github/callback` |
| 连接和同步摘要 | `GET /api/github/connections` |
| 可访问仓库 | `GET /api/github/repositories?connectionId=...` |
| 保存仓库选择 | `PUT /api/github/repositories` |
| 首次/手动同步 | `POST /api/github/repositories/{repositoryId}/sync` |
| 作业查询 | `GET /api/github/sync-jobs/{jobId}` |
| Webhook | `POST /api/github/webhooks` |
| 定时补偿 | `pnpm github:reconcile` |

真实 GitHub App 配置和人工 Gate 仅在启用该可选模式时执行，见
`docs/operations/github-app.md`。默认的 PAT 私有仓库入口见
`docs/operations/github-pat.md`。
