# 用户级 LLM 档案

## 1. 目标与边界

每个登录用户可维护多个 `Provider + BaseURL + Model + API Key` 档案，并为
`resume`、`jd`、`vision`、`interview` 分别选择默认档案。API Key 只进入服务端，
业务 API 最终不得再接受浏览器传入的 `x-api-key`。

本阶段先落地加密存储、租户化 CRUD、Feature Binding 和 BaseURL 保存门禁；Provider
Resolver、能力探测、设置页切换及旧 `localStorage` Key 清理仍属于 Phase 2 后续步骤。

## 2. 服务端数据流

```text
Cookie Session
  -> resolveActor(userId)
  -> validate BaseURL policy
  -> AES-256-GCM encrypt API Key
  -> llm_profiles(user_id scoped)
  -> safe DTO(hasApiKey only)
```

- 所有详情、更新、删除和绑定查询同时携带 `userId` 与资源 ID。
- 数据库保存 Ciphertext、随机 12-byte IV、Authentication Tag 和 Key Version。
- AES-GCM AAD 绑定 `userId + profileId`，复制其他用户或档案的密文会解密失败。
- API、审计元数据和错误响应均不返回 Key、密文、IV 或 Tag。
- 修改 Provider、BaseURL、Model 或 Key 后，旧能力探测结果自动失效。

## 3. 部署密钥与轮换

推荐配置版本化 Keyring：

```dotenv
LLM_ENCRYPTION_KEYS={"1":"<base64-32-byte-key>","2":"<base64-32-byte-key>"}
LLM_ENCRYPTION_ACTIVE_KEY_VERSION=2
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

## 4. BaseURL 出站策略

默认仅接受解析结果全部为公网地址的 HTTPS URL，并禁止 URL Credential、Query 和
Fragment。环回、私网、链路本地、保留、文档、组播及云元数据地址默认拒绝。

运维人员可通过 `LLM_BASE_URL_ALLOWLIST` 配置逗号分隔的精确 Origin 或 CIDR，例如：

```dotenv
LLM_BASE_URL_ALLOWLIST=http://127.0.0.1:11434,10.30.0.0/16
```

普通用户不能通过请求参数修改 Allowlist。保存档案时执行语法、DNS 和地址分类检查；
Provider Resolver 完成时还必须在每次实际请求及每次重定向前重新校验，不能只依赖保存时
的结果。

## 5. API

- `GET/POST /api/llm-profiles`
- `PATCH/DELETE /api/llm-profiles/{profileId}`
- `GET /api/llm-bindings`
- `PUT /api/llm-bindings/{resume|jd|vision|interview}`
- `POST /api/llm-profiles/{profileId}/test`：契约已定义，能力探测尚待实现

所有写操作执行 Cookie 鉴权与可信 Origin 检查。档案响应仅以 `hasApiKey: true|false`
表示 Key 是否存在。

## 6. 当前自动化证据

```bash
pnpm vitest run src/lib/llm/encryption.test.ts \
  src/lib/llm/outbound-url.test.ts \
  src/app/api/llm-profiles/llm-profile-routes.test.ts
pnpm test:migration
```

覆盖 AES-GCM 随机 IV、AAD 防调换、Key Rotation、缺失密钥 Fail Closed、SSRF 地址矩阵、
API Key 数据库/API 扫描、跨租户 CRUD/Binding 以及删除级联。
