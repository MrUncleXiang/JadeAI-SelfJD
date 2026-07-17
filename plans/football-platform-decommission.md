# football-platform 归档退役计划

状态：远端同步已验证；因活动服务依赖而暂不删除
日期：2026-07-17

## 1. 当前证据

- `/` 剩余约 4.0 GiB，使用率 90%。
- 仓库 `/home/ubuntu/footballscoreplatform` 占用约 1.6 GiB。
- Remote：`git@github-footballscoreplatform:MrUncleXiang/footballscoreplatform.git`。
- `master` 工作区干净，本地 HEAD 与 `origin/master` 均为
  `35d7aec12be6c96b583ebf217eaa259ff0fd1b65`。
- `git lfs status` 无待提交、待推送对象。
- `football-mihomo.service` 处于 `active`，其 WorkingDirectory 和配置文件都位于
  `/home/ubuntu/footballscoreplatform/football-platform`。

结论：源码已经同步到远端，但现在直接卸载会破坏正在运行的 Mihomo 服务。当前只删除了
JadeAI 开发目录中可重建的 `.next` 产物，没有删除 football-platform。

## 2. 删除前置 Gate

只有以下步骤全部通过，才允许删除原目录：

1. 在临时目录从 GitHub 全新 Clone，并拉取 Git LFS 对象。
2. 运行项目最小测试/启动检查，证明远端可以恢复源码和必需资产。
3. 盘点 `data`、`backups`、`reports`、运行输出和未跟踪秘密；可重建缓存可丢弃，必须保留的
   数据生成清单及 SHA-256，并迁移到用户指定的私有存储。
4. `.env`、数据库密码等秘密单独迁移到 Secret 管理，不进入 Git、Release 或普通日志。
5. 将 `football-mihomo.service` 的运行目录和配置迁到稳定位置，或由用户明确同意停止并禁用服务。
6. 从新位置启动/重启服务，检查状态、端口和日志；确认没有进程继续打开原目录文件。
7. 再次确认 Git 工作区干净且本地 HEAD 等于远端 HEAD。

## 3. 最终删除步骤

完成前置 Gate 并取得用户对停服/迁移方案的确认后：

```bash
systemctl show football-mihomo.service -p WorkingDirectory -p ExecStart --no-pager
git -C /home/ubuntu/footballscoreplatform status --short
git -C /home/ubuntu/footballscoreplatform rev-parse HEAD
git -C /home/ubuntu/footballscoreplatform rev-parse origin/master
```

确认服务不再依赖原路径后，才删除 `/home/ubuntu/footballscoreplatform`，随后记录释放空间和恢复
Runbook。删除属于不可逆文件系统操作，不在无人值守自动推进中执行。

## 4. 当前动作边界

- 不重复推送已经与 `origin/master` 一致的提交。
- 不把运行数据、备份、报告或秘密强行提交到 GitHub。
- 不停止活动服务。
- 不在恢复演练和服务迁移完成前删除目录。

当前约 4.0 GiB 可用空间足以继续本阶段的聚焦测试与一次构建；如果后续构建再次逼近容量上限，
优先清理可重建缓存和产物，而不是破坏活动服务。
