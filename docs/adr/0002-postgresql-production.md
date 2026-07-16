# ADR-0002：生产使用 PostgreSQL

状态：Accepted
日期：2026-07-16

## 背景

目标系统需要多用户、并发任务、事务变更、唯一幂等键、审计和未来的行级安全。SQLite
适合个人本地试用，但不适合作为目标生产基线。

## 决策

- PostgreSQL 是生产和完整 CI 的数据库。
- SQLite 只保留为轻量开发选项，不作为功能验收依据。
- PostgreSQL 使用独立的运行时 Schema 和迁移。
- 迁移失败时应用退出，不捕获错误后继续服务。
- 生产空库不自动创建演示用户或简历。

## 后果

- 所有 Phase 的集成测试必须运行 PostgreSQL。
- SQLite 与 PostgreSQL 行为不一致时以 PostgreSQL 为准。
- 数据迁移需要备份、前向验证、回滚说明和干净库重放。
