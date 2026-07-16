# GitHub App 授权与同步设计

关联需求：GH-001 至 GH-005、MYR-001、KB-001、KB-002。

## 1. 授权模型

采用 GitHub App：

- 用户在 JadeAI Career 登录后发起安装。
- 用户在 GitHub 页面选择允许访问的账号和仓库。
- 申请 Repository Contents 只读权限。
- Repository Metadata 使用 GitHub App 必需的只读权限。
- 首期不申请写入、Issues、Pull Requests、Actions 或 Secrets 权限。
- 安装 Access Token 按任务实时生成，任务结束后丢弃，不持久化。

GitHub App 的 State、Setup URL 和 Callback 必须绑定当前登录用户及短期一次性 Nonce，
避免安装结果被绑定到错误账号。

## 2. 连接流程

```text
POST /github/connect
  -> create short-lived pending installation state
  -> redirect to GitHub App installation
  -> GitHub setup callback
  -> validate state and installation
  -> list accessible repositories
  -> user confirms selected repositories
  -> enqueue initial sync
```

如果一个 Installation 被多个本系统用户尝试绑定，系统必须显式阻止或进入管理员审核，
不能按 GitHub 登录名自动共享私有仓库。

## 3. 首次同步

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

## 4. 更新检测

采用三层机制：

### 4.1 Webhook 优先

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

### 4.2 定时对账

定期检查选中仓库的默认分支 HEAD SHA，用于补偿 Webhook 丢失、服务停机和权限变化。
使用条件请求缓存元数据；没有变化时不创建新快照。

### 4.3 手动检查

用户可点击“检查更新”。手动任务与 Webhook、定时任务共享相同幂等键，不能并行创建同一
Commit 的多个同步任务。

## 5. 增量解析

- 对比上一个 Ready 快照和新 Commit。
- 未变化 Blob 复用已有文档内容和解析结果。
- 只解析新增或修改文件。
- 删除文件不会立刻删除已批准事实，而是将相关证据标记为 Stale，要求用户复核。
- 文件重命名优先通过 Blob SHA 识别，避免错误地生成全新事实。
- 解析器升级可以针对旧快照创建新的解析运行，但不能修改旧解析记录。

## 6. 路径和内容策略

默认允许：

- `.md`、`.txt`、`.json`、`.yaml`、`.yml`。
- 小型、明确用于证据或 JD 的 `.png`、`.jpg`、`.jpeg`，图片解析由 JD/文档管线处理。

默认忽略：

- `.git`、`node_modules`、`vendor`、构建产物和缓存目录。
- `.env*`、常见密钥文件、证书、SSH Key、数据库和压缩备份。
- 二进制程序、超大文件和无法识别的编码。
- 用户配置的排除 Glob。

同步前后执行秘密检测。命中高风险秘密的文件不进入 LLM 上下文，只保存脱敏告警和定位。

## 7. 不可信内容边界

仓库文件是数据，不是指令：

- 系统 Prompt 明确标记来源边界。
- 解析器不执行仓库脚本、宏、HTML JavaScript 或 Git Hook。
- LLM 上下文只包含任务所需片段和结构化元数据。
- 忽略文件中要求泄露密钥、修改系统规则、访问其他资源或调用工具的文字。
- LLM 输出必须经过领域 Schema、证据关系和租户校验。

## 8. WorkResume v2 适配器

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

适配器必须保留 Commit SHA、路径、JSON Pointer 或 Markdown 行区间、解析器版本和内容哈希。

CI 使用去个人化的合成 WorkResume v2 Fixture。真实 `MyUnityResume` 仅作为本地私有验收
Fixture，不提交到公开二开仓库。

## 9. 状态与错误

连接：

- pending、active、suspended、revoked、error。

同步任务：

- queued、running、retrying、succeeded、failed、cancelled。

常见可读错误：

- installation_revoked
- repository_not_accessible
- permission_changed
- rate_limited
- webhook_signature_invalid
- unsupported_repository_layout
- secret_detected
- parser_validation_failed

内部日志保存错误码和请求关联 ID，不记录 Installation Token 或完整私有文件。

## 10. 自动验收

- 用户只能列出 App 安装中已选择的仓库。
- 同一 Commit 连续同步两次只生成一个快照。
- 修改一个文件后只重新解析该 Blob。
- 重放相同 Delivery ID 不会创建第二个 Job。
- 错误签名 Webhook 不创建任何数据。
- 删除或撤销仓库权限后后续任务停止，旧事实不会被静默删除。
- 恶意 Markdown 中的提示注入不能触发工具、读取密钥或越权修改简历。
- WorkResume v2 Fixture 导入后的事实数量、ID、证据位置和禁止声明与黄金文件一致。
