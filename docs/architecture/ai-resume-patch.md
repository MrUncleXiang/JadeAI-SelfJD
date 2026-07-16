# AI 简历变更协议

关联需求：AI-001 至 AI-004、RES-003、KB-002。

## 1. 问题

上游实现允许 LLM Tool 直接调用仓储更新 Section。该模式存在：

- 模型不支持或不稳定支持 Tool Calling 时只返回文字。
- 用户看不到完整变更就被写入数据库。
- 多个 Tool 调用可能只成功一部分。
- 没有稳定基准版本，无法检测并发编辑。
- 修改没有证据和 JD 依据。
- Tool 获取 `resumeId` 后缺少统一租户授权边界。

目标是把“模型建议”和“系统写库”彻底分离。

## 2. 总体流程

```text
User intent
  -> load owned resume version
  -> retrieve approved facts / JD requirements
  -> LLM generates ResumePatch candidate
  -> extract and repair JSON if needed
  -> Zod/JSON Schema validation
  -> domain validation and evidence policy
  -> deterministic diff
  -> persist proposed change set
  -> user selects operations
  -> optimistic concurrency check
  -> transaction apply
  -> create new resume version
```

LLM 进程没有仓储对象，也不执行写库 Tool。

## 3. ResumePatch v1

顶层：

```json
{
  "schemaVersion": 1,
  "resumeId": "resume-id",
  "baseVersionId": "version-id",
  "summary": "针对 Unity 客户端岗位突出性能优化与工程化经验",
  "operations": [],
  "warnings": []
}
```

每个 Operation 通用字段：

- `operationId`：当前变更集内唯一。
- `type`：受控枚举。
- `sectionId`：目标 Section，新增 Section 时可为空。
- `itemId`：目标 Item，按操作需要。
- `expectedHash`：目标修改前规范化内容哈希。
- `reason`：面向用户的修改理由。
- `evidenceIds`：引用的已审核事实或证据。
- `jdRequirementIds`：相关 JD 要求。
- `confidence`：0 至 1。

操作枚举：

- `set_field`
- `add_item`
- `update_item`
- `remove_item`
- `add_section`
- `remove_section`
- `move_section`
- `set_visibility`
- `set_template`

不接受任意 SQL、任意 JSON Patch 路径、脚本或组件代码。

### 示例

```json
{
  "operationId": "op-1",
  "type": "update_item",
  "sectionId": "projects-section",
  "itemId": "project-her",
  "expectedHash": "sha256:old-content",
  "value": {
    "description": "负责 Unity 客户端核心功能开发，并基于现有代码证据描述资源与性能优化。",
    "technologies": ["Unity", "C#"]
  },
  "reason": "匹配 JD 对 Unity 客户端和性能优化的要求",
  "evidenceIds": ["fact-her-client", "evidence-her-audit"],
  "jdRequirementIds": ["jd-req-unity", "jd-req-performance"],
  "confidence": 0.91
}
```

## 4. 分层验证

### 4.1 语法验证

- JSON 可解析。
- `schemaVersion` 支持。
- 顶层和 Operation 使用严格 Schema，拒绝未知危险字段。
- Operation 数量、文本长度和嵌套深度受限。

### 4.2 租户与资源验证

- Resume、Base Version、Section、Item、事实和 JD 均属于当前用户。
- 目标 Resume 不是只读发布快照。
- LLM 返回的 `resumeId` 不可信，服务端以请求上下文为准。

### 4.3 领域验证

- Section 类型与 `value` Schema 匹配。
- 只允许修改公开简历字段。
- GitHub 星数、仓库名等只读外部字段不能由模型伪造。
- `expectedHash` 与当前版本不一致时标记 Stale。
- 删除个人信息或整个主要经历时给出高风险确认。

### 4.4 证据验证

- 自动写入正式简历的新事实必须引用 `approved` Fact。
- 引用 Fact 必须确实包含或支撑所生成的陈述。
- 命中 `forbiddenClaims` 时阻断该 Operation。
- 缺乏证据但属于表达优化时可允许，例如语法和顺序调整。
- 缺乏证据且增加新业绩、规模、职责或技术时必须阻断或要求人工明确确认。

## 5. Diff

Diff 由服务器根据规范化前后内容计算，不信任 LLM 自报的 Before/After。

每个操作展示：

- 修改位置。
- 修改前和修改后。
- 理由。
- 引用事实和证据。
- 关联 JD。
- 风险和置信度。
- 是否存在并发冲突。

用户可：

- 应用单项。
- 全部应用。
- 编辑建议后应用，编辑后的内容重新校验。
- 拒绝单项或整个变更集。

## 6. 原子应用与版本

应用过程使用一个数据库事务：

1. 锁定 Resume 或验证版本号。
2. 重新验证所选 Operation。
3. 检查全部 `expectedHash`。
4. 按顺序应用所选 Operation。
5. 创建新 `resume_version`。
6. 更新 Operation 结果和 Change Set 状态。
7. 写入审计事件。

任意步骤失败则全部回滚。部分应用指用户只选择一部分操作，不是事务中途失败。

恢复旧版本时同样创建新版本，不删除历史。

## 7. 模型兼容策略

调用顺序：

1. 已探测支持 Tool/Structured Output 的档案可使用 Provider 原生结构化能力。
2. 否则使用普通文本生成，要求单一 JSON 对象。
3. 提取 JSON 并进行一次确定性修复。
4. Schema 失败时把精简错误反馈给模型，最多修复两次。
5. 仍失败则保存失败原因，不生成 Change Set，不写数据库。

模型能力只影响“如何得到候选 JSON”，不影响后续领域验证和应用。

## 8. Prompt 输入

输入只包含：

- 当前 Resume Version 的必要字段。
- 用户当前请求。
- 检索出的已审核事实及稳定 ID。
- 相关 JD Requirement 及稳定 ID。
- 允许的 Operation Schema。

不把 API Key、其他用户数据、完整仓库、内部系统日志或无关聊天历史放入 Prompt。
仓库和 JD 片段使用明确的数据边界标签。

## 9. 变更审计

保存：

- Change Set ID、用户、Resume 和 Base Version。
- LLM Profile ID、Provider、Model 和 Prompt 模板版本。
- 原始模型输出的受控加密或脱敏版本，按保留策略删除。
- Schema、领域和证据验证结果。
- 用户选择、编辑和应用结果。

不保存：

- 明文 API Key。
- 不相关的完整私有仓库内容。
- 其他用户上下文。

## 10. 自动验收

- 非 Tool 模型生成合法 JSON 后可以完成 Diff 和应用。
- 模型输出 Markdown Code Fence、双重编码 JSON 时可被受控修复。
- 模型输出 SQL、未知 Operation 或其他用户 Fact ID 时被拒绝。
- Base Version 在预览后被修改时，应用返回 Stale 且不写库。
- 五个操作中只选择两个时，只修改对应字段并生成一个新版本。
- 第三个操作执行失败时，前两个操作也不持久化。
- 命中 WorkResume `forbiddenClaims` 的陈述不可应用。
- 应用后可恢复到旧版本，历史 Change Set 仍可查询。
