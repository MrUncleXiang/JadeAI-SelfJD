<div align="center">

# JadeAI

**AI 驱动的智能简历生成器**

拖拽编辑、实时 AI 优化、50 套专业模板、多格式导出，轻松打造高质量简历。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed)](https://hub.docker.com/r/twwch/jadeai)

[English](./README.md)

</div>

---

> **二开状态：** 当前 JadeAI Career 分支已实现账号密码、租户隔离、用户级加密 LLM 档案、
> 需用户确认的 AI 简历变更、职业事实库、浏览器上传、公共 GitHub URL 导入和加密
> Fine-grained PAT 私有仓库同步。GitHub App 保留为可选高级模式，只有启用该模式时才需要
> 执行真实安装 Gate。上游公开 Docker 镜像不包含这些二开改动。

## 交流群

扫码加入交流群，获取使用帮助与最新动态：

[![Linux.do](https://img.shields.io/badge/Linux.do-社区-blue)](https://linux.do/)


加入飞书群

![lark-chat](images/lark.png)


---

## 最近更新

### v0.3.4 · 主题色系统与配色切换
- 引入语义化 `--brand-*` CSS token，下线全站 60+ 文件硬编码 `pink-*`
- 用户菜单新增主题色切换器，三套预设：**薄荷**（默认）、**经典蓝**、**玫粉**
- SSR 安全的防闪烁初始化；老版本 `localStorage` 值自动迁移
- 简历主题编辑器新增「薄荷」预设
- 导出通道（PDF / HTML / DOCX）统一读取 `src/lib/brand-constants.ts`

### v0.3.3 · 移动端体验 & 面试报告稳定性
- 模板预览及预览/分享页新增移动端底部操作栏
- 修复移动端滚动：画布/预览根节点改用 `h-full`
- 面试报告生成稳定性提升

### v0.3.2 · 运行时环境变量
- 移除所有 `NEXT_PUBLIC_*` 构建时变量，改为运行时读取

### v0.3.1 · 认证运行时开关
- `NEXT_PUBLIC_AUTH_ENABLED` 改为运行时变量 `AUTH_ENABLED`

---

## 截图展示

| 模板画廊 | 简历编辑器 |
|:---:|:---:|
| ![模板画廊](images/template-list.png) | ![简历编辑器](images/resume-edit.png) |

| AI 填充简历 | AI 图片简历解析 |
|:---:|:---:|
| ![AI 填充简历](images/AI%20填充简历.gif) | ![AI 图片简历解析](images/图片简历解析.gif) |

| AI 优化 | AI 语法检查 |
|:---:|:---:|
| ![AI 优化](images/ai%20优化.png) | ![AI 语法检查](images/AI%20语法检查.png) |

| 语法一键修复 | JD 匹配分析 |
|:---:|:---:|
| ![语法一键修复](images/AI%20语法检查一键修复.png) | ![JD 匹配分析](images/JD%20匹配分析.png) |

| 多格式导出 | 创建分享链接 |
|:---:|:---:|
| ![多格式导出](images/多项导出.png) | ![创建分享链接](images/创建分享链接.png) |

| 简历分享页 | AI 职业照生成 |
|:---:|:---:|
| ![简历分享页](images/简历分享页.png) | ![AI 职业照生成](images/职业照生成.png) |

| 二维码模块 |
|:---:|
| ![二维码模块](images/二维码.png) |

| 新建面试 | 模拟面试 |
|:---:|:---:|
| ![新建面试](images/新建面试.png) | ![模拟面试](images/模拟面试.png) |

| 面试列表 | 面试报告 |
|:---:|:---:|
| ![面试列表](images/面试列表.png) | ![面试报告](images/面试报告.png) |

## 部署视频

在 Bilibili 观看完整部署教程：

[![部署视频](https://i0.hdslb.com/bfs/archive/deployment-preview.jpg)](https://www.bilibili.com/video/BV1h7wQzSEYe/)

> [前往 Bilibili 观看 →](https://www.bilibili.com/video/BV1h7wQzSEYe/)

## 功能特性

### 简历编辑

- **拖拽编辑器** — 可视化拖拽排列简历模块与条目
- **行内编辑** — 点击任意字段，直接在画布上编辑
- **50 套专业模板** — 经典、现代、极简、创意、ATS 友好、时间线、北欧风、瑞士风等多种风格
- **主题定制** — 颜色、字体、间距、页边距实时预览调整
- **撤销 / 重做** — 完整编辑历史（最多 50 步）
- **自动保存** — 可配置保存间隔（0.3s–5s），支持手动保存
- **Markdown 支持** — 在文本字段中使用 Markdown 语法排版内容（例如 `**加粗**` 可显示**粗体文字**）

### Markdown 格式支持

以下简历模块支持 Markdown 语法：

| 模块 | 支持字段 |
|------|---------|
| 个人简介（Summary） | 正文内容 |
| 工作经历 | 描述、亮点（Highlights） |
| 教育背景 | 亮点（Highlights） |
| 项目经历 | 描述、亮点（Highlights） |
| 自定义模块 | 描述 |
| 语言能力 | 描述 |
| GitHub | 描述 |

**支持的语法：**

```
**加粗文字**    → 粗体
`代码文字`      → 行内代码
- 列表项        → 无序列表
```

> 技能、证书、个人信息等字段暂不支持 Markdown。

### AI 能力

- **AI 聊天助手** — 编辑器内集成对话式 AI，支持多会话和持久化历史
- **AI 一键生成简历** — 输入职位、经验、技能，自动生成完整简历
- **简历解析** — 上传已有 PDF 或图片，AI 自动提取全部内容
- **JD 匹配分析** — 对比简历与职位描述：关键词匹配、ATS 评分、改进建议
- **求职信生成** — 基于简历和 JD 的 AI 定制求职信，可选语气（正式 / 友好 / 自信）
- **语法与写作检查** — 检测弱动词、模糊描述和语法问题，返回质量评分
- **多语言翻译** — 支持 10 种语言互译，保留专业术语原文
- **灵活 AI 供应商** — 支持 OpenAI、Anthropic 及自定义 API 端点；用户在应用内自行配置密钥

### 模拟面试

- **JD 岗位面试模拟** — 粘贴 JD，AI 按顺序扮演不同面试官进行模拟面试
- **6 种预设面试官** — HR 面、技术面、场景面、行为面、项目深挖、Leader 面，各有独特性格和提问风格
- **自定义面试官** — 创建自定义面试官，设定考察维度和风格
- **智能追问** — AI 根据回答质量自适应追问，回答不到位会深入追问
- **面试控制** — 跳过问题、请求提示、标记复习、暂停/继续
- **详细报告** — 逐题评分、能力雷达图、改进建议与推荐资源
- **历史对比** — 追踪评分趋势和能力维度变化
- **报告导出** — 支持 PDF 和 Markdown 格式导出

### 导出与分享

- **多格式导出** — PDF（Puppeteer + Chromium）、智能一页 PDF（自动适配单页）、DOCX、HTML、TXT、JSON
- **JSON 导入** — 导入之前导出的 JSON 文件还原或创建简历；编辑器内覆盖当前简历，仪表盘创建新简历
- **链接分享** — 基于 Token 的分享链接，支持密码保护
- **浏览统计** — 追踪分享简历的查看次数

### 简历管理

- **多简历仪表盘** — 网格和列表视图、搜索、排序（按日期、名称）
- **JSON 导入创建** — 在仪表盘直接通过 JSON 文件创建新简历
- **复制与重命名** — 快捷简历管理操作
- **新手引导** — 交互式分步引导，帮助新用户快速上手

### 其他

- **双语界面** — 完整的中文（zh）和英文（en）界面
- **暗色模式** — 浅色、深色、跟随系统三种主题
- **账号认证** — 用户名/密码、数据库会话、邀请注册和管理员用户管理
- **双数据库** — SQLite（默认，零配置）或 PostgreSQL

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, shadcn/ui, Radix UI |
| 拖拽 | @dnd-kit |
| 状态管理 | Zustand |
| 数据库 | Drizzle ORM (SQLite / PostgreSQL) |
| 认证 | 项目内账号领域服务 + 不透明数据库 Session |
| AI | Vercel AI SDK v6 + OpenAI / Anthropic |
| PDF | Puppeteer Core + @sparticuz/chromium |
| 国际化 | next-intl |
| 数据校验 | Zod v4 |

## 快速开始

### Docker 部署

二开镜像将在发布 Gate 完成后提供。请勿使用上游 `twwch/jadeai:latest` 验证本分支功能，
该镜像不包含账号、管理员及后续 GitHub/知识库改动。当前阶段使用下方本地开发方式。

### 本地开发

#### 环境要求

- Node.js 20.9+
- pnpm 9+

#### 安装

```bash
git clone https://github.com/twwch/JadeAI.git
cd JadeAI

pnpm install
cp .env.example .env.local
```

#### 配置环境变量

编辑 `.env.local`：

```bash
# 数据库（默认 SQLite，无需额外配置）
DB_TYPE=sqlite

# 账号认证（本分支默认启用）
AUTH_ENABLED=true
REGISTRATION_MODE=closed
SESSION_TTL_DAYS=30
AUTH_URL=http://localhost:3000
AUTH_COOKIE_SECURE=true
ENABLE_FINGERPRINT_AUTH=false

# 用户保存加密 LLM 档案或 GitHub PAT 连接前必须配置
LLM_ENCRYPTION_KEYS={"1":"replace-with-base64-32-byte-key"}
LLM_ENCRYPTION_ACTIVE_KEY_VERSION=1
```

可使用 `openssl rand -base64 32` 生成加密密钥。登录用户可在 **设置 > AI** 中维护多个
OpenAI-compatible、Anthropic 或 Gemini 档案，并分别绑定到简历、JD、图片理解和面试功能。
同一版本化 Keyring 也用于保护 Fine-grained GitHub PAT。API Key 和 PAT 均由服务端加密保存，
不会随业务请求 Header 传递或通过列表 API 返回。

查看 `.env.example` 了解所有可用选项。

#### 初始化数据库并启动

```bash
# 数据库适配器首次使用时自动执行已提交迁移。
# 首个管理员密码通过 stdin 输入，不进入 shell 历史或进程参数。
read -s JADE_PASSWORD
printf %s "$JADE_PASSWORD" | pnpm auth:bootstrap-admin -- --username admin
unset JADE_PASSWORD

# 启动开发服务器
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_TYPE` | 否 | `sqlite` | 数据库类型：`sqlite` 或 `postgresql` |
| `DATABASE_URL` | PostgreSQL 时 | — | PostgreSQL 连接字符串 |
| `SQLITE_PATH` | 否 | `./data/jade.db` | SQLite 数据库文件路径 |
| `AUTH_ENABLED` | 否 | `true` | 账号认证；生产环境始终 Fail Closed，本地显式设为 `false` 才可进入兼容路径 |
| `AUTH_REQUIRED` | 否 | `false` | 设为 `true` 时个人工作区页面会强制跳转登录；否则页面保持可访问并显示明确登录提示 |
| `REGISTRATION_MODE` | 否 | `closed` | 初始注册模式：`closed`、`invite` 或 `open` |
| `SESSION_TTL_DAYS` | 否 | `30` | Session 有效期，限制在 1–90 天 |
| `AUTH_URL` | standalone 公网部署时 | — | 浏览器访问服务的精确 Origin，用于认证状态变更的同源校验 |
| `AUTH_COOKIE_SECURE` | 否 | 生产环境为 `true` | 仅临时直连 HTTP 部署可显式设为 `false`；正式环境应使用 HTTPS |
| `PUBLIC_LANDING_PAGE` | 否 | `true` | 仅在 `AUTH_REQUIRED=true` 时生效；设为 `false` 可同时保护首页 |
| `TRUST_PROXY_HEADERS` | 否 | `false` | 信任代理写入的客户端 IP Header；仅在反向代理会清除伪造 Header 时启用 |
| `ENABLE_FINGERPRINT_AUTH` | 否 | `false` | 仅本地开发可显式启用的旧指纹兼容模式 |
| `SEED_DEMO_DATA` | 否 | `false` | 显式开发 Fixture；生产环境禁止启用 |
| `LLM_ENCRYPTION_KEYS` | 使用加密用户秘密时 | — | 用于用户 LLM API Key 和 Fine-grained PAT 的版本化 32 字节 AES 密钥 |
| `LLM_ENCRYPTION_ACTIVE_KEY_VERSION` | 使用加密用户秘密时 | — | 新密文写入使用的密钥版本 |
| `GITHUB_APP_ID` | 可选 GitHub App 模式 | — | GitHub App 数字 ID |
| `GITHUB_APP_SLUG` | 可选 GitHub App 模式 | — | 用于构造安装地址的 GitHub App Slug |
| `GITHUB_APP_PRIVATE_KEY` | 可选 GitHub App 模式 | — | 只通过部署 Secret 提供的 PEM 私钥 |
| `GITHUB_WEBHOOK_SECRET` | 可选 GitHub App 模式 | — | 校验 Webhook 原始请求体的 Secret |
| `APP_NAME` | 否 | `JadeAI` | 应用显示名称 |
| `DEFAULT_LOCALE` | 否 | `zh` | 默认语言：`zh` 或 `en` |

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（Turbopack） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | 运行 ESLint 检查 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm test` | 运行单元和 Route 测试 |
| `pnpm test:migration` | 重放 SQLite 空库与旧库迁移 |
| `pnpm test:integration` | 对显式标记的本地测试库执行 PostgreSQL 破坏性验收 |
| `pnpm db:generate` | 生成 Drizzle 迁移文件（SQLite） |
| `pnpm db:generate:pg` | 生成 Drizzle 迁移文件（PostgreSQL） |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:studio` | 打开 Drizzle Studio（数据库 GUI） |
| `pnpm db:seed` | 填充示例数据 |
| `pnpm auth:bootstrap-admin` | 通过 stdin 创建首个管理员 |
| `pnpm github:reconcile` | 检查已选择 GitHub 仓库并处理到期同步任务 |
| `pnpm spec:check` | 校验需求、OpenAPI 追踪和自动验收规格 |

## 项目结构

```
src/
├── app/                        # Next.js App Router
│   ├── [locale]/               # 国际化路由 (/zh/..., /en/...)
│   │   ├── dashboard/          # 简历列表与管理
│   │   ├── editor/[id]/        # 简历编辑器
│   │   ├── preview/[id]/       # 全屏预览
│   │   ├── templates/          # 模板画廊
│   │   └── share/[token]/      # 公开分享简历查看
│   └── api/
│       ├── ai/                 # AI 接口
│       │   ├── chat/           #   流式对话 + 工具调用
│       │   ├── generate-resume/#   AI 生成简历
│       │   ├── jd-analysis/    #   JD 匹配分析
│       │   ├── grammar-check/  #   语法与写作检查
│       │   ├── cover-letter/   #   求职信生成
│       │   ├── translate/      #   简历翻译
│       │   └── models/         #   可用 AI 模型列表
│       ├── resume/             # 简历 CRUD、导出、解析、分享
│       ├── share/              # 公开分享访问
│       ├── user/               # 用户信息与设置
│       ├── auth/               # 注册、登录和退出 API
│       ├── admin/              # 管理员用户、邀请和注册策略 API
│       └── me/                 # 当前账号与密码 API
├── components/
│   ├── ui/                     # shadcn/ui 基础组件
│   ├── editor/                 # 编辑器画布、区块、字段、弹窗
│   ├── ai/                     # AI 对话面板与气泡
│   ├── preview/templates/      # 50 套简历模板
│   ├── dashboard/              # 仪表盘卡片、网格、弹窗
│   └── layout/                 # 头部、主题、语言切换
├── lib/
│   ├── db/                     # Schema、仓库、迁移、适配器
│   ├── auth/                   # 认证配置
│   └── ai/                     # AI 提示词、工具、模型配置
├── hooks/                      # 自定义 React Hooks（7 个）
├── stores/                     # Zustand 状态仓库（简历、编辑器、设置、UI、引导）
└── types/                      # TypeScript 类型定义
```

## 模板列表

JadeAI 内置 **50 套专业设计模板**，覆盖多种风格和行业需求：

<details>
<summary>查看全部 50 套模板</summary>

| # | 模板 | # | 模板 | # | 模板 |
|---|------|---|------|---|------|
| 1 | Classic | 18 | Clean | 35 | Material |
| 2 | Modern | 19 | Bold | 36 | Medical |
| 3 | Minimal | 20 | Timeline | 37 | Luxe |
| 4 | Professional | 21 | Nordic | 38 | Retro |
| 5 | Two-Column | 22 | Gradient | 39 | Card |
| 6 | ATS | 23 | Magazine | 40 | Rose |
| 7 | Academic | 24 | Corporate | 41 | Teacher |
| 8 | Creative | 25 | Consultant | 42 | Coder |
| 9 | Elegant | 26 | Swiss | 43 | Zigzag |
| 10 | Executive | 27 | Metro | 44 | Neon |
| 11 | Developer | 28 | Architect | 45 | Scientist |
| 12 | Designer | 29 | Japanese | 46 | Blocks |
| 13 | Startup | 30 | Artistic | 47 | Ribbon |
| 14 | Formal | 31 | Sidebar | 48 | Engineer |
| 15 | Infographic | 32 | Finance | 49 | Watercolor |
| 16 | Compact | 33 | Berlin | 50 | Mosaic |
| 17 | Euro | 34 | Legal | | |

</details>

## API 参考

<details>
<summary>查看全部 API 端点</summary>

### 简历

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/resume` | 获取当前用户的简历列表 |
| `POST` | `/api/resume` | 创建新简历 |
| `GET` | `/api/resume/[id]` | 获取简历详情（含所有模块） |
| `PUT` | `/api/resume/[id]` | 更新简历元信息或模块 |
| `DELETE` | `/api/resume/[id]` | 删除简历 |
| `POST` | `/api/resume/[id]/duplicate` | 复制简历 |
| `GET` | `/api/resume/[id]/export` | 导出简历（pdf、docx、html、txt、json） |
| `POST` | `/api/resume/parse` | 解析上传的 PDF 或图片简历 |
| `POST` | `/api/resume/[id]/share` | 创建分享链接 |
| `GET` | `/api/resume/[id]/share` | 获取分享设置 |
| `DELETE` | `/api/resume/[id]/share` | 取消分享 |

### 分享

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/share/[token]` | 访问公开分享的简历 |

### AI

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/ai/chat` | 流式 AI 对话（带简历上下文） |
| `GET` | `/api/ai/chat/sessions` | 获取简历的对话会话列表 |
| `POST` | `/api/ai/chat/sessions` | 创建新对话会话 |
| `GET` | `/api/ai/chat/sessions/[id]` | 获取会话的分页消息 |
| `DELETE` | `/api/ai/chat/sessions/[id]` | 删除对话会话 |
| `POST` | `/api/ai/generate-resume` | AI 生成简历 |
| `POST` | `/api/ai/jd-analysis` | JD 匹配分析 |
| `POST` | `/api/ai/grammar-check` | 语法与写作检查 |
| `POST` | `/api/ai/cover-letter` | 生成求职信 |
| `POST` | `/api/ai/translate` | 翻译简历内容 |
| `GET` | `/api/ai/models` | 获取可用 AI 模型列表 |

### 用户

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/user` | 获取当前用户信息 |
| `PUT` | `/api/user` | 更新用户信息 |
| `GET` | `/api/user/settings` | 获取用户设置 |
| `PUT` | `/api/user/settings` | 更新用户设置 |

</details>

## 参与贡献

欢迎贡献代码！请按照以下步骤：

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交更改：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feat/your-feature`
5. 提交 Pull Request

## 常见问题

<details>
<summary><b>AI 配置是如何工作的？</b></summary>

登录用户可在 **设置 > AI** 中维护多个 OpenAI-compatible、Anthropic 或 Gemini 档案。
API Key 使用版本化 AES-256-GCM Keyring 在服务端加密。系统会一次性检测旧版 JadeAI
浏览器 Key，并且只在档案和功能绑定全部迁移成功后清除旧 `localStorage` 数据。

</details>

<details>
<summary><b>可以在 SQLite 和 PostgreSQL 之间切换吗？</b></summary>

可以。通过 `DB_TYPE` 环境变量设置为 `sqlite` 或 `postgresql`。SQLite 是默认选项，零配置即可使用。使用 PostgreSQL 时需额外设置 `DATABASE_URL`。注意：数据不会在两种数据库之间自动迁移。

</details>

<details>
<summary><b>账号认证如何工作？</b></summary>

用户名/密码认证默认启用，浏览器只持有 `HttpOnly` 的不透明 Session Cookie，数据库只保存 Token 哈希。个人 API 在生产环境始终校验账号会话；页面跳转由 `AUTH_REQUIRED` 独立控制：`false` 时不强制跳转，而是在工作区内显示登录提示，`true` 时跳转登录。只有本地兼容测试同时设置 `AUTH_ENABLED=false` 和 `ENABLE_FINGERPRINT_AUTH=true` 时才启用旧指纹流程。

</details>

<details>
<summary><b>PDF 导出是如何实现的？</b></summary>

PDF 导出使用 Puppeteer Core + @sparticuz/chromium。50 套模板各有独立的服务端导出处理器，将简历渲染为高保真 PDF。同时支持 DOCX、HTML、TXT 和 JSON 格式导出。

</details>

## Star History

<a href="https://www.star-history.com/?repos=LingyiChen-AI%2FJadeAI&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=LingyiChen-AI/JadeAI&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=LingyiChen-AI/JadeAI&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=LingyiChen-AI/JadeAI&type=date&legend=top-left" />
 </picture>
</a>

## 许可证

[Apache License 2.0](LICENSE)
