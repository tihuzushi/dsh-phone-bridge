# DSH Phone Bridge

把 **DeepSeek Harness** 装进手机的完整方案。手机通过 Tailscale 直连你自己的电脑，不经过任何中转服务器。

项目分两个仓库：

| 仓库 | 作用 |
|---|---|
| **[tihuzushi/dsh-phone-bridge](https://github.com/tihuzushi/dsh-phone-bridge)** ← 本仓库 | 装在电脑 DSH 里的**插件**：桥接服务 + 手机版界面 + 配对码 / 端口设置 |
| **[tihuzushi/dsh-phone-bridge-app](https://github.com/tihuzushi/dsh-phone-bridge-app)** | **安卓客户端**（APK）：内置 `tsnet` 用户态 Tailscale，不占用系统 VPN |

📦 手机 APK（Releases）

<https://github.com/tihuzushi/dsh-phone-bridge-app/releases/latest>

🎬 作者 B 站主页

<https://space.bilibili.com/157183587>

![手机版：未连接时的界面](docs/phone-offline.png)

![手机版：侧边抽屉](docs/phone-drawer.png)

---

## 从零开始配置（照着做完就能用）

### 第 0 步：准备

| 需要的 | 说明 |
|---|---|
| 一台 Windows 电脑 | 装好 DeepSeek Harness（DSH），能正常打开界面 |
| 一台安卓手机 | Android 8.0（API 26）及以上 |
| 一个 Tailscale 账号 | 免费版够用，<https://login.tailscale.com/start> 注册 |

### 第 1 步：电脑装 Tailscale（先做这个）

1. 打开 <https://tailscale.com/download/windows> 下载安装
2. 托盘里登录你的 Tailscale 账号，点 **Connect**
3. 确认状态是 Connected

> 手机端虽然自带 Tailscale，但**电脑也必须在同一个 tailnet 里**，手机才找得到它。

### 第 2 步：电脑装这个插件

DSH 里：**设置 → 插件 → 添加插件**，填：

```
https://github.com/tihuzushi/dsh-phone-bridge
```

必须是这种 `https://` 的完整地址（输入框不认 `github:user/repo` 简写）。装完**重启 DSH**。

### 第 3 步：确认插件起来了

**设置 → DSH Phone Assistant**，应该看到：

- 状态：**运行中**（绿点）
- **配对码**：6 位数字，下一步要用
- **Tailscale**：已连接 + 你的设备名
- 服务：监听 `0.0.0.0:8765`

任何一项不对：

| 现象 | 处理 |
|---|---|
| 未运行 | 插件没启动，重启 DSH；再不行看 8765 是否被别的程序占用 |
| Tailscale 红点「没有安装」 | 回第 1 步 |
| Tailscale「已安装，但没有连接」 | 打开电脑上的 Tailscale 点 Connect |

### 第 4 步：手机装 App

1. 打开 <https://github.com/tihuzushi/dsh-phone-bridge-app/releases/latest>
2. 下载 `DSH-Phone-Bridge-<版本>.apk` 装到手机上（允许「安装未知来源应用」）

### 第 5 步：手机登录 Tailscale

App 右上角进 **连接设置** → 「打开 Tailscale 登录页」→ 浏览器里登录**同一个账号** → 回 App 等状态变成「已连接」。

### 第 6 步：配对

1. App 的「连接设备」里选中你的电脑（列表来自你的 tailnet）
2. 填上第 3 步看到的 **6 位配对码**
3. 点「保存并连接」

连上以后 DSH 界面就在手机里打开了，手机版布局由这个插件注入。

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 手机一直闪屏、进不去 | 配对码不对，App 在自动重试。看电脑设置页的当前码；插件 0.4.5 起不会因此锁死 |
| 设备列表是空的 | 手机端 Tailscale 没登录，或电脑没连上 tailnet |
| 换了电脑 / 重装了插件 | 配对码会重新生成，重新填一次 |
| 想换端口 | 设置页「端口」卡片里改，或勾「被占用时自动换端口」 |

---

## 它做了什么

| 半边 | 作用 |
|---|---|
| **宿主侧**（`lib/index.js`） | 在 `0.0.0.0:8765` 监听，给手机一个配对入口，把 HTTP 和 WebSocket 转发到 DSH 自己的回环端口，并附上本地签发的会话 cookie |
| **客户端侧**（`lib/client.js`） | 手机打开时套用移动端外壳：抽屉侧边栏、顶栏菜单、面板页标题内联按钮、文件下载与预览 |

DSH 的 Web GUI 只监听 `127.0.0.1`，手机（另一台设备）本来连不上；这个插件就是那条通道。

## 设置页

![settings section](docs/settings-section.png)

**设置 → DSH Phone Assistant** 里有：

- **配对**：配对码、配对页地址、`重新生成配对码`、`配对重试节流` 开关
- **服务**：监听地址、上游 DSH 端口
- **端口**：改端口 / 被占用时自动换端口
- **Tailscale**：只显示这台电脑的设备名，并实时检测装没装、连没连；没装直接给下载按钮
- **APP 客户端**：下载手机 APK 的按钮，跳到 [App 仓库的 Releases](https://github.com/tihuzushi/dsh-phone-bridge-app/releases/latest)
- **版本**：当前插件版本 + **检查更新**

### 配对码对不上

没有冷却锁定了。输错只会把重试间隔拉长（1.5 秒起、最长 15 秒），**正确的码随时都能立刻通过**。

- 手机提示「配对尝试过多」→ 电脑设置页看当前码
- 想立刻换码 → 点「重新生成配对码」（同时清掉节流状态）
- 想完全不管节流 → 关掉「配对重试节流」开关

## 更新插件

设置页最下面「版本 → 检查更新」：

- 用 GitHub API 取仓库 HEAD 的 commit，再读这个 commit 上的 `package.json` 比版本（按 sha 取文件，避免 CDN 缓存把新旧文件混在一起）
- 有新版本 → 弹窗显示新旧版本号，点「立即更新」把 `lib/index.js`、`lib/client.js`、`package.json` 等文件覆盖到已安装目录（覆盖前备份到系统临时目录，失败整体回滚）
- 更新完成 → 提示「重启 DeepSeek Harness 即可完成更新」

![更新弹窗](docs/update-dialog.png)

热更新只替换磁盘上的文件，**重启一次 DSH** 才会跑新代码。

## Tailscale

插件监听 `0.0.0.0:8765`，包含 Tailscale 虚拟网卡：

- 电脑登录 Tailscale 后，设置页会显示设备名，启动日志里会多一条 `Tailscale: http://100.x.x.x:8765`
- 手机和电脑在同一个 tailnet 里就能连，同一个 Wi-Fi 或外网都行
- 手机端**不需要装 Tailscale App**——APK 内置了 `tsnet`，在 App 里登录一次即可

## 配置

状态文件：`~/.dsh/phone-bridge.json`

```json
{
  "port": 8765,
  "autoPort": true,
  "throttle": true,
  "pairingCode": "123456"
}
```

## 防火墙

首次运行时 Windows 会弹「是否允许」，选**专用网络**允许。没弹窗但连不上，检查入站规则里的 8765 端口。

## 卸载

DSH → 插件 → 已安装插件 → `dsh-phone-bridge` → 卸载，重启 DSH。

## 相关仓库

- **[tihuzushi/dsh-phone-bridge](https://github.com/tihuzushi/dsh-phone-bridge)** — 本仓库：电脑端 DSH 插件
- **[tihuzushi/dsh-phone-bridge-app](https://github.com/tihuzushi/dsh-phone-bridge-app)** — 安卓客户端源码与 APK

## 许可证

MIT，见 [LICENSE](LICENSE)。

本仓库**不含任何第三方代码**：只用了 Node 内置模块，没有运行时依赖。它跑在
DeepSeek Harness 之上，调用的是 DSH 的插件 API（DSH 本身也是 MIT），没有复制
DSH 的源码。

安卓端那个仓库不一样 —— 它的 APK 里打包了 Tailscale 的二进制，许可证清单见
[dsh-phone-bridge-app/THIRD-PARTY-NOTICES.md](https://github.com/tihuzushi/dsh-phone-bridge-app/blob/main/THIRD-PARTY-NOTICES.md)。

---

## 写这个的人

B 站主页

<https://space.bilibili.com/157183587>
