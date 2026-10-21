# Codex Usage Edge

**English** | [简体中文](README.zh.md)

A Microsoft Edge extension integrating [capisoft-lib/codex_usage](https://github.com/capisoft-lib/codex_usage). Click the toolbar icon for a compact view of Codex tokens and weekly quota history. Use the full-dashboard button to open every upstream dashboard feature in an Edge tab.

## Features

The compact popup keeps the existing focused visual style:

- One-click date presets for today, the last 7/30 days, grouped in `Asia/Shanghai`.
- Per-model token filters with grouped bars by default and an optional stacked layout; click a legend item to focus a model or restore all models.
- Automatic axis breaks make large model differences readable. Zigzags and boundary labels identify separate linear scales; click a break or the expand button for the full linear axis, then restore breaks. Tooltips and model details always show real values.
- Token totals automatically use raw counts, ten-thousand, or hundred-million units; hover shows exact counts.
- Opening the weekly quota tab automatically updates its data. Today and the last 7/30 days show every stored observation at its actual capture time, preserving intraday resets and subsequent consumption. Resets and missing days break the line; the first observed point after a reset is marked. Unobserved 100% points are never fabricated. Live quota cards are omitted.
- Open a separate popup window, drag its title bar to move, and drag its edges to resize. Window size is remembered.
- The radar button beside the separate-window button opens [Codex Radar](https://codexradar.com/) in a new tab. It is also available in the separate window.
- Unknown models retain their token totals. The popup and model details show token statistics without cost calculations.

- Filter preferences persist across popup sessions. Call-count/cache-percentage summaries and CSV export have been removed.

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

The extension does not run `npx ccusage`. Its Native Messaging host starts the upstream local service on `127.0.0.1` when needed. The popup receives only daily and per-model aggregates, while the full dashboard keeps the upstream API and behavior intact.

## Requirements

- macOS and Microsoft Edge 116 or newer. The current Native Messaging installer does not yet register Windows, Linux, or Chrome hosts; the retained upstream dashboard remains cross-platform.
- Node.js 20 or newer.
- Git to initialize and update the `vendor/codex_usage` submodule.
- Local Codex session logs, normally under `~/.codex`. Live account quota requires an installed and signed-in Codex CLI or desktop app.

## Install

```sh
git clone --recurse-submodules https://github.com/12894447175qq/codex-usage.git
cd codex-usage
node native/install.mjs
```

For an existing checkout, the installer initializes a missing submodule, applies the bundled upstream pricing patch, and builds the dashboard assets automatically. Reinstalling recognizes an already-applied patch; conflicting local changes stop installation without overwriting files.

Then:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the repository's `extension` directory.
4. Pin the extension and click its toolbar icon.

The separate-window button opens a movable, resizable popup. The four-tile button starts or reuses the local `codex_usage` service and opens the full dashboard in a new tab. It prefers `http://127.0.0.1:4317` and selects a free local port if that port is occupied.

## Update extension

Reload “Codex 每日用量” in `edge://extensions`, check version `0.10.2`, and close/reopen existing popup windows. The existing native host installation and local history remain usable. The first upgrade selects grouped bars; later layout choices remain saved. See [0.10.2 update notes (Chinese)](UPGRADE-0.10.2.md).

## Update upstream

```sh
git submodule update --remote vendor/codex_usage
node native/install.mjs
```

Pricing changes ship with the main repository as [`patches/codex-usage-pricing.patch`](patches/codex-usage-pricing.patch), based on the pinned submodule revision. Preserve and integrate local submodule changes before updating upstream. The installer stops on patch conflicts rather than overwriting files. Update the patch, run the tests, and commit the updated submodule pointer after integration. The integration validates the upstream `apiVersion`; an incompatible API keeps the last successful popup cache and reports the error.

## Local data and privacy

Extension state lives under `~/.codex-usage-edge/`:

- `history.json`: daily ledger for the compact popup.
- `report.json`: last successful aggregate.
- `quota.json`: five-hour and weekly quota observations.
- `capisoft-usage-snapshot.json`: upstream incremental analysis snapshot.
- `capisoft-runtime.json`: local dashboard process and address.

Local mode does not read `auth.json` and does not send raw JSONL, prompts, responses, reasoning, tool output, or file contents to the extension. The optional Mesh sends minimized signed snapshots only after explicit configuration.

Cost in the full dashboard is an API-equivalent estimate, not a ChatGPT subscription bill. Pricing coverage follows the upstream dated catalog; unknown models keep their token usage visible.

## Development and validation

```sh
node --test native/*.test.mjs
node --check extension/dashboard.js
node --check extension/background.js
# Optional: requires Playwright and Edge; exercises the popup with local fixtures.
node scripts/test-popup.mjs
npm test --prefix vendor/codex_usage
node native/host.mjs --sync --refresh
```

The extension tests cover upstream conversion, filtering, axis-break mapping and interactions, summary/CSV removal, legacy preference migration, both quota windows, cache fallback, and Native Messaging. Upstream tests cover parsing, pricing, forecasting, languages, Mesh, privacy, and the local service.

## License

This project is released under GNU Affero General Public License v3.0 or later. `vendor/codex_usage` remains an independent Git submodule with its original copyright, branding, and AGPL-3.0-or-later license. Network users can access the corresponding upstream source through the source link in the full dashboard.
