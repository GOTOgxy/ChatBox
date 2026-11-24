# Mac 安装指南

## 安装步骤

1. 从 [Releases](https://github.com/GOTOgxy/ChatBox/releases/latest) 下载 `ChatBox-x.y.z-arm64.dmg`(仅支持 Apple Silicon / M 系列芯片)。
2. 双击打开 dmg,把 **ChatBox** 拖进 **Applications**。
3. **执行下面的一步操作**,再启动应用。

## 必做的一步:去除隔离标记

从浏览器(Edge / Chrome / Safari 等)下载的文件,macOS 会自动打上 `com.apple.quarantine` 隔离标记。ChatBox 目前没有购买 Apple 开发者证书做签名与公证,隔离标记 + 无签名两者叠加,Gatekeeper 就会报:

> 「ChatBox.app」已损坏,无法打开。你应该将它移到废纸篓。

**这不是安装包真的损坏了**,去掉隔离标记即可。打开「终端」执行:

```bash
xattr -dr com.apple.quarantine /Applications/ChatBox.app
```

然后正常启动即可。注意:

- 这种情况**右键「打开」没用**(右键打开只解决「未知开发者」提示,解决不了「已损坏」),必须用上面的命令。
- 如果应用装在别处,把路径换成实际位置。
- 提示需要权限时,命令前加 `sudo`。

## 哪些情况不需要这一步

| 安装方式 | 是否需要 xattr |
|---|---|
| 浏览器下载 dmg 安装 | **需要** |
| 本机自行构建的 dmg(`npm run dist:mac`) | 不需要(本地产物无隔离标记) |
| 应用内自动更新 | 不需要(更新器下载不走浏览器,且会自动清理标记) |

## 为什么会有这个问题

macOS 对从互联网下载的应用强制要求:Developer ID 签名 + 公证(notarization)。ChatBox 是免费开源项目,构建产物为 ad-hoc 签名,过不了 Gatekeeper 的在线校验。彻底解决需要 Apple Developer 账号($99/年)做签名与公证;在此之前,上面的一行命令是标准解法(Homebrew 等开源工具的分发也常遇到同样问题)。

## 数据与卸载

- 配置与登录态存放在 `~/Library/Application Support/ChatBox`,升级、重装应用不影响。
- 卸载:把应用拖进废纸篓;如需彻底清理,再删除上述数据目录。
