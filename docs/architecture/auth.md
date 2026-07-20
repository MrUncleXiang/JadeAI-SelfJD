# 认证与账号设计

关联需求：AUTH-001 至 AUTH-008、SEC-001。

## 1. 设计选择

JadeAI Career 使用项目内的账号领域服务和数据库会话，不再暴露上游 NextAuth/Google
登录入口。这样只有一套权威身份解析链，避免旧 OAuth 回调按邮箱静默合并账号。

首期采用数据库持久化的不透明 Session：

- 浏览器只持有 Secure、HttpOnly、SameSite=Lax Cookie。
- 数据库只保存 Session Token 的哈希。
- Cookie 不包含角色、API Key 或完整用户资料。
- 每次鉴权同时校验用户状态、Session 到期时间和 `token_version`。

不采用把 Access Token 或 Refresh Token 保存到 `localStorage` 的方式。

页面导航和个人数据鉴权分开控制：

- `AUTH_ENABLED=true` 时，个人 API 始终校验数据库 Session 和租户归属。
- `AUTH_REQUIRED=false` 时不强制把页面导航重定向到登录页；未登录用户会在工作区看到稳定的登录提示和入口。
- `AUTH_REQUIRED=true` 时，中间件才对非公开页面执行登录重定向。
- 可选登录模式不会把匿名访问映射成管理员，也不会放宽 API 的 `401 UNAUTHORIZED` 边界。

## 2. 登录标识

- `username` 必填，去除首尾空格并进行 Unicode 规范化，比较时大小写不敏感。
- `email` 可选；当前可作为登录标识，邮件验证和找回密码属于后续能力。
- 登录输入可为 Username 或已登记 Email。
- 错误响应统一为“账号或密码错误”，不暴露账号是否存在、被禁用或邮箱是否注册。

## 3. 密码

- 新密码至少 12 个字符，允许长密码和密码管理器生成值。
- 不要求强制混合大小写和符号，以长度和泄漏密码检查优先。
- 最大长度和请求体大小受限，防止密码哈希 DoS。
- 当前实现使用 Node.js `scrypt`（N=32768、r=8、p=1、32-byte key、16-byte salt），
  哈希字符串携带算法及参数；正式发布前仍需完成独立性能与安全评审。
- 密码哈希中保存算法和参数，支持登录时渐进升级。
- 密码修改成功后递增 `token_version`，撤销该用户全部 Session。
- 邮件密码重置属于后续能力；实现时 Token 必须随机生成，数据库只保存哈希，单次使用且短期有效。

## 4. 注册模式

`system_settings.registration_mode`：

- `closed`：默认值，仅管理员创建用户。
- `invite`：有效邀请码可注册。
- `open`：开放注册，可叠加邮箱验证和人机验证。

注册流程：

1. 读取服务端注册模式。
2. 按粗粒度 IP Prefix 和规范化登录名进行数据库限流。
3. 校验邀请、Username、Email 和密码。
4. 单事务创建用户、密码凭证和邀请使用记录。
5. 创建初始 Session。
6. 写入审计事件。

数据库首次初始化不创建默认密码。当前首个管理员只允许通过读取 stdin 的 CLI 创建；检测到
活动管理员后 Bootstrap 永久拒绝继续创建。

## 5. 管理员规则

管理员可以：

- 搜索、分页和筛选用户元数据。
- 创建用户、发放邀请。
- 禁用或恢复用户。
- 修改普通用户角色。
- 撤销指定用户的全部 Session。

管理员不能：

- 删除自己的当前账号。
- 降级自己导致系统没有管理员。
- 降级或禁用最后一个活动管理员。
- 在没有显式支持权限和审计理由时读取用户简历正文、GitHub 私有内容或 LLM Key。

角色和状态变更必须在事务中重新计算活动管理员数量，不能只依赖前端按钮禁用。

## 6. 第三方身份

现有 `auth_accounts` 仅作为未来第三方身份绑定的数据基础，不开放登录 Route；外部身份绑定
不作为首期账号密码功能的前置条件。

身份绑定规则：

- 以 Provider Subject 为唯一身份，不以 Email 自动合并账号。
- 已登录用户主动发起绑定。
- 如果身份已属于其他用户，创建待处理冲突，不静默迁移。
- 解绑前确保账号仍有密码或其他可用登录方式。

个人信息来源的凭证与登录身份完全独立：

- 文件/目录上传不需要第三方授权。
- 公共 GitHub URL 不携带用户凭证。
- Fine-grained PAT 只是当前用户某个来源连接的加密只读凭证，不能创建或登录 JadeAI 账号。
- GitHub App 安装是可选的“来源授权”，不是 `github-login`，也不能替代账号密码 Session。
- OAuth Authorization Code 是短期一次性交换材料，不是可长期保存并重复拉取仓库的授权码；如果后续采用
  OAuth，仍需注册 OAuth App 或 GitHub App，并在服务端交换和保护 Access Token。

任何来源模式都不得按 GitHub Email 自动合并 JadeAI 账号。当前可用登录入口仍只有本项目的账号密码
流程；未来开放第三方登录时必须单独立项并遵守本节身份绑定规则。

## 7. 请求鉴权与授权

推荐请求链：

```text
Cookie
  -> Session hash lookup
  -> Session active and not expired
  -> User active
  -> token_version matches
  -> actor context
  -> resource ownership / role policy
  -> domain action
```

`ActorContext` 至少包含：

- `userId`
- `role`
- `sessionId`
- `requestId`

禁止在领域层重新从未校验 Header 读取用户 ID。

## 8. 仓储接口

不安全：

```ts
resumeRepository.findById(resumeId)
resumeRepository.update(resumeId, patch)
```

目标形式：

```ts
resumeRepository.findOwnedById(actor.userId, resumeId)
resumeRepository.updateOwned(actor.userId, resumeId, patch)
```

Section 更新也必须通过 Resume 所有权：

```ts
resumeSectionRepository.updateOwned(actor.userId, resumeId, sectionId, patch)
```

管理员动作使用独立 `adminUserService`，不得给普通仓储增加“跳过租户”布尔参数。

## 9. CSRF、限流和 Cookie

- Cookie Session 的状态变更请求必须验证 Origin/CSRF Token。
- 登录、注册、重置密码、邀请验证和管理员动作分别限流。
- 只有受信反向代理会清除客户端伪造 Header 时才启用 `TRUST_PROXY_HEADERS`；否则不把
  `X-Forwarded-For` 或 `X-Real-IP` 当作限流身份。
- 限流存储不可用时，认证入口 Fail Closed；普通只读页面可按策略降级。
- 登录成功后旋转 Session，防止 Session Fixation。
- 当前 Cookie 名为 `jade_session`，生产环境启用 Secure，固定 Path=/ 且不设置 Domain。
- 账号认证默认启用并在生产环境 Fail Closed；旧指纹流程只允许本地显式兼容测试。

## 10. 自动验收

- 两个用户使用已知资源 ID 交叉调用所有受保护 Route，均返回 404 或 403，且无数据变化。
- AI Chat 使用其他用户的 `resumeId` 时，在调用 LLM 前失败。
- 禁用用户或修改密码后，已登录浏览器的下一次请求失败。
- 注册关闭时普通注册失败，有效邀请只可使用配置次数。
- 并发降级两个管理员时，数据库最终至少保留一个活动管理员。
- 数据库、Cookie、浏览器存储和日志中均不存在明文密码或 LLM API Key。
