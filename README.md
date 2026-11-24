# ChatBox

跨平台的 AI 聊天网页聚合器:默认提供 ChatGPT / Gemini / 千问 / DeepSeek,侧边栏 + 全局快捷键毫秒级切换,支持从现有浏览器一键导入登录态。其他站点(如 Kimi)可通过侧边栏「+」自行添加。

## 配置存放

- 默认站点定义:`src/shared/sites.js`(随应用分发)。
- 用户个性化配置:操作系统标准用户数据目录下的 `ChatBox/`——Windows `%APPDATA%\ChatBox`、macOS `~/Library/Application Support/ChatBox`、Linux `~/.config/ChatBox`。含 `config.json`(快捷键/标题栏/代理/指示条颜色)与 `sites.json`(用户增删改后的站点列表,首次运行从默认值生成)。

## 运行

```bash
npm install
npm start
```

国内网络下载 Electron 二进制失败时:

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm install
```

## 打包安装包

```bash
npm run pack:crx     # 先打包扩展(安装包会内置 crx 与扩展目录)
npm run dist:win     # Windows: release/ChatBox-Setup-x.y.z.exe(NSIS,可选安装目录,默认用户级安装)
npm run dist:mac     # macOS: release/ChatBox-x.y.z-arm64.dmg(需在 macOS 上执行;仅发 arm64,不做 Intel)
```

国内网络需先设 `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'` 与 `$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`。DMG 无法在 Windows/Linux 上交叉构建(apple 工具链限制),在 Mac 上克隆仓库执行 `npm install && npm run dist:mac` 即可。

未配置签名证书时产物为 ad-hoc 签名应用:**从浏览器下载的 DMG 会带隔离标记,首次打开报「已损坏」**,安装后执行 `xattr -dr com.apple.quarantine /Applications/ChatBox.app` 即可正常打开(本地构建的 DMG 无此问题;应用内自动更新下载的安装包不受影响)。彻底解决需 Apple Developer 证书签名+公证。

CRX 签名私钥 `assets/extension-private.pem` 不入库。没有私钥的开发者(如 Mac 协作开发)无需打包 crx:直接用「加载已解压的扩展程序」选择 `extension/` 目录,扩展 ID 由 `extension/key.txt` 固定,与正式版一致。`npm run pack:crx` 仅在持有私钥的发布机上执行。

## 发布

Windows 发布流程:先 `npm run dist:win` 生成 `release/win-unpacked`,再用 Inno Setup 编译 `installer/chatbox.iss` 得到 `release/ChatBox-Setup-x.y.z.exe`,最后执行 `npm run release -- --notes "更新说明"`。

macOS 发布流程:在 Mac 上 `npm run dist:mac`(仅 arm64),再执行 `npm run release -- --notes "更新说明"`。

发布脚本会自动打包 crx、生成 checksums,并通过 gh 上传到 GitHub Release:**Release 不存在则创建,已存在则追加上传**(`--clobber`),并合并远端 checksums 保留另一端条目。因此两端发同一个版本时:一端先创建 Release,另一端拉取最新代码、构建后直接 `npm run release` 即追加到同一 Release,无需手动操作。每个 Release 必须包含 crx。

自动更新:应用内「检查更新」读取最新 Release。Windows 下载 exe 校验 sha256 后静默安装并重启;macOS 下载本机架构的 dmg,校验后挂载、替换应用 bundle 并自动重启(需应用位于可写目录如 /Applications,从 dmg 直接运行时回退为打开下载页)。

## 快捷键

全部全局快捷键均可在侧边栏底部「齿轮 → 设置」中自定义:点击输入框后按下组合键即录制生效,Backspace/Delete 清除,注册失败(被占用)自动还原。**新安装默认不设置任何快捷键**,避免占用系统组合键;macOS 上 Cmd 与 Ctrl 分别录制为 Command / Control。

| 快捷键示例(默认均未设置) | 功能 |
|---|---|
| `Alt+Space` | 弹出快捷切换面板,←→/数字选择,Enter 打开,Esc 关闭 |
| `Ctrl+Shift+A`(mac 建议 `Cmd+Shift+A`) | 唤起主窗口 |
| `Ctrl+Alt+1~4` | 直达对应站点(每个站点独立可改) |

窗口为无边框设计。点击左侧栏顶部的小 Logo,弹出悬浮标题栏:含地址栏(Enter 前往)、后退/前进/刷新/回首页,以及窗口控制(最小化/最大化/关闭)——**全平台统一在右侧**;标题栏空白处可拖动窗口,失焦自动收起。侧边栏底部依次为「导入(链条图标)」和「设置(齿轮,最底)」。侧边栏右键站点图标 = 在系统浏览器打开;关窗隐藏到托盘,托盘菜单退出。

## 导入浏览器登录态

1. 点侧边栏底部「导入」按钮 → 「打开扩展管理页」(会自动注册 Native Messaging host)。
2. 在 `chrome://extensions` 开启开发者模式,把 `dist/ChatBox-cookie-bridge.crx` 拖进去。
   - Chrome 若拦截商店外 crx(常见),改用「加载已解压的扩展程序」选择本仓库 `extension/` 文件夹,效果完全一致。
   - crx 由 `npm run pack:crx` 生成(CRX3 格式,签名密钥固定扩展 ID)。
3. 点浏览器工具栏里的 ChatBox Cookie Bridge 图标 → 「发送登录态到 ChatBox」。
4. 回到应用点「导入」,各站点自动注入 Cookie 并刷新,同时把应用 UA 对齐为你浏览器的 UA。

扩展 ID 由 `extension/key.txt` 固定为 `mhckjchioegdliloddfmnpdkpjafmcen`,与 host 白名单一致;私钥在 `assets/extension-private.pem`(已 gitignore)。

## 结构

```
src/main/index.js        主进程:BaseWindow + 每站点常驻 WebContentsView、快捷键、托盘、导入
src/main/native-host.js  Native Messaging host 注册(Win 注册表 / mac・Linux 目录)
src/main/config.js       配置(userData/config.json)
src/shared/sites.js      默认站点定义(URL / Cookie 域名 / 颜色)
src/renderer/sidebar/    侧边栏 UI + 导入面板
src/renderer/switcher/   全局快捷切换面板
native-host/host.js      独立 Node 进程,收扩展消息写入 cookie-import.json
extension/               Chrome MV3 扩展(cookies + nativeMessaging)
scripts/make-icons.js    生成图标与扩展密钥
scripts/make-app-icons.js 生成应用图标(ICO/PNG/托盘,npm run icons:app)
scripts/pack-crx.js      打包 CRX3 单文件扩展
```

## 已知边界

- Linux Wayland 下全局快捷键依赖桌面环境支持,X11 正常。
- Google 登录可能拦内嵌浏览器;导入登录态可绕过,或改 UA 后重试。
- 未读角标依赖页面标题里的 `(n)` 前缀,部分站点不写标题则无角标。
