# 开发者指南

## 环境搭建

需要 Node.js(建议 20+)与 npm。

```bash
npm install
npm start
```

国内网络下载 Electron 二进制失败时设镜像:

```bash
# macOS / Linux
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```
```powershell
# Windows
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm install
```

新版 npm(11.x 起)默认拦截依赖的 install 脚本,Electron 二进制不会下载。先批准再装:

```bash
npm install-scripts approve electron electron-winstaller
npm install   # 或 npm rebuild electron
```

macOS 沙箱环境下 Electron 解压可能静默失败,可从 `~/Library/Caches/electron/` 手动解压 zip 到 `node_modules/electron/dist/` 并写入 `path.txt`(内容 `Electron.app/Contents/MacOS/Electron`,无换行)。

## 项目结构

```
src/main/index.js          主进程:窗口/视图、标题栏、托盘、快捷键、面板、IPC
src/main/config.js         配置读写(userData/profile.json + local.json)
src/main/sync.js           WebDAV 云同步(仅 profile + sites)
src/main/updater.js        自动更新(Win 静默安装 / mac DMG 替换)
src/main/native-host.js    Native Messaging host 注册(Win 注册表 / mac・Linux 目录)
src/main/sites-store.js    站点名册持久化
src/main/downloads.js      下载管理
src/main/mechanisms/       登录态导入机制(图标拉取等)
src/preload/               各窗口 preload(contextBridge API)
src/renderer/              sidebar / panel / switcher / titlebar / common
src/shared/sites.js        默认站点定义
native-host/host.js        独立 Node 进程,收扩展消息写 cookie-import.json
extension/                 Chrome MV3 扩展(manifest 内置公钥固定 ID)
assets/                    图标(程序化生成)、扩展私钥(gitignore)
scripts/                   图标生成、crx 打包、checksums、发布
installer/chatbox.iss      Windows Inno Setup 安装脚本(实际发行安装器)
build/installer.nsh        NSIS 钩子(dist:win 中间产物用)
docs/                      用户与开发文档
```

## 扩展私钥与打包

**机制**:扩展 ID 由公钥决定。`extension/manifest.json` 的 `key` 字段与 `extension/key.txt` 是同一把公钥,Native Messaging host 的白名单(`allowed_origins`)在运行时由 `key.txt` 推导。因此:

- **加载已解压目录** → ID 由 manifest 公钥固定 → 与正式版一致 → 通信桥直接可用。**开发不需要私钥,也不需要打包 crx。**
- **打包 crx**(`npm run pack:crx`)需要 `assets/extension-private.pem` 对 CRX3 签名。私钥不入库(gitignore),只存在于维护者的发布机。缺私钥时脚本会明确报错并指引加载已解压。

**没有私钥的开发者怎么办?**

1. 日常开发:直接加载 `extension/` 已解压目录,功能与 ID 和正式版完全一致,什么都不缺。
2. 确实要出 crx(比如自己的 fork 要分发):生成自己的密钥对,替换 manifest `key` 与 `key.txt`,再打包。ID 会变成新公钥对应的值,host 白名单随 `key.txt` 自动跟随,自洽可用——只是与官方 ID 不再互通。
3. 想产出与官方 ID 一致的 crx:必须拿到维护者的 `extension-private.pem`,没有替代途径(CRX3 签名就是私钥运算)。

## 构建与发布

### Windows

```powershell
npm run dist:win        # 出 release/win-unpacked(NSIS 为中间产物)
# 用 Inno Setup 编译 installer/chatbox.iss → release/ChatBox-Setup-x.y.z.exe
# iss 里版本号需与 package.json 一致,或给 ISCC 传 /DMyAppVersion=x.y.z
npm run release -- --notes "更新说明"
```

### macOS(仅 arm64)

```bash
npm run dist:mac        # release/ChatBox-x.y.z-arm64.dmg(必须在 macOS 上构建)
npm run release -- --notes "更新说明"
```

DMG 无法在 Windows/Linux 交叉构建。产物为 ad-hoc 签名,浏览器下载安装需去隔离标记,见 [Mac 安装指南](mac-setup.md)。

### 发布脚本行为

`npm run release` 自动:打包 crx → 复制到 release/ → 生成 checksums(覆盖 exe/dmg/crx)→ gh 上传:

- Release 不存在 → 创建 `v{version}` 并上传本机产物;
- Release 已存在 → **追加上传**(`--clobber`),并下载合并远端 checksums,保留另一端条目。

因此两端发同一版本:一端先创建,另一端拉取最新代码、构建后直接 `npm run release` 追加到同一 Release。每个 Release 必须包含 crx。

### 版本号清单

发版前确认:`package.json` version、`installer/chatbox.iss` 的 MyAppVersion(Windows)。

## 设计文档

配置 / 安装 / 更新机制的完整设计见 [DESIGN.md](DESIGN.md)。
