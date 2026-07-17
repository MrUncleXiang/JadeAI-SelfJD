# ADR-0004：分层个人信息来源接入

状态：Accepted
日期：2026-07-17

## 背景

职业知识库必须在没有 GitHub App 配置时也能使用。用户可能只希望上传一组文件，也可能
连接公开仓库或使用自己创建的细粒度 PAT。GitHub App 能提供最小权限、短期令牌、按仓库
安装和 Webhook，但它不应成为首个可运行版本的部署前置条件。

“OAuth 授权码”不是可持续读取仓库的凭证。它要求部署者先注册 OAuth App，并在回调中用
一次性 Code 换取 Access Token；读取私有仓库时授权范围通常也比细粒度 PAT 或 GitHub App
更宽。因此首期不把 OAuth App 作为仓库来源方案。

## 决策

采用统一的来源导入管线和四种分层入口：

| 模式 | 凭证 | 私有仓库 | 更新方式 | 定位 |
|---|---|---:|---|---|
| 文件或目录上传 | 无 | 不适用 | 用户重新上传 | MVP 必备 |
| 公共 GitHub URL | 无 | 否 | 手动检查 | MVP 必备 |
| Fine-grained PAT | 用户级加密凭证 | 是 | 手动、定时轮询 | MVP 远程私库 |
| GitHub App | Installation 短期令牌 | 是 | 手动、定时、Webhook | 可选高级模式 |

所有入口必须进入同一条受控管线：

```text
resolve immutable revision
  -> normalize and bound paths/content
  -> secret and prompt-injection scan
  -> immutable snapshot
  -> WorkResume/generic parser
  -> Draft career facts
  -> explicit user review
```

GitHub App 的现有只读实现保留并明确标记为可选高级入口；无 `GITHUB_APP_*` 配置时不得
阻断上传、公共 URL 或 PAT。首期不接受 Classic PAT、任意 Git URL、SSH Clone，也不执行
来源中的脚本、Skill、Hook 或构建命令。

## 安全约束

- PAT 仅接受 Fine-grained PAT，服务端加密保存，API、日志、任务参数和 LLM Prompt 不得
  返回明文。
- 公共 URL 只接受规范化的 `https://github.com/{owner}/{repo}`，后端只调用固定 GitHub
  API，不跟随到任意主机。
- 上传只接受带相对路径的白名单文本文件；ZIP 在具备流式解压、Zip Slip、符号链接、
  文件数和解压总量门禁后再启用。
- 相同 Revision 与解析器版本幂等；新内容创建新快照，不覆盖旧证据。
- 上传来源不宣称自动同步；公共 URL 支持手动检查，PAT 支持手动/定时轮询，
  GitHub App 可额外使用 Webhook。

## 影响

- Phase 5 拆为默认可用的来源接入和可选 GitHub App Gate。
- GitHub App 真实安装 E2E 不再阻塞未启用 App 的 MVP 发布。
- 数据模型逐步把 Git 专用的 `commitSha` 表达迁移为通用不可变 Revision；兼容期保留旧字段。
- 实施顺序为 WorkResume v2 文件/目录导入、公共 URL Adapter，再实现 PAT Adapter。

## 实施状态

- WorkResume v2 浏览器目录上传已实现。
- 无凭证公共 GitHub URL 导入与手动 HEAD 检查已实现。
- Fine-grained PAT 私有仓库 Adapter 待实现；GitHub App 仍为可选高级模式。
