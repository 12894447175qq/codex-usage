# Codex Usage

**English** | [简体中文](README.zh.md)

A compact Microsoft Edge extension that shows local Codex token usage and estimated costs by day and model, powered by [ccusage](https://ccusage.com/).

Click the toolbar icon to open a **560 × 560 popup**. The current popup interface is in Chinese; this repository provides English and Chinese documentation.

## Features

- **Today by default**, with the last 7 days, last 30 days, and a custom date range. Preset ranges include today and use `Asia/Shanghai` time.
- Filter by model, switch between **Token** and **Cost** charts, and choose stacked or grouped bars.
- Token summaries use **亿 (100 million tokens)** with two decimal places: `0.01 亿` means 1 million tokens. Hover over the summary for the exact count.
- Estimated cost summaries use USD with two decimal places; hover for additional precision. Unknown costs are marked separately and excluded from the known subtotal.
- Expand the model details to see non-cached input, cache reads, cache writes, output, total tokens, and estimated costs.
- The first sync builds a local daily history ledger; later syncs read history locally, refresh only today with the dynamically resolved ccusage version, and merge the result into the full report.
- The **Quota** tab shows a daily line chart of the weekly remaining percentage. Record the value read from the usage dashboard or Codex `/status` for the current day.
- A light interface with outlined filters, collapsible details, hover tooltips, and custom 16/32/48/128 px icons.
- Daily ccusage update checks, output validation, version fallback, and preservation of the last successful report when synchronization fails.

## Requirements

- **macOS and Microsoft Edge**. The supplied native-host installer only supports this combination; Windows, Linux, and Chrome installation are not implemented.
- Node.js 20 or later, with `node`, `npm`, and `npx` available in the installation terminal. Upstream ccusage releases may introduce additional runtime requirements.
- Local Codex usage logs that ccusage can recognize. The usual Codex home is `~/.codex`.
- Network access to download/update ccusage and retrieve pricing data.

The extension uses plain HTML, CSS, and JavaScript. No frontend build or `npm install` is required for this repository.

## Installation

Clone the repository and register the local Native Messaging host:

```sh
git clone https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

If you already have the project locally, run the installation command from its root directory.

1. Open `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension` folder.
3. Pin **Codex 每日用量** to the toolbar and click its icon.

The popup first loads the cached report and local history, then synchronizes today. The first run, or a run without a history ledger, reads the complete ccusage report and may take longer while ccusage downloads; later syncs query only today's Beijing-time date and merge it with local history. Clicking outside closes the popup; an ongoing sync is held by the background worker, and reopening the popup reuses it.

Keep the repository in place: the host launcher references its files. If the repository or Node installation moves, rerun `node native/install.mjs`. Opening `dashboard.html` directly through `file://` does not provide extension messaging and is not a supported way to use the app.

## Updating

After updating the repository files, click **Reload** on the extension card in `edge://extensions` to apply popup and icon changes.

The popup's **刷新** button synchronizes usage. The header icon labeled **检查 ccusage 更新** checks for a newer ccusage release immediately; it does not update the extension's own files.

On the first sync of each Beijing calendar day, the host queries npm for the latest ccusage version and runs that resolved version. The first ledger build reads the complete report; with an existing ledger, only today is refreshed and older dates remain local snapshots. Valid output becomes the new report and active version. If a candidate release fails to execute or its output is incompatible, the host attempts the last successful version. If synchronization still fails, the previous report remains available with an error message. No scheduled collection runs while the browser is closed.

## Data and cost semantics

The flow is:

```text
Local logs → ccusage JSON → validation and Codex-only aggregation
           → Native Messaging → Edge popup
```

The host runs the resolved version of `ccusage daily --by-agent --json --timezone Asia/Shanghai`, with an isolated configuration and online pricing enabled. The first run has no date filter; with an existing history ledger it adds `--since today --until today`, then merges today's result into the local history. It extracts only the Codex group from the unified report, which supplies per-model costs.

- The unified ccusage command can discover other coding agents' local logs. This project's bridge stores and returns only Codex aggregates, not other agents' results or conversation bodies.
- Coverage depends on the logs available locally and supported by ccusage. This is **not an account-wide, cross-device usage report**. Blank chart dates mean no local records were found.
- Costs are **API-equivalent estimates, not actual subscription charges**. Pricing and interpretation of Fast mode, long context, model aliases, and historical rates depend on ccusage and its pricing data.
- Missing costs, fallback flags exposed in the model data, and zero costs with nonzero usage are treated as unknown. Pricing updates may change historical estimates; reports are not billing snapshots.
- The bridge checks dates, numeric values, and consistency between model and daily totals. An empty report cannot replace an existing nonempty report. Responses larger than 900,000 bytes are rejected while preserving the cache.

- `~/.codex-usage-edge/history.json` stores daily Codex snapshots, `report.json` stores the merged messaging cache, and `quota.json` stores the last weekly quota snapshot for each day. These files stay local; quota snapshots are never inferred from token usage.
- The official guidance points to the usage dashboard or Codex `/status` for current limits and reset times. This extension does not use an unofficial account endpoint, so the Quota tab asks you to record the percentage you read. See the [official OpenAI documentation](https://learn.chatgpt.com/docs/pricing).

The default local state directory is `~/.codex-usage-edge/`, containing reports, version state, an isolated ccusage configuration, and the host launcher. The bridge does not copy original sessions or request account credentials or official billing records. Native Messaging accepts cache/sync requests from this extension without opening an HTTP server.

## Development and verification

Run these commands from the repository root:

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
```

To check real local synchronization and ccusage updates:

```sh
node native/host.mjs --sync --check-update
```

This prints personal usage aggregates to the terminal. To regenerate the committed SVG and PNG icons, use Python 3; no third-party Python packages are needed:

```sh
python3 scripts/generate-icons.py
```

The nine automated tests cover normalization, unknown prices, inconsistent output, history migration and merging, quota snapshots, version fallback, daily update checks, cache preservation, and Native Messaging framing. The current compact UI has been checked with cached local data for date/model filtering, metric/layout switching, details expansion, and first-screen fit. The Quota tab still needs one real entry through the Edge toolbar after reloading.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Cannot connect to the native host | Rerun `node native/install.mjs` in this checkout and reload the extension. The installer registers the host for macOS Edge. |
| The previous interface or icon is still visible | Reload the extension in `edge://extensions`, then reopen the popup. |
| Synchronization fails | Check network access and the availability of Node/npm/npx; use the CLI sync command above for diagnosis. The local ledger and previous merged report remain available. |
| Costs are unknown or totals seem incomplete | Check the affected models and ccusage pricing support. Unknown costs are not zero-cost usage. |
| The quota chart is empty | Read the weekly remaining percentage from the usage dashboard or Codex `/status`, enter it in the Quota tab, and click **记录今天**. The extension does not guess account limits from tokens. |
| No usage appears | Confirm that local Codex logs contain usage events supported by ccusage. Cloud-only or missing logs cannot be reconstructed by the extension. |

## Uninstall

Remove the extension from Edge and delete its native-host registration:

```text
~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.codex.usage.json
```

Optionally delete `~/.codex-usage-edge/` to remove the history ledger, quota snapshots, cached state, and launcher. Codex logs are not changed.

## References

- [ccusage Codex data source](https://ccusage.com/guide/codex/)
- [ccusage JSON output](https://ccusage.com/guide/json-output)
- [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
