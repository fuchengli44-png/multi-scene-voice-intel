# 多场景语音情报系统 APP MVP

Expo React Native + TypeScript 移动端 MVP，基于附件整理出的三类语音情报场景：

- 会议模式：多人发言、Speaker 标注、双语规范化、Action Items
- 个人表达模式：日语原始表达、商务日语修正、中文双版本、发音建议
- 情报场景模式：非正式信息过滤、客户动向/竞争情报提取、可信度标记

首版使用本地模拟分析引擎，不调用真实 ASR/LLM API。

也可以在“设置”页配置 OpenAI API Key：

- 配置后：录音音频可调用 OpenAI 转写，文本可调用 Responses API 生成结构化分析
- 未配置：继续使用本地模拟分析
- 当前 API Key 只存在前端运行态，适合个人原型验证；生产发布应改为后端代理，避免泄露密钥

推荐使用本地代理保护 API Key：

```bash
copy .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY
npm.cmd run api:proxy
```

然后保持 APP 设置页里的代理地址为 `http://127.0.0.1:8787`。这样前端不会保存 OpenAI API Key。

## 每日学习内容投喂

每天的自动学习任务会输出一个 `APP_FEED_JSON` 代码块。复制这段 JSON，打开 APP 底部“投喂”页，粘贴后点击“导入到 APP”。

导入后：

- `terms` 会进入词库
- `intel` 会进入情报库
- `meetings` 会转成会议/讲座样本，进入最近任务

公开会议/讲座录音只保存来源链接、机构、国家、摘要或公开转写片段；不要把未授权音视频全文复制进 APP。

### 手机录音说明

手机通过 `http://电脑IP:8090` 打开的 PWA 在多数浏览器中不能直接调用麦克风，因为麦克风权限通常要求 HTTPS。

当前可用流程：

1. 用手机自带“语音备忘录/录音机”录音
2. 打开 APP 的“采集”页，点“选择手机已有录音”
3. 或打开“投喂”页，点“选择录音并整理”
4. 系统会转写录音，生成会议纪要，并自动学习：
   - 术语
   - 日语表达修正
   - 翻译偏好
   - 情报条目
   - 纠错规则

如果要在 APP 内直接录音，请使用 HTTPS 部署地址，或用 Expo Go / 原生安装包。

## 纠错闭环

底部“纠错”页用于把人工确认沉淀为规则：

- 术语纠错：把误识别词映射到标准术语
- Speaker 纠错：把 Speaker 1/2 修正为日方工程师、客户、自己
- 表达修正：把口语或低质量日语升级为商务/工程表达
- 翻译修正：沉淀中日双版本翻译偏好
- 情报可信度：记录哪些来源和表达更可信

这些规则后续可投喂给转写、结构化分析和每日学习任务，形成持续迭代的数据资产。

当前实现中，纠错规则已经会进入分析流程：

- 真实 OpenAI 分析：规则会随请求发送给前端直连或本地代理，并写入模型 prompt
- 本地模拟分析：术语、表达、翻译类规则会先替换输入文本，再生成模拟结果

采集页在 Web 预览中会尝试调用浏览器麦克风和内建 SpeechRecognition：

- 支持时：点击“开始录音”，实时识别文本会自动进入分析输入框
- 不支持时：仍可手动输入文本，再生成结构化分析
- 会议/个人表达默认使用日语识别，情报场景默认使用中文识别

## Commands

```bash
npm.cmd install
npm.cmd run web:local
npm.cmd run typecheck
npm.cmd run api:proxy
npm.cmd run build:pwa
npm.cmd run serve:pwa
```

在受限工作区里运行 Expo 时，可先把 Expo 本地目录指到项目内：

```powershell
$env:EXPO_HOME=(Join-Path (Resolve-Path '.').Path '.expo-local')
$env:EXPO_NO_TELEMETRY='1'
npm.cmd run web:local
```

## 手机下载/安装

最稳的落地方式是先把 Web 版做成 PWA。PWA 不需要 App Store，也不需要 Expo Go，手机浏览器打开后可以“添加到主屏幕”。

电脑端：

```powershell
cd "C:\Users\lee\Documents\多场景语音情报系统 2"
npm.cmd run build:pwa
npm.cmd run serve:pwa
```

然后在另一个 PowerShell 里查看电脑 IP：

```powershell
ipconfig
```

手机和电脑连同一个 Wi-Fi，用手机浏览器打开：

```text
http://电脑IP:8090
```

打开后：

- iPhone Safari：点分享按钮 -> 添加到主屏幕
- Android Chrome：点右上角菜单 -> 安装应用 / 添加到主屏幕

如果手机打不开，通常是 Windows 防火墙挡住 8090 端口。管理员 PowerShell 运行：

```powershell
New-NetFirewallRule -DisplayName "Voice Intel PWA 8090" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow
```

原生 APK/IPA 的下一步是接 EAS Build；这需要 Expo 账号登录和云端打包。

## 三条落地路线

### 1. HTTPS PWA

需要：

- GitHub 账号
- Vercel 或 Netlify 账号
- OpenAI API Key，建议放在后端代理，不要写死到前端

执行：

```powershell
npm.cmd run build:pwa
```

把项目推到 GitHub 后，在 Vercel/Netlify 里导入仓库即可。本项目已包含：

- `vercel.json`
- `netlify.toml`

部署平台会自动运行：

```bash
npm run build:pwa
```

输出目录是：

```text
dist
```

### 2. Expo Go 开发测试

需要：

- 手机安装 Expo Go
- 电脑和手机联网

执行：

```powershell
npm.cmd run start -- --host tunnel --port 8081
```

用 Expo Go 扫二维码。

### 3. Android APK

需要：

- Expo 账号
- EAS CLI：`npm.cmd install -g eas-cli`
- Android 手机
- 如需真实 OpenAI 分析，配置本地/云端代理和 `OPENAI_API_KEY`

首次配置：

```powershell
eas login
eas init
eas build:configure
```

打 APK：

```powershell
npm.cmd run build:android:apk
```

打正式 Android App Bundle：

```powershell
npm.cmd run build:android:aab
```

本项目已包含 `eas.json`，`preview-apk` 会生成可安装 APK。

## Phone / LAN version

Use this when the phone and computer are on the same Wi-Fi network:

```powershell
npm.cmd run api:proxy
npm.cmd run mobile:web
```

Open the Expo LAN URL shown in the terminal from the phone browser. The app now infers the OpenAI proxy from the page host, so a phone opened at `http://<computer-lan-ip>:8081` will default the proxy to `http://<computer-lan-ip>:8787` instead of `127.0.0.1`.

If the phone cannot connect, allow Node.js through Windows Firewall for private networks and confirm the proxy health URL opens from the phone:

```text
http://<computer-lan-ip>:8787/health
```
