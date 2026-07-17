# 职业知识库与 WorkResume v2 导入设计

关联需求：`KB-001`、`KB-002`、`KB-003`、`MYR-001`、`AI-003`

## 阶段边界

Phase 4 完成可审计的职业事实库、WorkResume v2 本地只读导入，以及事实对 AI 简历变更
协议的约束。Phase 5B 已在同一仓库、快照和文档抽象上增加浏览器目录上传；它不依赖
GitHub 配置。公共 URL 与 PAT Adapter 后续接入，GitHub App 保留为可选高级同步模式。

## 数据链路

```text
source_repositories
  -> source_snapshots
    -> source_documents
      -> career_fact_evidence
        -> career_facts
          -> career_fact_claims
          -> fact_review_events
```

- **仓库**：表示用户选择的来源，不保存本机绝对路径。本地来源仅保存稳定身份哈希。
- **快照**：固定到一次不可变 Revision；Git 来源使用 Commit，上传来源使用规范化集合
  SHA-256；同一来源、Revision 和解析器版本只解析一次。
- **文档**：保存相对路径、blob/content hash、解析器版本和必要的规范化文本。
- **证据**：将事实关联到不可变 Revision、相对路径和 JSON Pointer 或 Markdown 行号。
- **事实**：规范化的项目、技能、经历等职业信息，具有独立审核状态和版本链。
- **声明**：事实允许使用或禁止使用的表述。
- **审核事件**：追加写审计日志，不以覆盖当前行代替历史记录。

## 事实生命周期

```text
import -> draft -> approved
                -> rejected

approved/rejected --edit--> new draft --approve--> previous superseded
draft/approved facts --merge--> new draft --approve--> source facts superseded
```

导入只创建 `draft`。只有 `approved` 事实可进入 AI 上下文或作为
`ResumePatch` 的证据。修改已审核事实会创建新版本，不会原地篡改已审核内容。
`rejected`、`superseded` 和新的 `draft` 均不能参与简历生成；Rejected 和
Superseded 事实也不能作为合并来源，避免被重新包装后绕过审核结论。

每条可审核事实必须至少有一条证据，证据至少包含：

- Git Commit SHA 或上传集合 SHA-256；
- 仓库内相对路径；
- JSON Pointer 或 Markdown 行号范围；
- 源内容哈希、解析器 ID 和解析器版本。

允许声明只有在所属事实为 `approved` 时才可使用；禁止声明始终作为阻断规则，
用于防止模型在改写时夸大职责、成果或技能。

## WorkResume v2 导入

解析器标识为 `workresume-v2@1`，以 `WorkResume.config.json` 为入口：

1. 校验配置 `schemaVersion = 2`；
2. 读取配置引用的能力池、JD 词库/映射和项目 Markdown；
3. 将能力词条映射为 `skill` 事实；
4. 按能力词条中的 `projectEvidence` 聚合为 `project` 事实；
5. 将 `allowedClaims`、`forbiddenClaims` 映射为事实声明；
6. 为 JSON 字段生成 JSON Pointer 证据，为 Markdown 生成行号证据；
7. 以规范化内容哈希去重，因此相同 commit 的重复导入无副作用。

JD 词库和映射在本阶段作为来源文档留存，不提前建模为职业事实；它们将在 JD
定向简历阶段使用。历史简历版本也不作为事实导入，避免把模型生成内容反向污染
事实库。

## 本地导入安全边界

- 只允许配置文件显式引用的仓库内相对路径；拒绝绝对路径、`..`、NUL 和符号链接；
- 限制单文件和总读取大小，只允许 JSON、Markdown 和纯文本；
- 拒绝常见密钥文件名和二进制内容；
- 不执行仓库内脚本、Skill、Git hook 或任何提示文本；
- 数据库、日志和验收输出均不记录本机绝对路径；
- 对私有 `MyUnityResume` 的只读验收只输出 commit、数量、聚合哈希和错误代码，
  不输出个人事实正文、文件内容或路径。

## 浏览器目录上传

知识库页面优先提供 `POST /api/sources/workresume-upload`：

1. 浏览器以成对的 `paths + files` 上传目录，并携带固定协议版本；
2. 服务端在读取正文前验证登录、可信 Origin、媒体类型、文件数和请求大小；
3. 最多剥离一个共同浏览器顶层目录，使 `WorkResume.config.json` 回到来源根；
4. 拒绝绝对路径、盘符、NUL、`..`、规范化后重复路径、秘密文件名、超限文件、二进制和
   无效 UTF-8；构建目录及不支持扩展名不进入解析或正式存储；
5. 所有候选文档经过 Secret/Prompt Injection 扫描，再交给同一 `workresume-v2@1` 解析器；
6. 只持久化解析器实际选择的干净文档，Revision 为其规范化聚合 SHA-256；
7. 相同 Revision 返回幂等结果；新 Revision 生成父子快照，并把已消失 Blob 对应证据标为
   Stale，等待用户复核。

首切不支持 ZIP、PDF、DOCX 或任意 Markdown 的 LLM 抽取，也不执行脚本、Skill、Hook 或
构建命令。ZIP 只有在流式解压、Zip Slip、符号链接、压缩比、展开总量和条目数门禁完成后
才能开放。

## AI 简历变更约束

创建变更集时，服务端加载当前用户的审核策略：

- 仅把 `approved` 事实、证据 ID 和允许声明送入模型；
- 把禁止声明作为明确的不可生成规则；
- 模型输出引用的证据必须属于当前审核策略；
- 应用变更集前重新加载策略，若事实已被拒绝、替代或删除，则拒绝应用；
- 无审核事实时仍允许非事实型排版变更，但不能凭空新增经历、技能或成果。

## 自动化验收

1. SQLite 与 PostgreSQL 均能从全新库和旧版库迁移；
2. 合成 WorkResume v2 fixture 解析结果与 golden 文件一致；
3. 同一 Commit/上传 SHA-256 连续导入两次，仓库、快照、文档、事实和证据数量不增加；
4. Draft/Rejected/Superseded 事实不会进入 AI prompt，也不能通过证据校验；
5. Approved 事实可被引用，Forbidden Claim 会阻断候选变更；
6. 修改、审核、拒绝和合并均产生可查询的审核事件；
7. 私有仓库只读检查输出通过脱敏测试。
8. 未配置 GitHub App 时，目录上传仍能形成当前用户的不可变快照和 Draft Fact；跨用户
   状态查询为空。
9. 路径穿越、重复路径、秘密正文、提示注入、错误媒体类型和超限请求返回稳定 4xx，且
   数据库和审计事件中不存在被拒绝的明文。
