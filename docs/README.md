# JadeAI Career 二开文档索引

本目录描述 JadeAI Career 的产品范围、目标架构、实施顺序和验收门禁。现有
`ARCHITECTURE.md` 仍用于解释上游 JadeAI，本目录中的文档用于描述本次二开。

## 基线

- 上游仓库：`LingyiChen-AI/JadeAI`
- 上游版本：`v0.4.1`
- 上游提交：`ca38294960e4b6f8a1ba66d0106059fcf97c323c`
- 当前开发分支：`codex/phase-5d-github-pat`
- 生产安装 `/home/ubuntu/apps/JadeAI` 不在本次开发中直接修改

## 产品与需求

- [产品需求文档](product/PRD.md)
- [需求追踪矩阵](product/requirements-matrix.md)

## 架构

- [总体架构](architecture/overview.md)
- [数据模型](architecture/data-model.md)
- [认证与账号](architecture/auth.md)
- [用户级 LLM 档案](architecture/llm-profiles.md)
- [个人信息来源与 GitHub 同步](architecture/github-sync.md)
- [AI 简历变更协议](architecture/ai-resume-patch.md)
- [职业知识库与 WorkResume v2 导入](architecture/career-knowledge-base.md)
- [JD 导入与定向简历](architecture/jd-ingestion.md)
- [威胁模型](security/threat-model.md)
- [OpenAPI 活契约](api/openapi.yaml)
- [Fine-grained PAT 私有仓库接入](operations/github-pat.md)
- [GitHub App 部署与真实验收](operations/github-app.md)
- [PDF/DOCX 导出字体运维](operations/export-fonts.md)

## 决策与执行

- [ADR-0001：以 JadeAI 为主工程](adr/0001-jadeai-fork-as-base.md)
- [ADR-0002：生产使用 PostgreSQL](adr/0002-postgresql-production.md)
- [ADR-0003：GitHub App 只读同步](adr/0003-github-app-read-only.md)
- [ADR-0004：分层个人信息来源接入](adr/0004-layered-source-ingestion.md)
- [分阶段实施计划](../plans/implementation-plan.md)
- [football-platform 归档退役计划](../plans/football-platform-decommission.md)
- [自动化验收矩阵](../acceptance/acceptance-matrix.yaml)

## 规格门禁

运行：

```bash
pnpm spec:check
```

该命令检查需求 ID 唯一性、需求与验收场景映射、范围排除项及关键文档是否齐全。
