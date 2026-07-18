# JD 导入、匹配与定向简历

关联需求：JD-001 至 JD-004、AI-001 至 AI-003、RES-002。

## 当前实现状态

Phase 6A 已实现文字 JD 的首个端到端切片；Phase 6B.1 实现单张图片 JD：

- `/zh/jd`、`/en/jd` 支持粘贴、保存、去重、AI 结构化、人工修正和确认。
- `jd_sources` 与 `jd_requirements` 按用户隔离；相同规范文本按用户和 SHA-256 复用。
- AI 提取使用用户绑定到 `jd` Feature 的 LLM 档案，JD 内容以不可信数据边界传入。
- LLM 结果只进入 `needs_review`，用户确认后才进入 `confirmed`。
- 重新解析或编辑会撤销旧确认，防止下游继续使用未审核变更。
- PNG/JPEG/WebP 在服务端校验声明 MIME、Magic Number、尺寸和像素上限后，仅发送给用户
  绑定到 `vision` Feature 且能力探测通过的 LLM。
- Vision 返回规范 JD 文本及结构化 Requirement，结果直接进入 `needs_review`，仍需用户修正和确认。

尚未实现：PDF、DOCX 导入，图片原始二进制的长期对象存储，Requirement 与 Approved Fact 匹配，
以及 Targeted Resume Clone。

## 1. 输入

首期支持：

- 用户粘贴的纯文本。
- UTF-8 TXT 或 Markdown。
- PDF。
- DOCX。
- PNG、JPG、JPEG 图片。

不执行 Office 宏、PDF JavaScript、HTML Script 或上传文件中的任何程序。

## 2. 导入管线

```text
upload/text
  -> permission and quota validation
  -> content type and magic number validation
  -> object storage
  -> safe text extraction / OCR or vision
  -> normalize text
  -> LLM structured extraction
  -> schema validation
  -> user review
  -> jd_source + jd_requirements
```

原始文件和解析文本使用内容哈希去重。解析失败不删除原始上传，用户可重试、切换 LLM
档案或直接编辑规范文本。

## 3. 文件安全

- 扩展名和 Magic Number 必须一致。
- 每用户、每文件和每页数设置限制。
- 解压 DOCX 时限制文件数量、总解压大小和路径穿越。
- PDF 和图片解析在资源受限 Worker 中执行。
- 清理临时文件。
- 不把上传文件名直接作为磁盘路径。
- 对可能包含个人信息的文件使用私有对象存储，不生成公开 URL。

## 4. 结构化 JD

`jd_source`：

- 标题、公司、岗位、地点。
- 原始输入类型、内容哈希和规范文本。
- 用户确认状态。

`jd_requirement`：

- 类型：responsibility、hard_skill、soft_skill、experience、education、preferred。
- 原文。
- 规范术语和别名。
- 必须/优先/一般。
- 重要度。
- 原文页码、段落或字符区间。

LLM 抽取后必须先展示给用户修正。只有已确认 JD 才进入正式定向生成。

## 5. 匹配

匹配按三层执行：

1. 确定性规则：规范术语、别名、时间和明确约束。
2. 结构化事实检索：仅检索当前用户已审核 Fact。
3. LLM 解释：在候选 Fact 范围内给出 strong、partial、gap、conflict。

每个结果包含：

- JD Requirement。
- 匹配 Fact 和 Evidence。
- 匹配级别。
- 可用陈述。
- 禁止夸大项。
- 简历空间建议。

LLM 不得把“学习计划”“兴趣”“接触过”升级成“生产负责”或“精通”。

## 6. 定向简历

输入：

- 已确认 JD。
- 用户选择的基准 Resume Version。
- 已审核职业事实。
- 用户选择的篇幅、语言和模板偏好。

输出不是完整覆盖写入，而是：

1. 创建 Targeted Resume 草稿，记录 `parent_resume_id`。
2. 生成一个或多个 Resume Change Set。
3. 用户查看 Diff 并选择应用。
4. 应用后生成 Targeted Resume Version。

建议变更包括：

- 调整摘要。
- 调整项目和经历顺序。
- 从已审核事实补充项目或技能。
- 删除与目标岗位弱相关且占空间的内容。
- 优化关键词和表达。

不得：

- 修改基准简历。
- 引入没有证据的新职责、数据或技术。
- 把内部证据路径、风险标记或禁止陈述导出。

## 7. 图片理解

图片 JD 优先使用用户绑定到 `vision` Feature 的档案。能力探测不支持 Vision 时：

- 使用部署提供的本地 OCR Adapter；或
- 明确提示用户改用文字、PDF、DOCX；不把图片发送给错误模型。

OCR 文本必须保留页码或图片坐标来源，用户可在结构化前修正识别错误。

Phase 6B.1 的单图管线暂不持久化原始二进制，只保留文件名、MIME、大小、原图哈希、Vision 识别文本和
全图来源定位；请求失败时浏览器保留当前 File 便于重试。在 PDF/DOCX 和私有对象存储一并完成前，
`JD-002` 的总验收状态保持 `partial`。

## 8. 导出门禁

Targeted Resume 导出前检查：

- 所有引用 Fact 仍为 Approved。
- 没有未解决的 Forbidden Claim。
- 没有内部来源路径、Commit 审计备注或 Prompt 内容泄漏。
- PDF 和 DOCX 都能生成。
- 文本抽取结果包含姓名、目标岗位和关键经历。
- 文件打开无损坏，模板没有明显溢出。

## 9. 自动验收

- 相同文件重复上传复用内容对象，不重复解析。
- 伪装扩展名、Zip Slip DOCX 和超限图片被拒绝。
- 图片 LLM 不支持 Vision 时不会发送请求。
- 用户修正 Requirement 后匹配使用修正版。
- Draft Fact 不进入定向简历候选。
- 生成 Targeted Resume 后基准 Resume 版本号和内容不变。
- 导出的 PDF/DOCX 包含已应用内容且不包含 Evidence 路径或 Forbidden Claim。
