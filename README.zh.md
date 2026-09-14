# Codex Usage

[English](README.md) | **简体中文**

一个紧凑的 Microsoft Edge 扩展，基于 [ccusage](https://ccusage.com/) 按日期、模型展示本地 Codex 的 Token 用量和估算费用。

点击工具栏图标即可打开 **560 × 560 浮窗**。当前浮窗界面为中文，仓库提供中英文两份说明文档。

## 功能

- **默认展示今天**，可选最近 7 天、最近 30 天和自定义日期。预设范围包含今天，统一使用北京时间 `Asia/Shanghai`。
- 按模型筛选，通过 **Token／费用**页签切换图表，支持堆叠和分组柱状图。
- Token 汇总使用**亿**作为单位，保留两位小数：`0.01 亿` 表示 100 万 Token。悬停可查看精确数量。
- 估算费用以美元显示，汇总保留两位小数，悬停可查看更高精度。未知费用单独标记，不计入已知费用小计。
- 展开模型明细，可查看非缓存输入、缓存读取、缓存写入、输出、总 Token 和估算费用。
- 首次同步建立本地按日历史账本；之后优先读取本地历史，只用动态获取的 ccusage 版本刷新今天，再合并为完整报告。
- **额度**页签按天展示周剩余百分比折线图，可记录从使用面板或 Codex `/status` 读到的当天剩余值。
- 浅色界面、描边筛选框、折叠明细、悬停提示，以及专门绘制的 16／32／48／128 像素图标。
- 每日检查 ccusage 更新，校验输出，支持版本回退；同步失败时保留上次成功结果。

## 环境要求

- **macOS 和 Microsoft Edge**。现有本地主机安装脚本仅支持这一组合，尚未实现 Windows、Linux 和 Chrome 的安装流程。
- Node.js 20 或更高版本，安装时的终端中可使用 `node`、`npm`、`npx`。上游 ccusage 新版本可能提出额外运行环境要求。
- 本机存在 ccusage 能识别的 Codex 用量日志，通常位于 `~/.codex`。
- 可联网下载、更新 ccusage 并获取价格数据。

扩展使用原生 HTML、CSS 和 JavaScript，本仓库不需要前端构建或执行 `npm install`。

## 安装

克隆仓库并注册本地 Native Messaging 主机：

```sh
git clone https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

如果本机已有项目，直接在项目根目录执行安装命令即可。

1. 在 Edge 中打开 `edge://extensions`。
2. 开启**开发人员模式**，点击**加载解压缩的扩展**，选择仓库内的 `extension` 文件夹。
3. 将 **Codex 每日用量**固定到工具栏，点击图标打开浮窗。

浮窗会先读取已有缓存和本地历史，再同步今天的数据。首次运行或没有历史账本时会读取完整 ccusage 报表，可能需要等待下载；后续同步只查询北京时间今天，再与本地历史合并。点击浮窗外部会关闭浮窗；进行中的同步由后台工作线程持有，再次打开会复用该请求。

安装后请保留项目目录，本地主机启动脚本会引用其中的文件。移动项目或更换 Node 安装路径后，重新执行 `node native/install.mjs`。通过 `file://` 直接打开 `dashboard.html` 不具备扩展通信能力，不是受支持的使用方式。

## 更新

更新仓库文件后，在 `edge://extensions` 中点击扩展卡片的**重新加载**，使界面和图标变更生效。

浮窗的**刷新**按钮用于同步用量；顶部标注为**检查 ccusage 更新**的图标按钮用于立即检查 ccusage 新版本，不会更新扩展自身文件。

每个北京时间自然日的首次同步会向 npm 查询 ccusage 最新版本，再运行查询到的版本。首次建立账本时读取完整报表；已有账本时只刷新今天，旧日期使用本地快照。通过校验的结果成为新报告，该版本成为当前可用版本。候选版本执行失败或输出不兼容时，会尝试最近成功版本；仍失败则保留旧报告并提示错误。浏览器关闭时不运行定时采集。

## 数据来源与费用口径

数据流程：

```text
本地日志 → ccusage JSON → 校验并提取 Codex 汇总
         → Native Messaging → Edge 浮窗
```

本地主机使用查询到的 ccusage 版本执行 `daily --by-agent --json --timezone Asia/Shanghai`，采用独立配置并启用在线价格获取，从包含逐模型费用的统一报表中提取 Codex 分组。首次同步不带日期范围；已有历史账本时追加 `--since 今天 --until 今天`，再将今天结果合并进本地历史。

- ccusage 统一报表可能发现其他编程代理的本地日志。本项目的桥接层仅保存并返回 Codex 汇总，不保存其他代理结果或对话正文。
- 覆盖范围取决于本机保留的日志和 ccusage 的支持情况，**不代表整个账号跨设备用量**。图表中空白日期表示未发现本地记录。
- 费用是 **API 等价估算，不是订阅实际扣费**。价格以及 Fast 模式、长上下文、模型别名和历史费率的解释取决于 ccusage 及其价格数据。
- 缺少费用、模型数据中暴露的回退标志，以及有用量但费用为零的情况，按未知费用处理。价格更新可能改变历史估算，报告不是账单快照。
- 桥接层校验日期、数值以及模型和每日汇总的一致性。空报告不会覆盖已有非空报告；响应超过 900,000 字节时会拒绝该结果并保留缓存。

- `~/.codex-usage-edge/history.json` 保存按日 Codex 快照，`report.json` 保存合并后的通信缓存，`quota.json` 保存每天最后一次周额度快照。文件仅保存在本机，额度快照不会由 Token 用量推算。
- 官方说明建议从使用面板或 Codex `/status` 查看当前限制和重置时间；本扩展没有使用非公开账号接口，因此“额度”页签需要手工记录当天读到的百分比。参考 [OpenAI 官方说明](https://learn.chatgpt.com/docs/pricing)。

默认状态目录为 `~/.codex-usage-edge/`，包含汇总报告、版本状态、独立 ccusage 配置和主机启动脚本。桥接层不会复制原始会话，也不会请求账号凭据或官方账单。Native Messaging 仅接受来自本扩展的缓存／同步请求，不开放 HTTP 服务。

## 开发与验证

在仓库根目录运行：

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
```

验证本机真实同步及 ccusage 更新：

```sh
node native/host.mjs --sync --check-update
```

该命令会在终端输出个人用量汇总。若需重新生成已提交的 SVG 和 PNG 图标，使用 Python 3 即可，无需第三方 Python 包：

```sh
python3 scripts/generate-icons.py
```

现有 9 项自动化测试覆盖数据规范化、未知价格、异常输出、历史账本合并与迁移、额度快照、版本回退、每日更新检查、缓存保留和 Native Messaging 分帧。当前紧凑界面已用本地缓存数据验证日期／模型筛选、指标／布局切换、明细展开和首屏尺寸。额度页签还需在重新加载后通过实际 Edge 工具栏录入一次数据验证。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 无法连接本地采集程序 | 在当前项目目录重新执行 `node native/install.mjs`，然后重新加载扩展。安装脚本为 macOS Edge 注册本地主机。 |
| 仍显示旧界面或旧图标 | 在 `edge://extensions` 中重新加载扩展，再打开浮窗。 |
| 同步失败 | 检查网络及 Node／npm／npx 是否可用；使用上面的命令行同步命令排查。历史账本和上一次合并报告仍可查看。 |
| 费用未知或合计不完整 | 检查相关模型及 ccusage 的价格支持；未知费用不代表免费用量。 |
| 额度图表为空 | 从使用面板或 Codex `/status` 读取周剩余百分比，在“额度”页签输入并点击“记录今天”；扩展不会根据 Token 猜测账号额度。 |
| 没有用量数据 | 确认本机日志包含 ccusage 支持的用量事件。扩展无法还原仅存在于云端或已缺失的日志。 |

## 卸载

在 Edge 中移除扩展，并删除本地主机注册文件：

```text
~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.codex.usage.json
```

可选删除 `~/.codex-usage-edge/`，清除历史账本、额度快照、缓存状态和启动脚本。Codex 日志不会被修改。

## 参考资料

- [ccusage Codex 数据源](https://ccusage.com/guide/codex/)
- [ccusage JSON 输出](https://ccusage.com/guide/json-output)
- [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
