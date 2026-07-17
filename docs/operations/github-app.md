# GitHub App 部署与真实验收

本页用于 Phase 5 人工 Gate。应用只做 GitHub 到 JadeAI Career 的只读导入，不要求用户
提供 PAT，也不会把 Installation Access Token 写入数据库。

## 1. 创建测试 GitHub App

在用于测试的 GitHub 账号或组织下创建 GitHub App，配置：

- Homepage URL：JadeAI Career 的 HTTPS 外部地址。
- Setup URL：`https://<jadeai-host>/api/github/callback`。
- Webhook URL：`https://<jadeai-host>/api/github/webhooks`。
- Webhook Secret：至少 16 个字符的随机值。
- Repository permissions：
  - Contents：Read-only。
  - Metadata：Read-only（GitHub App 的必要权限）。
- Subscribe to events：`Push`、`Installation`、`Installation repositories`、`Repository`。
- 安装范围只选择用于验收的测试仓库；不要为了测试授予全部真实私有仓库。

不要启用 Contents Write、Actions、Administration、Issues、Pull Requests 或 Secrets 权限。
如果安装返回任何 `write`/`admin` 权限，服务端会拒绝绑定。

## 2. 配置部署 Secret

复制 `.env.example` 中的 GitHub 配置，并在部署 Secret 管理器或本机未跟踪的 `.env.local`
中填写：

```dotenv
GITHUB_APP_ID=<numeric-app-id>
GITHUB_APP_SLUG=<app-slug>
GITHUB_APP_PRIVATE_KEY=<pem-private-key>
GITHUB_WEBHOOK_SECRET=<random-webhook-secret>
```

私钥可使用真实多行 PEM；如果平台只接受单行值，则把换行写为 `\n`。不要在聊天、Issue、
Commit、截图或测试日志中提供私钥和 Webhook Secret。

## 3. 数据库和定时对账

部署前执行正常 Drizzle 迁移。Webhook 是首选更新通道，同时每 15 分钟运行一次补偿对账：

```bash
cd /path/to/jadeai-career
corepack pnpm github:reconcile
```

例如使用 cron：

```cron
*/15 * * * * cd /path/to/jadeai-career && corepack pnpm github:reconcile >> /var/log/jadeai-github-reconcile.log 2>&1
```

该命令检查选中仓库的默认分支 HEAD，复用 `repository + commit + parser` 幂等键，并处理
已到重试时间的数据库作业。GitHub 限流使用响应时间或五分钟兜底；短暂同步故障在首次
失败后最多自动退避重试两次。日志只输出聚合结果，不输出 Token 或仓库正文。

## 4. 真实验收步骤

1. 用测试用户登录，进入 `/<locale>/knowledge`。
2. 点击“连接 GitHub”，只安装到一个测试私有仓库。
3. 选择包含有效 WorkResume v2 数据的仓库并执行首次同步。
4. 确认生成 Draft Fact，证据能定位 Commit、相对路径、内容哈希和解析器版本。
5. 只修改一个允许文件并 Push；确认 Webhook 只下载变化 Blob。
6. 重放相同 Delivery ID；确认没有第二个 Job/快照。
7. 添加 `.env`、正文测试 Secret 或提示注入测试文件；确认秘密正文不进入数据库或 AI 上下文，
   WorkResume 必需文档命中时同步失败且保留上一个良好快照。
8. 撤销安装或移除仓库；确认连接变为 revoked/仓库取消选择，之后不能继续同步。

真实 Gate 通过前，不把 Phase 5 标记为生产就绪。
