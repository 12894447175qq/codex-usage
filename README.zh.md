# Codex Usage Edge

[English](README.md) | **简体中文**

一个集成 [capisoft-lib/codex_usage](https://github.com/capisoft-lib/codex_usage) 的 Microsoft Edge 扩展。点击工具栏图标打开紧凑浮窗，查看 Codex Token 与周额度；点击右上角完整面板按钮，可在 Edge 新标签页使用上游完整仪表盘。

## 功能

紧凑浮窗保留当前轻量 UI：

- 日期快捷切换今天、最近 7 天和最近 30 天，按北京时间 `Asia/Shanghai` 统计。
- 按模型筛选 Token，默认分组柱状图，也可切换堆叠；点击图例可聚焦模型，再次点击恢复全部。
- 模型用量相差较大时自动断轴，以锯齿和边界数值标明分段刻度；点击锯齿或“展开刻度”查看完整线性刻度，可恢复断轴。悬停及模型明细始终显示真实数值。
- Token 按数量自动使用原值、万或亿，避免小额用量显示成零；悬停显示精确数量。
- 记住时间范围、模型、图表布局和额度窗口；移除调用次数／缓存占比汇总和 CSV 导出。
- 点击额度页自动更新；今天／7 天／30 天均按真实采集时间展示范围内全部周额度观测，保留同一天重置后及晚间的变化。重置或缺失日期处断线，标记重置后首次观测；不补造未采到的 100%。不显示实时额度卡片。
- 独立浮窗可拖动标题栏移动、拖动边框缩放，自动记住大小。
- “浮窗”旁的“雷达”按钮在新标签页打开 [Codex Radar](https://codexradar.com/)，独立浮窗中也保留该入口。
- 未识别模型也保留 Token；浮窗与明细仅展示 Token 数据，不计算费用。

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

扩展运行时不调用 `npx ccusage`。Native Messaging 主机按需启动绑定在 `127.0.0.1` 的上游本地服务，浮窗仅接收按天和模型聚合后的数据。完整面板保持上游原有接口和功能。

## 环境要求

- macOS 与 Microsoft Edge 116 或更高版本。当前 Native Messaging 安装脚本尚未实现 Windows、Linux 和 Chrome 注册流程；上游完整面板本身仍保留跨平台实现。
- Node.js 20 或更高版本。
- Git，用于初始化和更新 `vendor/codex_usage` 子模块。
- 本机存在 Codex 会话日志，通常位于 `~/.codex`；实时账户额度还需要已安装并登录的 Codex CLI 或桌面应用。

## 安装

```sh
git clone --recurse-submodules https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

已有仓库无需手工初始化子模块；安装脚本会在缺失时执行初始化，应用仓库内的上游价格补丁，并生成本地仪表盘资源。重复安装会识别已应用的补丁；若与本地改动冲突，会停止并保留原文件。

然后：

1. 在 Edge 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择仓库中的 `extension` 文件夹。
4. 将扩展固定到工具栏并点击图标。

浮窗右上角“打开独立浮窗”按钮打开可移动、可缩放的窗口；四宫格按钮会启动或复用 `codex_usage` 本地服务，并在新标签页打开完整面板。默认地址为 `http://127.0.0.1:4317`；端口被占用时会选择可用端口。

## 更新扩展

在 `edge://extensions` 找到“Codex 每日用量”，点击重新加载并确认版本 `0.10.2`，关闭并重新打开已有浮窗。本次无需重新安装本地主机，原有统计账本与额度历史继续保留。首次升级使用分组柱图，之后继续记住所选布局。详见 [0.10.2 更新说明](UPGRADE-0.10.2.md)。

## 更新上游

```sh
git submodule update --remote vendor/codex_usage
node native/install.mjs
```

价格修改以 [`patches/codex-usage-pricing.patch`](patches/codex-usage-pricing.patch) 随主仓库发布，基于当前锁定的子模块版本。更新上游前应先保存并整合子模块内的修改，避免丢失补丁；上游变化导致冲突时，安装脚本会停止，不会强行覆盖。整合后更新补丁、运行测试并提交新的子模块版本指针。扩展会校验上游 `apiVersion`，接口不兼容时保留上次成功缓存并显示错误。

## 本地数据与隐私

扩展状态保存在 `~/.codex-usage-edge/`：

- `history.json`：紧凑浮窗的按日历史账本。
- `report.json`：上次成功聚合结果。
- `quota.json`：5 小时和每周额度观测。
- `capisoft-usage-snapshot.json`：上游增量分析快照。
- `capisoft-runtime.json`：本地面板进程和地址。

本地模式不会读取 `auth.json`，不会把原始 JSONL、提示词、回答、推理、工具输出或文件内容传给扩展。完整面板的可选 Mesh 功能只有在显式配置后才会发送最小化、签名后的统计快照。

完整面板中的费用是 API 等价估算，不是 ChatGPT 订阅账单。价格覆盖取决于上游历史价格目录；未知模型不会丢失 Token。

## 开发与验证

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
# 可选：已安装 Playwright 和 Edge 时，验证真实页面交互（本地模拟数据）
node scripts/test-popup.mjs
npm test --prefix vendor/codex_usage
node native/host.mjs --sync --refresh
```

前两组检查验证 Token 聚合、筛选、断轴映射与展开交互、汇总及 CSV 功能移除、旧偏好迁移、额度窗口、缓存回退和 Native Messaging；上游测试验证日志解析、价格、预测、多语言、Mesh、隐私和本地服务。

## 许可证

本项目按 GNU Affero General Public License v3.0 or later 发布。`vendor/codex_usage` 是独立 Git 子模块，保留其原始版权、品牌和 AGPL-3.0-or-later 许可证。网络用户可通过完整面板中的源码入口访问对应源码。
