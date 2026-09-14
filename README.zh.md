# Codex Usage Edge

[English](README.md) | **简体中文**

一个集成 [capisoft-lib/codex_usage](https://github.com/capisoft-lib/codex_usage) 的 Microsoft Edge 扩展。点击工具栏图标打开紧凑浮窗，查看 Codex Token、API 等价费用、使用热力图及额度；点击右上角完整面板按钮，可在 Edge 新标签页使用上游完整仪表盘。

## 功能

紧凑浮窗保留当前轻量 UI：

- 默认展示今天，可选最近 7 天、最近 30 天和自定义日期，按北京时间 `Asia/Shanghai` 统计。
- 按模型筛选 Token 和费用，支持堆叠／分组柱状图。
- Token 使用“亿”为单位并保留两位小数，`0.01 亿` 表示 100 万 Token；悬停显示精确数量。
- 热力图在今天展示 24 小时活跃度，多天范围展示每日活跃度，并跟随模型筛选。
- 自动读取 5 小时和每周额度，保存打开／刷新时的历史观测、重置时间、套餐和重置次数。
- 未识别模型保留 Token，费用明确显示为未知，不按零费用处理。

完整面板直接使用上游 `codex_usage` 1.5.1，保留其现有功能：

- 项目、会话、模型调用、轮次、耗时、Token、缓存率、API 等价费用和 Codex credits。
- Standard／Fast、长上下文和历史价格计算，可配置自定义价格。
- 小时、每日、每月、12 个月、全部历史和自定义日期图表，支持点击下钻。
- 当前与历史周额度周期、5 小时额度、提前／免费重置边界、累计消耗和周期末预测。
- 按项目、模型、用量和会话名称筛选，支持九种语言及多套主题。
- 可选桌面小窗、Docker、无界面采集器、自托管或 OpenAI Sites 多机 Mesh 汇总。

## 数据流程

```text
~/.codex/sessions + archived_sessions + session_index.jsonl
                              ↓
capisoft codex_usage 增量采集器与历史价格目录
                 ↓                         ↓
      Edge 紧凑浮窗聚合结果         Edge 完整面板
```

扩展运行时不调用 `npx ccusage`。Native Messaging 主机按需启动绑定在 `127.0.0.1` 的上游本地服务，浮窗仅接收按天、模型和小时聚合后的数据。完整面板保持上游原有接口和功能。

## 环境要求

- macOS 与 Microsoft Edge。当前 Native Messaging 安装脚本尚未实现 Windows、Linux 和 Chrome 注册流程；上游完整面板本身仍保留跨平台实现。
- Node.js 20 或更高版本。
- Git，用于初始化和更新 `vendor/codex_usage` 子模块。
- 本机存在 Codex 会话日志，通常位于 `~/.codex`；实时账户额度还需要已安装并登录的 Codex CLI 或桌面应用。

## 安装

```sh
git clone --recurse-submodules https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

已有仓库无需手工初始化子模块；安装脚本会在缺失时执行初始化，并生成上游本地仪表盘资源。

然后：

1. 在 Edge 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择仓库中的 `extension` 文件夹。
4. 将扩展固定到工具栏并点击图标。

浮窗右上角四宫格按钮会启动或复用 `codex_usage` 本地服务，并在新标签页打开完整面板。默认地址为 `http://127.0.0.1:4317`；端口被占用时会选择可用端口。

## 更新上游

```sh
git submodule update --remote vendor/codex_usage
node native/install.mjs
```

更新后应运行测试并提交新的子模块版本指针。扩展会校验上游 `apiVersion`，接口不兼容时保留上次成功缓存并显示错误。

## 本地数据与隐私

扩展状态保存在 `~/.codex-usage-edge/`：

- `history.json`：紧凑浮窗的按日历史账本。
- `report.json`：上次成功聚合结果。
- `quota.json`：5 小时和每周额度观测。
- `capisoft-usage-snapshot.json`：上游增量分析快照。
- `capisoft-runtime.json`：本地面板进程和地址。

本地模式不会读取 `auth.json`，不会把原始 JSONL、提示词、回答、推理、工具输出或文件内容传给扩展。完整面板的可选 Mesh 功能只有在显式配置后才会发送最小化、签名后的统计快照。

费用是 API 等价估算，不是 ChatGPT 订阅账单。价格覆盖取决于上游历史价格目录；未知模型不会丢失 Token。

## 开发与验证

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
npm test --prefix vendor/codex_usage
node native/host.mjs --sync --refresh
```

前两组检查验证扩展聚合、热力图数据、双额度窗口、缓存回退和 Native Messaging；上游测试验证日志解析、价格、预测、多语言、Mesh、隐私和本地服务。

## 许可证

本项目按 GNU Affero General Public License v3.0 or later 发布。`vendor/codex_usage` 是独立 Git 子模块，保留其原始版权、品牌和 AGPL-3.0-or-later 许可证。网络用户可通过完整面板中的源码入口访问对应源码。
