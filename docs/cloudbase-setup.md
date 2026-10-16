# 国内免费测试环境：CloudBase

当前已接入账号登录/注册界面、CloudBase 事件云函数、账号隔离的本地缓存、同步队列、显式游客记录导入、版本冲突处理。部署前只使用本地保存，不会假装已云端备份。

## 准备的账号和服务

1. 腾讯云账号，完成实名认证。
2. CloudBase **免费体验版**环境，优先上海 `ap-shanghai`，使用**传统模式 / 文档型数据库**。本实现不使用 PG 模式。
3. GitHub 仓库 `rleor/jialian` 已有，无需新账号。
4. 开放自助注册时，准备发件邮箱，配置 CloudBase 邮箱验证码身份源。QQ 邮箱 SMTP 可用于小范围测试，授权码只填 CloudBase 控制台，不放入 APK/GitHub。

不需要购买云服务器、PostgreSQL、对象存储、短信或独立 API 域名。本阶段不接语音或 AI，不开通这些付费服务。

官方当前提供每个账号 1 个免费体验环境、每月 3,000 资源点，需续期；免费环境不是不限量或有商用 SLA 的永久承诺。创建时以控制台实际权益为准，选 **免费体验版**而非付费个人版，不启用付费套餐/超额按量。资源点耗尽或环境停服时，App 保持本机记录，恢复环境后再同步。

参考：
- https://tcb.cloud.tencent.cn/pricing
- https://docs.cloudbase.net/api-reference/webv3/initialization
- https://docs.cloudbase.net/api-reference/webv3/authentication

## CloudBase 控制台配置

### 1. 身份认证

开启邮箱验证码注册、账号密码登录。使用新版身份源（SDK v3 的 `signUp → verifyOtp` 流程），不使用旧版激活链接邮件流程。配置发件人/邮件服务及发送额度；若控制台要求邮件付费套餐，先不要购买，可以先在身份认证用户管理中创建少量测试账号，只验证密码登录与同步。

不启用短信登录；客户端不会自行处理用户密码哈希或把密码写入训练数据库。

在安全域名/应用授权配置中允许 Android WebView 实际来源 **localhost**（当前 Capacitor 默认来源 `https://localhost`）。桌面开发可另外允许 `localhost:5173` 等实际端口，不要开放任意域名。域名授权不代替用户身份认证。

### 2. 数据库

创建两个文档集合：

- `jialian_data`：用户偏好、逐日计划、每次训练；每条记录包含 `owner`、`revision`、`deleted`。
- `jialian_mutations`：重复提交收据，避免网络重试产生重复记录。

两个集合的客户端安全规则均设为：

```json
{"read":false,"write":false}
```

数据只经 `jialian-sync` 云函数访问，云函数根据 SDK 提供的可信用户 UID 隔离账号，拒绝匿名用户，不接受客户端传入的 owner/userId。

`jialian_data` 创建复合查询索引：`owner` 升序 + `_id` 升序（用于本人数据分页拉取）。

不要删除 tombstone（`deleted:true`）记录，否则旧设备可能复活删除的数据。小范围测试中保留提交收据；长期运行时可给 `jialian_mutations.createdAt` 配置生命周期清理，需要先把字段改为平台要求的日期类型并验证，不能直接删近期收据。

### 3. 云函数

创建 **事件云函数**（不是 HTTP/Web 云函数），名称 **jialian-sync**，Node.js 20+，入口 `index.main`。

上传 `cloudfunctions/jialian-sync/`（或 Actions 附件中的 `jialian-sync-function.zip`），让平台安装 package.json 中的依赖。不要把管理员 SecretKey 写进代码；事件函数使用运行环境提供的临时身份访问数据库。

不设置公开 HTTP 网关。App 用 SDK `callFunction` 调用，函数内部还会检查已登录 UID。如果控制台提供调用权限，限制为已认证终端用户，不能授予匿名用户数据库访问。

函数资源从小规格开始（如 256 MB，30 秒超时），不设置常驻实例。实际可选规格以免费环境控制台为准。

## 配置 APK

在 GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 添加：

| Variable | 值 |
|---|---|
| JIALIAN_CLOUDBASE_ENV_ID | 你的环境 ID |
| JIALIAN_CLOUDBASE_REGION | ap-shanghai，或实际地域 |
| JIALIAN_CLOUDBASE_PUBLISHABLE_KEY | 控制台生成的 Publishable Key |

这三个是客户端配置，可以进入 APK。**不得填管理员 API Key、SecretId、SecretKey**。Publishable Key 不是用户权限凭证；私有数据由登录状态及函数检查保护。

然后手动运行 GitHub Actions **Build 家练 APK**。没有配置时 APK 的账号面板会显示“云端尚未配置”。

本地构建可通过 shell 环境变量传入同名配置，再执行 `npm run android:sync`。`.env.example` 是说明文件，构建不会自动读取 `.env`。

## 接入后的验收

1. 两个不同测试账号登录，彼此看不到对方记录；退出后恢复独立游客缓存。
2. 登录后选择是否导入游客记录；不自动把当前设备数据上传到新账号。
3. 在设备 A 保存一条训练，设备 B 同账号点击“立即同步”看到记录。
4. 设备 A 断网保存，重启后记录和待同步队列保留，联网重试不会重复创建。
5. 同一训练在两台设备修改时出现冲突，选择本机或云端版本后结果正确。
6. 计时中、未保存组次、语音草稿留在当前设备，不把另一台设备的计时写进来。
7. 确认集合直连被拒绝、无登录调用函数被拒绝；云端没有保存账号密码。

## 当前边界

- 训练界面仍为原型的固定演示周；账号和同步接入是独立的第一阶段，不等于产品已经完成正式日历/跨周功能。
- 本地缓存暂保留 localStorage，但按账号分区、队列持久化；量变大后应迁移到 IndexedDB/SQLite。卸载和清数据仍会丢失尚未上传的记录。
- 同步按记录比较版本，支持多次训练合并；同一记录的并发修改要求用户选择，不做静默覆盖。
- 拉取在登录、回到前台、联网、手动同步时触发；写入在操作后 4 秒合并上传。为了免费额度，不常驻监听、不每秒上传训练计时。
- 真实云端验收需要环境、身份源、集合和函数部署完成后进行。仓库单元测试使用隔离的内存存储，并不代表云部署已经成功。
