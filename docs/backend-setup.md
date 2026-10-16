# 家练自托管后台

Node.js 22 + Fastify + PostgreSQL，可用现有服务器部署。不依赖 CloudBase、短信或邮件服务，也不会自动创建云资源。

## Docker 启动

```sh
cp deploy/.env.example .env
# 将 POSTGRES_PASSWORD 填为随机强密码，例如 openssl rand -hex 32 的输出。
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health
```

API 默认只在宿主机 `127.0.0.1:3000` 监听；数据库不暴露宿主机端口。启动时自动执行版本化迁移，数据保存在 `pgdata` 卷。普通更新用 `docker compose up -d --build`；`docker compose down -v` 会删除持久化数据。

| 变量 | 用途 |
|---|---|
| POSTGRES_PASSWORD | 必填，仅保存在服务器 .env |
| API_PORT | 本机 API 端口，默认 3000 |
| CORS_ORIGINS | 允许的 App/Web 来源，逗号分隔；Android 默认 https://localhost |
| REGISTRATION_ENABLED | false 可关闭新用户注册 |
| REGISTRATION_INVITE_CODE | 可选，内测注册邀请码 |
| SESSION_DAYS | 会话有效天数，1–90，默认 30 |
| APP_DOMAIN | 使用 HTTPS profile 时的域名 |

独立 Node.js 支持 `DATABASE_URL` 或标准 `PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD`。Compose 用 PG 环境变量，密码不需要 URL 转义。

## 后续配置 HTTPS 和 APK

域名解析到服务器、配置 APP_DOMAIN 并确认 80/443 可用后：

```sh
docker compose --profile https up -d --build
```

Caddy 自动申请/续期证书。已有反向代理可直接转发到 `127.0.0.1:3000`。没有域名也能先本地验证后台。

在 GitHub Actions **Variables** 设置 `JIALIAN_API_BASE_URL`（例如 `https://api.your-domain.com`），再构建 APK。这个值是公开地址，不是密钥。未配置时 App 仍只保存在本机。

```sh
JIALIAN_API_BASE_URL=http://localhost:3000 npm run build
```

HTTP 只用于 localhost 开发；真机连接远端后台使用 HTTPS。手机上的 localhost 指手机自己。本地浏览器真实来源需加入 CORS_ORIGINS。

## 账号和同步

- 用户名 3–32 位，英文/数字/`_ . -`，忽略大小写；密码 8–128 位。
- 本阶段不做邮箱/短信验证、自助找回密码。内测可设置邀请码。
- 密码采用 scrypt 与独立盐。会话使用随机 bearer token，数据库只存 token 哈希，默认 30 天过期。
- 修改密码撤销其他设备会话；退出时优先撤销当前会话。服务不可用时只清除本机凭据，未撤销的远端会话到期失效。
- 每次训练、逐日计划、偏好分别同步；游客数据由用户选择导入。
- 权限由 bearer 会话确定，客户端自报 owner/userId 不决定访问权。
- 冲突需明确选择版本。重复提交靠事务收据去重；已删除记录保留 tombstone。
- 注销账号需当前密码，数据库级联删除其记录/会话。远端删除不会自动物理清除其他设备缓存。
- App 导出包含本机缓存、待同步操作和可获取的全量云端数据，不含登录 token。

数据库表：users、auth_sessions、sync_records、sync_mutations、schema_migrations。sync_records.document 是结构化 JSON，训练内组次可为空，一天可多次训练。

## API

| 方法 / 路径 | 作用 |
|---|---|
| GET /health | 数据库与服务健康检查 |
| POST /v1/auth/register | username、password，可选 inviteCode |
| POST /v1/auth/login | username、password |
| GET /v1/auth/me | 当前用户 |
| POST /v1/auth/logout | 撤销当前会话 |
| POST /v1/auth/password | oldPassword、newPassword |
| POST /v1/sync | pull 分页 / push 批次，最多 20 条 |
| GET /v1/export | 导出当前用户全部记录 |
| POST /v1/account/delete | password，注销账号 |

除注册、登录与健康检查外须带 `Authorization: Bearer <token>`。失败返回 `{ok:false,message}`，不返回密码或数据库内部错误。请求受来源配置与速率限制；单实例内测不需要 Redis。

## 备份和恢复

```sh
./deploy/backup.sh
```

生成私有权限的 backups/*.dump。备份仍在当前服务器，应自行复制到独立位置。数据库备份含密码/会话哈希，需要私下保存。

仅在确认恢复目标后使用以下命令，它会替换数据库内同名对象：

```sh
docker compose stop api
docker compose exec -T db pg_restore -U jialian -d jialian --clean --if-exists < backups/your-backup.dump
docker compose up -d api
```

管理员重置密码（新密码从 stdin 输入，不写命令行参数）：

```sh
read -s -p 'New password: ' reset_password; echo
printf '%s' "$reset_password" | docker compose exec -T api node src/admin-reset.js username
unset reset_password
```

重置会撤销所有会话。需要服务器管理权限。

## 测试

```sh
npm ci
npm run build
npm test
npm ci --prefix backend
npm test --prefix backend
```

本地默认用内嵌 PostgreSQL（PGlite）执行集成测试；CI 用 PostgreSQL 17 测试真实事务并发与 HTTP 接口，并构建、启动 Docker 镜像。

本地真实测试数据库用 TEST_DATABASE_URL，数据库名必须为 `jialian_test`，测试会清空测试表，不能指向生产库。

训练日历仍是固定演示周，语音/AI 仍为演示。本次准备账号、数据同步和部署后台，没有连接或修改 AWS 环境。本地暂用按账号隔离的 localStorage；卸载/清数据会丢失未上传记录。
