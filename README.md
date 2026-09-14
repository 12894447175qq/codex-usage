# Codex Usage Edge

**English** | [简体中文](README.zh.md)

A Microsoft Edge extension integrating [capisoft-lib/codex_usage](https://github.com/capisoft-lib/codex_usage). Click the toolbar icon for a compact view of Codex tokens, API-equivalent cost, an activity heatmap, and quota history. Use the full-dashboard button to open every upstream dashboard feature in an Edge tab.

## Features

The compact popup keeps the existing focused visual style:

- Today by default, with the last 7 days, last 30 days, and a custom range, grouped in `Asia/Shanghai`.
- Per-model token and cost filters with stacked or grouped bar charts.
- Token totals in units of 100 million with two decimal places: `0.01 亿` means one million tokens; hover shows exact counts.
- A heatmap showing 24 hourly cells for today and daily activity for longer ranges, following the model filter.
- Automatic five-hour and weekly quota observations, including history, reset time, plan, and reset count when available.
- Unknown models retain their token totals and show unknown cost instead of zero cost.

The full dashboard uses upstream `codex_usage` 1.5.1 and retains its existing features:

- Projects, conversations, model calls, turns, duration, tokens, cache rate, API-equivalent cost, and Codex credits.
- Standard/Fast tiers, long-context and historical pricing, plus custom pricing.
- Hourly, daily, monthly, rolling 12-month, all-history, and custom charts with drill-down.
- Current and historical weekly quota periods, five-hour quota, reset boundaries, cumulative use, and end-of-period forecasts.
- Filters for project, model, usage, and conversation name, with nine languages and multiple themes.
- Optional mini desktop window, Docker, headless collector, and self-hosted or OpenAI Sites multi-machine Mesh.

## Data flow

```text
~/.codex/sessions + archived_sessions + session_index.jsonl
                              ↓
capisoft codex_usage incremental collector and dated pricing catalog
                 ↓                         ↓
       compact Edge aggregates       full Edge dashboard
```

The extension does not run `npx ccusage`. Its Native Messaging host starts the upstream local service on `127.0.0.1` when needed. The popup receives only daily, per-model, and hourly aggregates, while the full dashboard keeps the upstream API and behavior intact.

## Requirements

- macOS and Microsoft Edge. The current Native Messaging installer does not yet register Windows, Linux, or Chrome hosts; the retained upstream dashboard remains cross-platform.
- Node.js 20 or newer.
- Git to initialize and update the `vendor/codex_usage` submodule.
- Local Codex session logs, normally under `~/.codex`. Live account quota requires an installed and signed-in Codex CLI or desktop app.

## Install

```sh
git clone --recurse-submodules https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

For an existing checkout, the installer initializes a missing submodule and builds the upstream dashboard assets automatically.

Then:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the repository's `extension` directory.
4. Pin the extension and click its toolbar icon.

The four-tile button starts or reuses the local `codex_usage` service and opens the full dashboard in a new tab. It prefers `http://127.0.0.1:4317` and selects a free local port if that port is occupied.

## Update upstream

```sh
git submodule update --remote vendor/codex_usage
node native/install.mjs
```

Run the tests and commit the updated submodule pointer. The integration validates the upstream `apiVersion`; an incompatible API keeps the last successful popup cache and reports the error.

## Local data and privacy

Extension state lives under `~/.codex-usage-edge/`:

- `history.json`: daily ledger for the compact popup.
- `report.json`: last successful aggregate.
- `quota.json`: five-hour and weekly quota observations.
- `capisoft-usage-snapshot.json`: upstream incremental analysis snapshot.
- `capisoft-runtime.json`: local dashboard process and address.

Local mode does not read `auth.json` and does not send raw JSONL, prompts, responses, reasoning, tool output, or file contents to the extension. The optional Mesh sends minimized signed snapshots only after explicit configuration.

Cost is an API-equivalent estimate, not a ChatGPT subscription bill. Pricing coverage follows the upstream dated catalog; unknown models keep their token usage visible.

## Development and validation

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
npm test --prefix vendor/codex_usage
node native/host.mjs --sync --refresh
```

The extension tests cover upstream conversion, heatmap data, both quota windows, cache fallback, and Native Messaging. Upstream tests cover parsing, pricing, forecasting, languages, Mesh, privacy, and the local service.

## License

This project is released under GNU Affero General Public License v3.0 or later. `vendor/codex_usage` remains an independent Git submodule with its original copyright, branding, and AGPL-3.0-or-later license. Network users can access the corresponding upstream source through the source link in the full dashboard.
