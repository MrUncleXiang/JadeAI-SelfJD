# Fine-grained PAT 私有仓库接入

Fine-grained PAT 是 JadeAI Career 默认的私有 GitHub 仓库入口，不需要部署者创建 GitHub App、
OAuth App、Callback 或 Webhook。用户使用自己的 GitHub 账号创建最小权限令牌，在登录后一次性
提交并明确选择允许同步的仓库。

## 1. 部署前配置

服务端必须配置版本化加密密钥。该 Keyring 同时保护用户 LLM API Key 和 Fine-grained PAT：

```dotenv
LLM_ENCRYPTION_KEYS={"1":"<base64-encoded-32-byte-key>"}
LLM_ENCRYPTION_ACTIVE_KEY_VERSION=1
```

生成新密钥：

```bash
openssl rand -base64 32
```

轮换时先加入新版本并切换 Active Version，保留旧版本直到对应密文全部完成重加密。密钥只放在
部署 Secret 或未跟踪的 `.env.local`，不要写入数据库、Git、Issue、聊天或日志。

数据库迁移会创建 `github_pat_credentials`。生产启动前按正常流程执行已提交的 SQLite 或
PostgreSQL 迁移。

## 2. 用户创建令牌

在 GitHub 创建 **Fine-grained personal access token**，建议：

- 设置清晰名称和尽可能短的有效期；
- Resource owner 选择实际持有职业信息仓库的账号或组织；
- Repository access 只选择需要导入的仓库；
- Repository permissions 仅授予 `Contents: Read-only`；`Metadata: Read-only` 保持 GitHub
  要求的只读权限；
- 不授予写入、Administration、Actions、Issues、Pull Requests、Secrets 或其他无关权限。

组织策略可能要求管理员批准 Fine-grained PAT。JadeAI Career 不接受 Classic PAT（`ghp_`）。

## 3. 用户连接和同步

1. 登录 JadeAI Career，进入 `/<locale>/knowledge`。
2. 在 Fine-grained PAT 卡片中填写可选 Label，并粘贴令牌。
3. 提交后令牌输入框立即清空；服务端校验 GitHub 账号和可访问仓库后只保存密文。
4. 点击管理仓库，显式选择最多 100 个未归档、未禁用仓库。
5. 对选中仓库执行首次同步或手动“检查更新”。
6. 确认新内容进入不可变 Commit 快照并形成待审核 Draft Fact。

令牌不会通过连接列表 API 返回，也不会进入浏览器持久化存储、同步 Job、审计元数据或 LLM
Prompt。服务端只在向固定 `https://api.github.com` 发起只读请求前解密。

## 4. 定时更新检查

每 15 分钟运行统一对账命令；它同时处理 PAT 和已启用的 GitHub App 仓库：

```bash
cd /path/to/jadeai-career
corepack pnpm github:reconcile
```

示例 cron：

```cron
*/15 * * * * cd /path/to/jadeai-career && corepack pnpm github:reconcile >> /var/log/jadeai-github-reconcile.log 2>&1
```

相同 Commit 使用统一幂等键，不重复创建 Job 或快照；新 Commit 只重新下载变化 Blob。限流和
短暂网络错误按稳定错误码与退避时间处理。

## 5. 撤销、过期与恢复

- 用户在 JadeAI Career 中撤销连接时，系统立即删除 PAT 密文并取消全部仓库选择。
- GitHub 对已有连接返回 401 时，系统按撤销处理，删除密文并停止后续同步。
- 权限不足会把连接标记为错误；用户应在 GitHub 修正权限或创建新 Fine-grained PAT 连接。
- GitHub 中主动撤销或令牌到期后，不需要也不能从 JadeAI Career 取回旧令牌。
- 既有不可变快照和已导入事实默认保留；连接撤销只停止远程读取，不静默删除职业知识。

## 6. 自动化验收

```bash
corepack pnpm vitest run \
  src/lib/github/pat-token.test.ts \
  src/lib/github/client.test.ts \
  src/lib/github/pat-service.test.ts \
  src/lib/github/sync.test.ts \
  src/app/api/github/pat-connections/route.test.ts
```

验收覆盖格式拒绝、加密 AAD、固定 API Origin、响应脱敏、租户隔离、仓库选择、统一同步、明文
扫描和 401 自动撤销。真实 GitHub PAT 只用于部署者自愿执行的人工只读 Gate，不进入 CI。
