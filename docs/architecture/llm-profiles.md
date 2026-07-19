# 用户级 LLM 档案

## 1. 目标与当前状态

每个登录用户可维护多个 `Provider + BaseURL + Model + API Key` 档案，并为
`resume`、`jd`、`vision`、`interview` 分别选择默认档案。Phase 2 当前切片已完成：

- API Key 仅在创建或轮换档案时短暂进入服务端，随后以版本化 AES-256-GCM 密文保存。
- 业务 API 不再接受浏览器传入的 `x-api-key`、BaseURL 或 Model 覆盖值。
- 所有业务调用按当前用户和 Feature 在服务端解析档案。
- 设置页支持档案 CRUD、功能绑定、模型列表、能力测试及旧浏览器 Key 迁移。
- OpenAI-compatible、Anthropic 和 Gemini 共用相同的租户、密钥与出站安全边界。

## 2. 服务端数据流

档案写入：

```text
Cookie Session
  -> resolveActor(userId)
  -> validate BaseURL policy
  -> AES-256-GCM encrypt API Key
  -> llm_profiles(user_id scoped)
  -> safe DTO(hasApiKey only)
```

业务调用：

```text
Cookie Session
  -> resolveActor(userId)
  -> resolve feature binding(userId + feature)
  -> load owned profile
  -> decrypt API Key with AAD(userId + profileId)
  -> revalidate BaseURL
  -> guarded provider fetch
  -> selected LLM provider
```

- 所有详情、更新、删除、测试和绑定查询同时携带 `userId` 与资源 ID。
- 数据库保存 Ciphertext、随机 12-byte IV、Authentication Tag 和 Key Version。
- AES-GCM AAD 绑定 `userId + profileId`，复制到其他用户或档案的密文会解密失败。
- API、审计元数据和错误响应均不返回 Key、密文、IV、Tag 或 Provider 原始错误正文。
- 修改 Provider、BaseURL、Model 或 Key 后，旧能力探测结果自动失效。
- 未绑定、已禁用、测试失败、密钥不可解密和出站策略拒绝均返回稳定错误码。

## 3. 部署密钥与轮换

推荐配置版本化 Keyring：

```dotenv
LLM_ENCRYPTION_KEYS={"1":"<base64-32-byte-key>","2":"<base64-32-byte-key>"}
LLM_ENCRYPTION_ACTIVE_KEY_VERSION=2
LLM_REQUEST_TIMEOUT_MS=60000
LLM_VISION_REQUEST_TIMEOUT_MS=180000
```

生成密钥：

```bash
openssl rand -base64 32
```

轮换顺序：

1. 在部署 Secret 中加入新版本，保留所有仍被数据库引用的旧版本。
2. 将 `LLM_ENCRYPTION_ACTIVE_KEY_VERSION` 指向新版本并部署；新写入立即使用新版本。
3. 后续后台任务逐条解密并重加密旧记录，记录成功/失败数量。
4. 确认数据库不再引用旧 `key_version` 且完成备份恢复演练后，才删除旧密钥。

若 Keyring 缺失、格式错误或找不到记录所需版本，系统 Fail Closed，不保存新档案，
也不回退到随机或硬编码密钥。

## 4. BaseURL 与实际请求策略

保存档案时默认仅接受 DNS 解析结果全部为公网地址的 HTTPS URL，并禁止 URL Credential、
Query 和 Fragment。环回、私网、链路本地、保留、文档、组播、云元数据及 IPv4-mapped
IPv6 地址默认拒绝。

运维人员可通过 `LLM_BASE_URL_ALLOWLIST` 配置逗号分隔的精确 Origin 或 CIDR，例如：

```dotenv
LLM_BASE_URL_ALLOWLIST=http://127.0.0.1:11434,10.30.0.0/16
```

普通用户不能通过请求参数修改 Allowlist。每次 Provider 实际请求还会执行以下控制：

1. 重新解析并校验目标地址，避免只信任保存时结果。
2. 仅允许配置 BaseURL 的同 Origin、同路径子树；Provider SDK 添加的 Query 可以保留。
3. 将校验通过的 IP 固定到该请求的 Socket Lookup，降低 DNS Rebinding 风险。
4. 禁止自动重定向，任何 `3xx` 都以 `OUTBOUND_REDIRECT_BLOCKED` 失败。
5. 连接、Header 和 Body 默认使用 `LLM_REQUEST_TIMEOUT_MS`；Vision 功能单独使用
   `LLM_VISION_REQUEST_TIMEOUT_MS`（默认 180 秒），两者都限制在 1 秒至 5 分钟。
6. 模型列表响应在完整分配前限制为 1 MiB，且最多返回 1,000 个模型 ID。

## 5. API

- `GET/POST /api/llm-profiles`
- `PATCH/DELETE /api/llm-profiles/{profileId}`
- `GET /api/llm-bindings`
- `PUT /api/llm-bindings/{resume|jd|vision|interview}`
- `POST /api/llm-profiles/{profileId}/test`
- `GET /api/ai/models?profileId={profileId}`

所有写操作执行 Cookie 鉴权与可信 Origin 检查。档案响应仅以 `hasApiKey: true|false`
表示 Key 是否存在。模型列表和能力测试只接受当前用户拥有的 `profileId`，服务端自行附加
Provider 所需认证 Header。

能力测试依次检查连通性、JSON、Tool Calling 和 Vision，并保存独立布尔结果、耗时与稳定
错误分类：`AUTH_FAILED`、`MODEL_NOT_FOUND`、`RATE_LIMITED`、`TIMEOUT`、
`OUTBOUND_BLOCKED`、`PROVIDER_ERROR`、`INVALID_RESPONSE`、`UNSUPPORTED`。

## 6. 旧浏览器配置迁移

设置页只识别明确的旧键：`jade_api_key`、`jade_provider_configs` 和
`jade_nanobanana_api_key`。迁移按以下事务式顺序执行：

1. 从旧配置创建一个或多个用户档案。
2. 为 `resume`、`jd`、`vision`、`interview` 建立绑定。
3. 重新读取服务端档案和绑定进行确认。
4. 全部成功后才清除旧 `localStorage` Key。
5. 任一步失败时保留浏览器旧 Key，并尽力回滚本轮新建档案。

新的 Settings Store 只持久化无密钥的档案摘要和绑定状态，不再提供客户端 Header 生成器。

## 7. 自动化证据

```bash
pnpm test
pnpm test:migration
pnpm test:integration
pnpm test:e2e
pnpm type-check
pnpm build
```

重点覆盖：

- AES-GCM 随机 IV、AAD 防调换、Key Rotation 和缺失密钥 Fail Closed。
- 跨租户 CRUD、Binding、Resolver、能力测试和删除级联。
- SSRF 地址矩阵、实际请求重新解析、IP Pinning 和重定向拒绝。
- 模型列表服务端认证、响应上限和秘密不回传。
- 能力独立探测及安全错误分类。
- 浏览器旧 Key 迁移、绑定、成功后清除和服务端密文不可见。

当前仍保留的增强项是完整 Mock Provider 浏览器矩阵、进程级并发配额和所有 AI 调用的
统一用量审计；这些不改变本切片已经建立的“密钥不进入浏览器业务请求”安全边界。
