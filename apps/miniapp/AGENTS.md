# apps/miniapp — Agent Notes

WeChat mini program. **Native JS, zero npm, zero build.** Architecture and file map live in
`README.md` next to this file; the requirement baseline is `../../docs/prd/miniapp-mvp.md`.
This file only covers two things: **how to verify a change**, and **traps already paid for**.

## 1. Always verify — compiling is not passing

Run everything from `apps/miniapp/`.

```sh
# 1) Offline self-checks (21 suites, plain Node, no devtools needed)
for f in tests/*.check.js; do node "$f" || echo "FAILED: $f"; done

# 2) The real compiler (fixed path on Windows + Git Bash)
WCC="/d/Program Files x86/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec"
"$WCC/wcc.exe" $(cd miniprogram && find . -name "*.wxml") > /tmp/wcc.log 2>&1
grep -cE '\.wxml:[0-9]+:[0-9]+' /tmp/wcc.log          # expect 0

for f in $(cd miniprogram && find . -name "*.wxss"); do
  "$WCC/wcsc.exe" -lc "miniprogram/$f" | grep "^ERR" && echo "ERR $f"
done
```

Three counter-intuitive details:

- `wcsc.exe` **always exits 0**. You must grep the output for `^ERR`.
- `wcc.exe` reports real errors as `file.wxml:line:col`. **Never `grep -i error`** — its generated
  code legitimately contains `console.error` and the string `"not found"`, so that always false-positives.
- After editing sources from the CLI, `touch` the file. The devtools compile incrementally by mtime,
  so a same-second edit can be skipped.

## 2. Hard rules

1. **No `package.json`** anywhere (repo root or `miniprogram/`). No TypeScript.
2. Modules loaded with `require` must be **flat files** — WeChat does not compile `<dir>/index.js`.
3. `require` has no dynamic paths. New question banks must be registered in
   `utils/question-bank-catalog.js` → `BANK_LOADERS`.
4. Layering: Page (wx APIs only) → ViewModel (returns `{ data, command? }`) → Model/utils (pure).
   Repository is the single data exit point. Pages funnel results through `applyViewModelResult()`.
5. WXSS limits: no `*` selector; `.p > :nth-child(1)` must be written `.p > view:nth-child(1)`;
   **`background-image` cannot reference a local file** — base64 or network only. That is why every
   icon in this project is an inlined SVG data URI.
6. **Multiple edits to the same file must be serial.** Parallel edits each apply to their own snapshot
   and silently overwrite each other.

## 3. Traps already paid for

### Custom tabBar (highest risk)

- **It always paints above page content; `z-index` never wins.** Any page-level `position: fixed`
  overlay (`bottom-sheet`, `route-loading`) gets covered.
  Fix: use `bottom-sheet`'s `placement="center"`, and call `getTabBar().setHidden(true)` while an
  overlay is open — with `display: none`, not `opacity: 0` (that stays invisible but still eats taps).
  Every page that hides it must call `setHidden(false)` in `onShow` as a safety net.
- **It reserves no bottom space.** The native tabBar did. Tab pages need
  `padding-bottom: 272rpx` (plus `env(safe-area-inset-bottom)`); `bank-detail` uses
  `height: calc(100vh - 272rpx)`.
- **Selected state does not follow the page.** All four tab pages must call
  `getTabBar().setSelected('<page path>')` in `onShow`, or the highlight sticks to the wrong tab.

### Layout and visuals

- **`mode="aspectFill"` requires the image ratio to equal the container ratio**, otherwise edges are
  cropped. `assets/home/exam-cover.jpg` is cut to the card's 686:320; changing the card height means
  re-running `scripts/prepare-exam-cover.py`. `tests/home-prototype.check.js` decodes the JPEG header
  and asserts the ratio.
- White text over an illustration needs a **darkening veil**, and the gradient must stay opaque across
  the exact horizontal range the text occupies.
- Frosted glass with `blur` alone reads gray — pair it with `saturate()`.
- Stacking a light glyph on a light glyph merges into one blob; separate with a stroke or a value step.
- Tappable elements need `hover-class` **and** `hover-start-time="0"` (the 50ms default swallows quick
  taps). The full feedback rules sit in a comment block in `app.wxss` — read it before changing them.

### Data and import

- **Excel-exported CSV is GBK by default.** The importer only falls back to GBK after seeing U+FFFD.
- Header aliases must stay lowercase (`normalizeHeader` lowercases before matching). An uppercase alias
  silently never matches, which shows up as "every row reports missing options".
- `wx.chooseMessageFile` **can only pick files from WeChat chats**, not the system file picker.
- Parse `textarea` input on `bindblur`, not `bindinput` — the latter re-parses the whole table per
  keystroke and freezes the input.

### WeChat platform

- `getUserProfile` / `getUserInfo` are deprecated. Avatar only via
  `<button open-type="chooseAvatar">` + `saveFileSync` into `wx.env.USER_DATA_PATH`;
  nickname via `<input type="nickname">`.
- `project.config.json` → `useMultiFrameRuntime` **must stay `false`**. When true, in-page `bindtap`
  stops working entirely and compilation still succeeds.

## 4. Generator scripts (edit the script, not the output)

| Script | Purpose |
| --- | --- |
| `scripts/inline-entry-icons.cjs` | Home grid icons; idempotently rewrites base64 in WXSS |
| `scripts/prepare-exam-cover.py` | Countdown card cover: crop + colour + JPEG |
| `scripts/preview-home.cjs` | Renders the real WXSS at 375px; states `configured\|today\|past\|empty\|modal` |
| `scripts/import-question-bank.cjs` | CSV/TSV/JSON → `data/banks/` |
| `scripts/generate-tabbar-icons.cjs` | tabBar icon PNGs |

Preview output goes to `apps/miniapp/.tmp-preview/` (gitignored). Screenshot it with headless Edge
instead of opening the devtools for every visual tweak.

## 5. Git

See `docs/git-workflow.md`. Branch naming is `name/type/description` (personal prefix, e.g.
`curry/feat/...`), merge via PR + squash, **never push to main directly**.
