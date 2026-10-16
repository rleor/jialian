# 家练

家练手机原型的 Capacitor Android 测试工程。不需要在本机安装 Android Studio；GitHub Actions 在云端编译 APK。

## 下载测试 APK

1. 将本工程提交到 GitHub 仓库（包含 `android/` 和 `.github/`）。
2. 在 GitHub 打开 **Actions → Build 家练 APK → Run workflow**。首次工作流文件需要位于默认分支。
3. 等待构建完成，在运行页面的 **Artifacts** 下载 `jialian-debug-apk-运行编号`。
4. 解压得到 `jialian-debug.apk`，传到 Android 手机安装。按系统提示允许该来源安装。

推送到 `main` / `master` 或提交相关 PR 也会构建。构建只上传下载附件，不发布到商店。附件保留 14 天。

## 本地开发（只需 Node.js 22+）

```sh
npm ci
npm run build
npm test
npx cap sync android
```

`dist/index.html` 是离线可用的独立页面，使用本地存储保留记录。`prototype/jialian-mobile.html` 是界面源码；修改后重新构建即可。Android 中去除了演示手机外壳、假状态栏，图标随安装包打包，无需联网下载字体。

- 应用显示名：家练
- 测试包名：`com.jialian.app`（正式发布前可按实际归属调整）
- Node.js 22 / Java 21 / Android SDK 36 / Capacitor 8
- 当前构建：debug 测试 APK，非商店发布包

## 跨构建覆盖安装

未配置签名时，云端每次可能生成不同的默认 debug 签名，不能保证覆盖安装。若需要连续测试并保留本地数据，可将同一个**测试用** Android debug keystore 的 Base64 内容保存为仓库 Actions Secret：`JIALIAN_DEBUG_KEYSTORE_BASE64`。该 keystore 使用 Android 标准 debug 别名及密码（`androiddebugkey` / `android`），不要使用正式发布密钥。

工作流会恢复该测试签名，无需把密钥文件放入仓库。不配置此 Secret 也能打包；签名不一致时卸载旧版会清除本地记录。

## 原型范围

当前仍使用 2026-10-12 至 10-18 的演示周。语音为模拟转写，AI 为本地规则，下周草案不会由后台自动生成。真实识别、服务端计划及商店发布尚未接入。账号/云端同步代码已接入，须按下方说明部署后台并配置 API 地址后才能使用。分享图可在应用内生成预览，原生相册保存/系统分享需后续接入。

`design/`、旧测试脚本、研究 PDF 和本地预览不进入仓库。聊天内原型与这里的源码是两个文件；后续以 `prototype/jialian-mobile.html` 为工程源码维护。

## 自托管后台

后台使用 Node.js + PostgreSQL，可在现有服务器用 Docker 部署，详见 [docs/backend-setup.md](docs/backend-setup.md)。包含用户名密码注册登录、会话撤销、账号隔离、本地待同步队列、游客数据导入、版本冲突处理和数据导出。

```sh
cp deploy/.env.example .env
# 填入 POSTGRES_PASSWORD
docker compose up -d --build
```

API 默认只在服务器 localhost:3000 开放；HTTPS 可使用自带 Caddy profile。APK 在 GitHub Actions Variable `JIALIAN_API_BASE_URL` 配置后台地址。未配置时保持本机保存。

CI 会测试后台、构建 Docker 镜像，再生成 APK。下载附件另包含 `jialian-backend.tar.gz` 后台部署包。
