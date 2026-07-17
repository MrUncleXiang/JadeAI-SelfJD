# ADR-0003：GitHub App 只读同步

状态：Superseded by ADR-0004
日期：2026-07-16

## 背景

用户需要授权系统访问个人私有仓库，并在仓库更新后增量同步。PAT 权限通常更宽、管理
体验较差，普通 OAuth App 也不适合按仓库选择和集中 Webhook 管理。

## 决策

- 使用 GitHub App。
- 只申请 Repository Contents Read-only 和必要 Metadata。
- 用户在安装时选择仓库。
- Installation Access Token 按需生成且不持久化。
- Webhook 优先、定时对账和手动同步补偿。
- 首期同步方向仅为 GitHub 到 JadeAI Career。

## 后果

- 部署者需要创建 GitHub App，并配置 App ID、Private Key、Webhook Secret 和回调地址。
- 本地和 CI 使用 Mock GitHub Server；真实私有仓库 E2E 需要独立测试 Installation。
- 撤销安装后系统停止同步，但历史事实按用户选择保留或删除。
