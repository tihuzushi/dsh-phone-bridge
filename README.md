# dsh-phone-bridge

Phone access for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), packaged as **one plugin**:
the bridge and the mobile shell UI live in the same DSH plugin, so there is no second process, no
`start-bridge.cmd` and no port scanning — the plugin runs inside the host and already knows which loopback
port the web GUI is on.

把「手机能连上电脑」和「手机上显示什么界面」合成一个 DSH 插件：装一次，重启 DSH，手机就能用。

![screenshot](docs/screenshot.png)

## 它做了什么

| 半边 | 作用 |
|---|---|
| **宿主侧**（`lib/index.js`） | 在 `0.0.0.0:8765` 监听，给手机一个配对入口，把 HTTP 和 WebSocket 转发到 DSH 自己的回环端口，并附上本地签发的会话 cookie |
| **客户端侧**（`lib/client.js`） | 手机打开时套用移动端外壳：抽屉侧边栏、顶栏菜单、面板页标题内联按钮、文件下载与预览 |

DSH 的 Web GUI 只监听 `127.0.0.1`，手机（另一台设备）本来连不上；这个插件就是那条通道。

## 安装

在 HARNESS 的 **插件 → 添加插件** 里填：

```
https://github.com/tihuzushi/dsh-phone-bridge
```

支持 npm 包名、Git 仓库、本地目录三种方式。装完**重启 DSH**，它会出现在「已安装插件」里。

## 设置页

装好并重启后，HARNESS 的**设置**里会多出一栏 **DSH Phone Assistant**：显示配对码、监听地址、上游端口和端口设置，都带一键复制；右上角有服务状态（运行中 / 未运行）。

Tailscale 一块**只显示这台电脑的设备名**，并实时检测它有没有装好、连上：

- 已连接：显示设备名和 Tailscale 版本（手机端自己会找到这台机器，不用填地址）
- 已安装但没登录 / 没连接：提示去电脑上打开 Tailscale 并 Connect
- 没安装：直接给出 [Tailscale 下载页](https://tailscale.com/download/windows) 的跳转按钮

![settings section](docs/settings-section.png)

### 版本与更新

设置页最下面一块是**版本**：显示当前版本号（例如 `0.4.1 · 0.4.1-mw06jo8f`），旁边是**检查更新**。

- 点「检查更新」→ 用 GitHub API 取仓库 HEAD 的 commit，再读这个 commit 上的 `package.json` 比对版本（按 sha 取文件，避免 CDN 缓存导致新旧文件混在一起）
- 有新版本 → 弹窗显示新旧版本号，点「立即更新」把仓库里的 `lib/index.js`、`lib/client.js`、`package.json` 等文件覆盖到已安装目录（覆盖前备份到系统临时目录，任一步失败整体回滚）
- 更新完成 → 提示「重启 DeepSeek Harness 即可完成更新」

![更新弹窗](docs/update-dialog.png)

热更新只替换磁盘上的文件，不重启进程，所以**必须重启一次 DSH** 才会跑新代码。

## 配对

重启后，在**电脑上**打开：

```
http://127.0.0.1:8765/_dsh-phone
```

页面会显示 6 位配对码和这台电脑的设备名（配对信息只在本机回环地址显示，局域网里的其他人看不到）。

手机 App 里登录同一个 Tailscale 账号、选中这台电脑，再填配对码即可。

配对成功后手机会拿到一个 1 年有效的 cookie，之后不用再配。

## Tailscale

插件监听的是 `0.0.0.0:8765`，**包含 Tailscale 虚拟网卡**，所以：

- 电脑登录 Tailscale 后，设置页会显示设备名，启动日志里也会多一条 `Tailscale: http://100.x.x.x:8765`
- 手机和电脑在同一个 tailnet 里就能连，不管在同一个 Wi-Fi 还是外网
- 手机端**不需要装 Tailscale App**——HARNESS Phone 的 APK 内置了 tsnet，在 App 里登录一次即可

> App 端自 2.x 起只支持内置 Tailscale，1.x 的「局域网直连 / 手动填 IP」已经移除。
> 桥接本身仍监听 `0.0.0.0`，所以局域网里的浏览器还是能打开配对页。

## 配置

状态文件：`~/.dsh/phone-bridge.json`

```json
{
  "port": 8765,
  "host": "0.0.0.0",
  "pairingCode": "123456"
}
```

- 改端口 / 换配对码：改完**重启 DSH**
- 想只给局域网用、不暴露到 Tailscale：把 `host` 改成具体网卡地址，比如 `192.168.1.10`

## 防火墙

首次运行时 Windows 会弹「是否允许」，选**专用网络**允许即可。没弹窗但连不上，检查入站规则里 8765 端口。

## 卸载

插件 → 已安装插件 → `dsh-phone-bridge` → 卸载，重启 DSH。
状态文件 `~/.dsh/phone-bridge.json` 可以留着（下次装回来还是同一个配对码），也可以删掉。

## 说明与限制

- 插件活在 DSH 进程里：**DSH 没运行就没有监听**，这是和独立桥接程序唯一的体验差别
- 如果 8765 被别的程序占用，插件只会在日志里报错、不会让 DSH 启动失败；改端口即可
- 界面适配 DSH 0.2.x，靠 DOM 选择器定位元素，DSH 大版本升级后可能需要跟进
- 手机端需要配套的 APK（`HARNESS Phone`），只装插件也可以在安卓浏览器里直接访问

## License

MIT，见 [LICENSE](LICENSE)。

社区项目，与 DeepSeek 官方无隶属关系；DeepSeek Harness 本身以 MIT 协议开源。
