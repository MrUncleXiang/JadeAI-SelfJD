# 威胁模型

版本：0.1
适用范围：账号、LLM、简历、GitHub、职业知识库、JD、导出和面试。

## 1. 资产

- 用户账号、密码哈希、Session 和身份绑定。
- 用户 LLM API Key 与模型配置。
- GitHub App 私钥、Webhook Secret 和 Installation 元数据。
- 私有仓库内容、Commit 快照和解析出的职业事实。
- 简历、版本、JD、面试消息和报告。
- 管理员权限、审计日志和加密主密钥。

## 2. 信任边界

1. 浏览器与 Next.js 服务端。
2. Next.js 服务端与 PostgreSQL。
3. Web 服务与 Worker。
4. 系统与用户配置的 LLM BaseURL。
5. 系统与 GitHub API/Webhook。
6. 系统与上传文件、仓库文件及其解析器。
7. 内部证据与对外导出文件。

仓库、JD、简历导入、LLM 输出、Webhook 载荷和浏览器输入都属于不可信数据。

## 3. 主要威胁与控制

| 威胁 | 影响 | 强制控制 | 验收 |
|---|---|---|---|
| 跨租户直接对象引用 | 读取或修改其他用户简历 | 用户作用域仓储、执行前二次验证 | AUTH-005 |
| AI Chat 越权 Resume ID | LLM 读取或写入他人简历 | 调用 LLM 前验证 Resume 所有权 | AUTH-005、AI-001 |
| 管理员越权读取正文 | 内部隐私泄露 | 管理后台默认只显示元数据，支持访问需理由与审计 | AUTH-003、OPS-001 |
| 密码暴力破解 | 账号接管 | 参数化 scrypt、统一错误、数据库限流、Session 轮换 | AUTH-001、SEC-001 |
| Session 盗用和固定 | 账号接管 | HttpOnly Cookie、登录旋转、Token Version、CSRF | AUTH-004、SEC-001 |
| LLM Key 泄露 | 费用和数据风险 | 服务端 AES-GCM、脱敏日志、客户端不持久化 | LLM-002、SEC-001 |
| BaseURL SSRF | 访问内网或云元数据 | DNS/IP 校验、实际请求 IP Pinning、拒绝重定向、管理员 Allowlist | LLM-005 |
| 恶意 LLM Provider | 收集上传内容 | UI 明示目标 Provider，按 Feature 最小上下文 | LLM-003、LLM-004 |
| GitHub App 权限过大 | 私有仓库泄露或写入 | 只读 Contents、选择仓库、短期 Token | GH-001 |
| GitHub Callback 劫持或开放重定向 | 把安装绑定到错误用户或钓鱼跳转 | State 只存哈希、10 分钟一次性消费、绑定当前 Session、回跳路径 Allowlist | GH-001 |
| Installation Token 泄露 | 私有仓库被持续读取 | Token 按任务生成且不持久化、不进入 DTO/审计/日志 | GH-001、GH-005 |
| Webhook 伪造或重放 | 伪同步和任务耗尽 | 一 MiB 请求上限、HMAC 验签、Delivery ID 与 Payload Hash 冲突检查 | GH-003 |
| 仓库 Prompt Injection | 绕过规则或泄露秘密 | 数据边界、无工具解析、Schema 与证据验证 | GH-005 |
| 仓库 Secret 进入数据库或 LLM | 凭证泄露 | Tree 路径阻断、正文 Secret Scan、秘密正文不落库、必需文档命中则拒绝快照 | GH-005 |
| 路径穿越和解压炸弹 | 文件覆盖、资源耗尽 | Magic 校验、路径规范化、资源限制 | JD-002、SEC-002 |
| 恶意 PDF/DOCX | 代码执行 | 不执行宏/脚本、受限 Worker、库更新策略 | JD-002 |
| LLM 幻觉经历 | 简历造假 | Approved Fact、Forbidden Claim、人工应用 | AI-003 |
| 部分写入 | 简历损坏 | 事务应用、版本快照、冲突哈希 | AI-002、RES-003 |
| 内部证据被导出 | 公司或隐私信息泄露 | 发布视图、导出扫描、黄金测试 | SEC-002 |
| 日志泄露私有内容 | 长期信息泄露 | 结构化脱敏日志、保留策略 | OPS-001 |
| 迁移失败继续启动 | 数据不一致 | 迁移 Fail Closed、干净库重放 | OPS-002 |

## 4. LLM 出站策略

默认：

- 只允许 HTTPS。
- 解析域名后阻止环回、私网、链路本地、保留和云元数据地址。
- 每次实际请求重新解析并校验，只连接本次校验通过的固定 IP。
- 拒绝所有 Provider 重定向，避免未经验证的第二跳。
- 禁止 URL 中携带 Username/Password。
- 限制连接和响应超时；模型列表在读取前限制响应大小。
- 发布前的 Provider Adapter 继续统一响应大小和进程级并发配额。

自托管用户确需局域网模型时，由管理员在系统配置中添加精确 Host/CIDR Allowlist，并记录
审计。普通用户不能自行绕过。

## 5. 加密

- LLM API Key 使用随机 IV 的 AES-256-GCM。
- 数据库保存 Ciphertext、IV、Authentication Tag 和 Key Version。
- 主密钥仅来自部署 Secret，不进入数据库或 Git。
- 支持新写入使用新 Key Version，后台逐步重加密旧记录。
- GitHub App 私钥和 Webhook Secret 使用部署 Secret 管理。
- 密钥解密只发生在发起外部请求的服务端边界。

## 6. Prompt Injection 控制

1. 来源内容被包装为带来源 ID 的不可执行数据。
2. Prompt 中的系统指令、任务和来源文本使用不可混淆的边界。
3. 不把完整仓库或无关文件发送给模型。
4. LLM 不拥有数据库、Shell、GitHub 或任意 HTTP Tool。
5. 输出只接受固定 Schema。
6. 所有 ID 重新按当前用户校验。
7. 所有正式陈述经过证据和 Forbidden Claim 检查。

## 7. 隐私与保留

- 默认不把真实 `MyUnityResume` 内容放入公开仓库或 CI。
- CI 使用合成且去标识化 Fixture。
- 原始 LLM 输出按最短必要时间保留，可配置关闭。
- 用户撤销 GitHub App Installation 或仓库授权后不能继续拉取仓库。
- 后续连接删除功能必须允许用户分别选择删除来源快照或保留已审核事实；Phase 5 尚未提供站内删除入口。
- 分享简历使用独立发布快照，之后内部版本更新不自动暴露。

## 8. 安全门禁

每个发布候选必须通过：

- 跨租户 API、AI、任务、导出和分享测试。
- CSRF、Session 撤销和注册限流测试。
- SSRF 地址、DNS Rebinding 模拟和危险重定向测试。
- Webhook 无签名、错误签名和重放测试。
- Prompt Injection 与恶意仓库 Fixture。
- Zip Slip、压缩炸弹、错误 MIME 和超限上传测试。
- 日志、数据库、浏览器存储和导出物秘密扫描。
- 干净 PostgreSQL 迁移和上一版本升级测试。
