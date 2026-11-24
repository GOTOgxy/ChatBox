# 扩展安装说明(ChatBox Cookie Bridge)

ChatBox 通过一个 Chrome 扩展 + Native Messaging(本机进程通信)把浏览器里已登录的 Cookie / localStorage 搬进应用。本文说清楚扩展怎么装、为什么推荐「加载已解压」。

## CRX 是什么,为什么通常用不了

`chatbox-cookie-bridge.crx` **只是扩展的一种打包分发形式**(CRX3 格式,带签名,由 `npm run pack:crx` 在持有私钥的发布机上生成,目前不随安装包分发),不是另一种功能。Chrome 出于安全策略,**默认拦截来自 Chrome 商店以外的 crx 安装**——拖进去多半会被拒绝或装完即禁用。

因此大多数情况下,正确姿势是:**直接加载已解压的扩展目录**,效果与 crx 完全一致。

## 推荐方式:加载已解压的扩展

1. 在 ChatBox 侧边栏底部点「导入」→「打开扩展管理页」。
   - 这一步会自动注册 Native Messaging host(应用与扩展之间的本机通信桥),必须先做。
   - 面板里同时提供扩展目录路径的一键复制。
2. 浏览器打开 `chrome://extensions`,右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」,选择 `extension/` 目录:
   - **安装版用户**:目录在应用资源里,路径以导入面板显示的为准(点「复制路径」)。
   - **源码开发者**:就是仓库根目录下的 `extension/` 文件夹。
4. 加载成功后,工具栏出现 ChatBox Cookie Bridge 图标。

> 扩展 ID 由 `extension/manifest.json` 里内置的公钥(`key` 字段)固定为 `mhckjchioegdliloddfmnpdkpjafmcen`,与 crx 安装、与 Native Messaging host 的白名单完全一致。**加载已解压不会改变 ID**,通信桥照常工作。不要删除或修改 manifest 里的 `key` 字段。

## 导入登录态

1. 确认浏览器里目标站点(ChatGPT / Gemini / 千问 / DeepSeek 等)已登录。
2. 点工具栏里的 ChatBox Cookie Bridge 图标 →「发送登录态到 ChatBox」。
3. 回到 ChatBox 导入面板点「导入」,各站点自动注入 Cookie 并刷新,同时把应用 UA 对齐为你浏览器的 UA。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| crx 拖入被拦截 / 装完被禁用 | Chrome 商店外 crx 策略,改用「加载已解压」 |
| 扩展点发送后应用收不到 | 没先点应用里的「打开扩展管理页」注册 host;或扩展 ID 不对(manifest 的 `key` 被改动) |
| 导入后站点仍要登录 | 部分站点(尤其 Google)登录态绑定 UA / 设备指纹,应用已对齐 UA,仍失败可重试或换账号方式 |
| 扩展目录找不到 | 以应用导入面板显示的路径为准;源码开发用仓库 `extension/` |

## 开发者:没有私钥怎么打包扩展?

见 [开发者指南 · 扩展私钥](development.md#扩展私钥与打包)。结论先行:**没有私钥完全不影响开发——加载已解压即可,ID 与正式版一致;crx 签名只在持有私钥的发布机上做。**
