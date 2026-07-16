# football-platform 归档退役计划

状态：Blocked from destructive action
日期：2026-07-16

## 1. 当前证据

- 文件系统约 40GB，剩余约 4.9GB，使用率 88%。
- 父仓库：`/home/ubuntu/footballscoreplatform`。
- 项目目录：`/home/ubuntu/footballscoreplatform/football-platform`。
- 父仓库 Remote：
  `git@github-footballscoreplatform:MrUncleXiang/footballscoreplatform.git`。
- 当前分支：`master`，跟踪 `origin/master`。
- 存在未提交的服务代码和测试修改。
- 存在未跟踪 `.codex-tasks` 数据。
- `football-mihomo.service` 仍在运行，并使用项目输出目录。
- 项目包含 `.env`，父目录包含 `.db_password`。
- 主要占用包括 `backups`、`reports`、`data`，不适合直接提交普通 Git。

因此当前不能执行 `rm -rf`、卸载或盲目推送全部目录。

## 2. 目标

在不丢代码、运行数据、备份、秘密和服务恢复能力的前提下：

1. 把应进入 Git 的源代码完整推送远端。
2. 把不应进入 Git 的数据制作加密归档。
3. 证明能够从远端和归档恢复。
4. 迁移或停止依赖本目录的服务。
5. 最后删除本机项目并释放空间。

## 3. 步骤

### A. 代码冻结

- 读取仓库 `AGENTS.md`。
- 保存 `git status`、Remote、Branch 和 HEAD。
- 审查三处已修改代码和未跟踪任务。
- 运行相关测试。
- 新建 `archive/local-decommission-20260716` 分支。
- 提交有效代码；不提交秘密、数据库、备份和生成报告。
- 推送分支和必要 Tag。

### B. 非 Git 数据归档

- 分类 `data`、`backups`、`reports` 和运行输出。
- 确定哪些是可重建缓存，哪些必须保留。
- 对必须保留内容生成文件清单和 SHA-256。
- 制作加密压缩包，上传到用户指定的私有存储或 Release 资产。
- `.env` 和 `.db_password` 单独通过 Secret 管理迁移，不进入 Git 或普通归档日志。

### C. 服务迁移

- 记录 `football-mihomo.service` 的 Unit、启动命令和依赖路径。
- 将 Sidecar 移到稳定运行目录，或明确停止并禁用服务。
- 重启/停止后检查端口、日志和依赖进程。

### D. 恢复演练

- 在临时目录从 GitHub 全新 Clone。
- 恢复必要秘密和数据。
- 运行测试和最小启动 Smoke Test。
- 校验归档 SHA-256。
- 记录恢复命令和结果。

### E. 删除

只有 A 至 D 全部通过并得到用户确认后：

- 停止相关服务和进程。
- 再次检查没有进程打开项目文件。
- 删除原项目目录。
- 检查磁盘释放量。
- 保留恢复 Runbook 和归档清单。

## 4. 当前动作边界

本计划阶段不进行：

- 自动提交未知语义代码。
- 把 `data/backups/reports` 强推 GitHub。
- 上传 `.env`、`.db_password`。
- 停止活动服务。
- 删除目录。

JadeAI Phase 0 文档可在当前空间完成；开始依赖安装和完整构建前，建议至少释放到 10GB
可用空间。
