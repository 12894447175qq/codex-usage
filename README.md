# Codex 用量 · Edge 扩展

按北京时间、日期和模型展示 Token 与估算美元费用，支持 7 天、30 天、自定义范围及堆叠/分组柱状图。本目录独立于已有 Rewards 自动化。

## 安装（macOS）

需要 Node.js 20+、npm/npx、Microsoft Edge。

```sh
cd /Users/xiaolongyitiao/project/auto
node codex-usage/native/install.mjs
```

在 Edge 扩展管理页 `edge://extensions` 打开开发者模式，点击“加载解压缩的扩展”，选择本目录的 `extension` 文件夹。将“Codex 每日用量”固定到 Edge 工具栏，点击其图标会在图标下方打开 780×600 的统计浮窗，不再新建标签页。浮窗内可滚动查看两张图表和明细；点击外部会关闭浮窗。首次打开自动同步，同步由后台继续执行，再次打开复用进行中的请求。

已加载旧版时，在 Edge 扩展管理页点击本扩展的“重新加载”，再点击工具栏图标即可使用新入口。不要用 `file://` 直接打开 HTML，该方式没有扩展通信能力。

移动项目或更换 Node 安装路径后，重新运行安装脚本。当前仅提供 macOS 注册脚本。

## 数据来源与更新

本地程序调用以下命令，提取 `agents` 中的 Codex 分组。该统一报表包含逐模型费用；当前版本的 `codex daily` 仅提供每日总费用。

```sh
npx --yes ccusage@latest daily --by-agent --json --timezone Asia/Shanghai
```

统一报表会探测其他代理的本地日志，桥接层只保存和返回 Codex 汇总，不保存其他代理结果或对话正文。不读取账号密钥，也不请求官方账单。统计范围以 ccusage 能识别的本机日志为准；它不是整个账号跨设备用量。

每天首次同步查询 npm 最新版，再以解析出的版本执行；不是长期锁定版本。手动“检查更新”可立即重试。新版输出必须通过日期、数值、模型/每日汇总检查才启用；新版失败回退最近成功版本。全部失败则保留旧数据并显示错误。打开页面和点击刷新会同步；未打开浏览器时不运行后台计划任务。

价格由 ccusage/LiteLLM 提供。费用为 API 等价估算，非订阅实际扣费；Fast、长上下文、模型映射、价格历史等行为由 ccusage 决定。新模型缺价、回退标志或非零 Token 零费用时，显示未知费用，不当作免费。更新价格可能改变历史估算，不属于账单快照。

默认缓存目录 `~/.codex-usage-edge/`，包含汇总、版本状态和主机启动脚本；原始会话不复制。上游程序与价格更新需要联网。主机仅接受本扩展的缓存/同步请求，不开放 HTTP 端口或任意命令执行接口。超过单次通信容量的报告会报错并保留缓存。

## 验证

```sh
node --test codex-usage/native/*.test.mjs
node codex-usage/native/host.mjs --sync --check-update
```

第二条会输出真实本机汇总（不要公开分享个人使用数据）。界面验收：日期与模型筛选、两种柱状图布局、明细合计、断网保留上次结果。首次无数据时应提示错误，不展示虚构数字。

2026-09-09 验证：6 项 Node 测试通过，覆盖汇总校验、未知价格、版本回退、每日检查、失败缓存保留及 Native Messaging 分帧。真实日志同步获得 20 个有记录的日期；独立 Edge 测试配置中完成主机通信、两张图表、模型筛选及布局切换验证。日常 Edge 仍需用户按上文手动加载扩展：浏览器自动化安全策略禁止访问扩展管理页。

## 卸载

在 Edge 移除扩展；删除 `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.codex.usage.json` 即解除本地主机注册。可选删除 `~/.codex-usage-edge/` 以清除缓存。不会修改 Codex 日志。

参考：[ccusage Codex](https://ccusage.com/guide/codex/)、[JSON 输出](https://ccusage.com/guide/json-output)、[Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)。
