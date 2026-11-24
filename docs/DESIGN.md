# ChatBox 配置 / 安装 / 更新机制设计(安装版单形态)

> 参照"配置跟随用户"的设计理念落地。ChatBox 只做**安装版**,不做便携模式——形态唯一,安装/更新/数据链路都因此更简单。
> 核心差异点:ChatBox 最重的"本机资产"不是应用标识,而是**各站点的登录态**(Cookie / localStorage,存于 Electron 分区目录)。它天然与操作系统加密绑定(Windows DPAPI / macOS Keychain),**不可漫游、不应漫游**——这让"逻辑同步、环境隔离"的边界比一般软件更清晰。

## 一、配置文件机制与远程同步

### 1. 数据存放:唯一形态,永不丢失

- 数据固定在系统标准用户目录:`%APPDATA%\ChatBox`(Win)/ `~/Library/Application Support/ChatBox`(macOS)/ `~/.config/ChatBox`(Linux)。现状即如此,保留。
- 程序目录与数据目录彻底分离:升级、换安装路径、卸载重装都不触碰 userData。安装器只动程序目录(NSIS 用户级安装,见二)。
- 已有 ChatAI→ChatBox 目录迁移逻辑保留,作为历史包袱的一次性处理。
- "设置→关于"明示数据目录路径,一键打开——杜绝"配置存哪了"的困惑。
- 浏览器导入用的 Native Messaging host 注册写本机 HKCU / LaunchAgents,属于程序与浏览器的本机接线,与"配置漫游"无关;卸载时清理(见二.3)。

### 2. 通用规则 vs 本机差异:三层数据模型

把现在混在一起的 config.json / sites.json 拆成三层:

| 层 | 文件 | 内容 | 是否漫游 |
|---|---|---|---|
| 通用偏好 | `profile.json` | 快捷键(切换面板/唤起/各站点)、标题栏模式、指示条颜色、主页地址、自启开关、代理模式(system/custom 及规则) | ✅ WebDAV 同步 |
| 站点名册 | `sites.json` | id/名称/URL/域名规则/颜色/图标/排序/隐藏/openInApp | ✅ 同步(图标为 dataURL,随名册走) |
| 本机环境 | `local.json` + `Partitions/` | 窗口尺寸位置缓存、lastActive、WebDAV 凭据、UA 实测值、**全部登录态分区** | ❌ 永不上传 |

- 站点名册同步的是"定义",不是"会话":另一台机器拉到名册后,图标/快捷键/排序立即一致,登录态各自本地解决(导入或登录一次)。
- 冲突策略:文件级 `revision`(单调递增)+ `updatedAt`。拉取时若远端 revision 更新→整体覆盖通用层;若本地也改过(脏标记)→"后写优先 + 冲突副本 `profile.conflict-<时间>.json` 落盘",不弹窗打断。
- 快捷键注册失败(被占用)只影响本机生效,不改写名册——环境差异不回污染通用配置。
- 窗口尺寸/位置、lastActive 这类"这台机器的肌肉记忆"留在 local.json,不同分辨率的多机互不干扰。

### 3. WebDAV 云同步(坚果云 / NAS / 任意标准 WebDAV)

- 设置页新增"同步"区块:服务器地址 + 账号 + 应用密码 + 远端目录(默认 `/ChatBox/`)。凭据用 `safeStorage`(OS 加密)存 `local.json`,**绝不上云**。
- 传输物仅 `profile.json` + `sites.json`,合计通常 <200KB;PUT 前本地做 schema 校验,坏文件不上传。
- 触发:启动后拉取一次、修改通用层后防抖 30s 推送、手动"立即同步"按钮、每 30 分钟兜底轮询(HEAD 比对 ETag,无变化零流量)。
- **防"洗凭据"死锁**:ChatBox 的登录态本来就不在同步范围内,天然免疫;额外保护是拉取永不触碰 `local.json` 与 `Partitions/`,即使远端被塞了同名文件也直接忽略。WebDAV 自身凭据同样只读本机。
- 失败降级:网络不通/401 时静默转离线,状态显示"同步暂停",绝不影响主功能。

## 二、安装机制:免打扰、零提权、干净生命周期

### 1. 全程无 UAC

- NSIS 已是用户级(`perMachine:false`),补一刀:`allowElevation:false`——公司受限机直接装到 `%LOCALAPPDATA%\Programs\ChatBox`,无任何提权尝试。
- 代价明示:用户级安装写不了 HKLM,Native host 只注册 HKCU(现状即如此),Chrome/Edge 均支持,无功能损失。

### 2. 无缝体验

- **自启**:设置页开关 → `app.setLoginItemSettings({ openAtLogin, args:['--hidden'] })`(macOS 用 login item;Linux 写 `~/.config/autostart/*.desktop`)。`--hidden` 启动只建托盘不弹窗,复用现有"关窗即隐藏"逻辑。
- **升级交接**:安装器检测到运行实例 → 触发现有单实例机制通知旧实例优雅退出(`quitting=true`,保托盘状态)→ 等待 ≤5s → 仍在则提示而非强杀;装完自动拉起新版,升级前是隐藏态则带 `--hidden` 保持隐藏。
- **卸载透明**:NSIS 自定义完成页勾选"保留个人配置与登录态"(默认勾选)。勾选→只删程序目录;不勾→同时删 userData。

### 3. 生命周期卫生

- 退出时注销全局快捷键(已有);卸载器额外清理 HKCU Native host 键与自启项,不留孤儿注册表。

## 三、更新机制:无感换新、安全防坏(单链路)

### 1. 安装版静默接力

1. 检查更新:GitHub Releases API(已指向 `GOTOgxy/ChatBox`,现状)。
2. 后台下载 `ChatBox-Setup-x.y.z.exe` 到临时目录,校验 SHA256(Release 附 checksums 文件)。
3. 启动安装器 `/S`(NSIS 静默)+ 交接流程(二.2),装完自动重启。全程一个"立即更新"按钮,无向导。
4. 下载/校验/安装任一步失败→保留旧版原样可用,提示重试或走兜底通道;不存在"更新到一半坏掉"——替换由安装器原子完成,应用自身不参与自我覆盖。

### 2. 网络容错

- 下载与检查统一走 Electron `net.fetch`(自动跟随系统代理 / PAC),与应用内网页同网络栈——"网页能开,更新就能连"。自定义代理模式下用 `session.resolveProxy` 结果显式挂 agent。
- 断点续传(Range),失败指数退避重试 3 次。
- **兜底通道永远在**:更新失败提示里附"在浏览器中下载"按钮 → `shell.openExternal` 直达 Releases 页(跟随系统默认浏览器,已有该机制);内网极端环境拷包手动双击安装即可。

## 实施优先级建议

| 阶段 | 内容 | 理由 |
|---|---|---|
| P0 | 三层数据拆分 + 无 UAC 收紧 + 卸载保留配置页 + 关于页(数据目录) | 纯本地改动,风险低,是后续一切的地基 |
| P1 | 自启开关 + 静默更新接力 + net.fetch 代理友好 + checksums | 日常体验提升最大 |
| P2 | WebDAV 同步(冲突策略/凭据加密/降级) | 依赖 P0 的数据边界,需充分测试 |

## 与现状的差异清单(需要动的代码)

- `src/main/index.js`:`--hidden` 参数、单实例退出交接、更新器(新 `src/main/updater.js`)、自启开关 IPC。
- `src/main/config.js`:拆 profile/local,revision 字段;窗口缓存移入 local。
- 新 `src/main/sync.js`:WebDAV 客户端(标准 PUT/GET/HEAD,`net.fetch` 足够,无需依赖库)。
- `package.json` build:`allowElevation:false`、NSIS 自定义脚本(交接/卸载询问)、checksums 产物。
- 设置面板:同步区块、自启开关、关于(数据目录/更新通道)。
