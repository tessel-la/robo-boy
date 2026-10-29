# Native Plotting migration

## Using the panel

The **Plotting** panel was previously named **Time Series**. Add **Plotting** from the standard panel menu, then open **Settings → Add ROS topic**.
Up to eight numeric fields are selected automatically; use **Add another field** to choose a
detected path or type a custom nested/indexed path. Configure up to 16 signals. A legend click
hides or shows a signal; settings retain its source, color, label, unit, filter and math.

Drag a rectangle to zoom both axes, or scroll/pinch to zoom. **More → Pan** makes dragging pan;
Ctrl-drag and middle-drag also pan. **More** contains zoom buttons, CSV export and clear.
The floating **Live** button resets zoom and resumes capture; double-click, Home or Escape
restore the configured window and Y range without changing pause. Tab to the canvas for keyboard zoom.
Hover or touch to inspect nearest samples in the legend. Inspection freezes a bounded copy
of history while acquisition continues. **Pause** freezes captured history while filters
continue updating; **Clear** also resets processing. **CSV** exports the displayed capture
(including hidden signals) with timestamps, source identity and processed values.

Each signal supports raw, moving-average (2–500 samples), and EMA smoothing. Under **Math
and derived signal**, use **Duplicate as derived signal** to keep the original curve.
Expressions support x, y, z, w, numbers, `pi`, `e`, parentheses, + - * / ^ and abs, sqrt,
sin, cos, tan, asin, acos, atan, atan2, exp, log, log10, sign, floor, ceil, round, pow,
hypot, min, max, clamp, deg and rad. For example `x - y` compares measured and commanded
values, `sqrt(x^2 + y^2 + z^2)` is the speed of a velocity vector, and
`deg(atan2(2*(w*z + x*y), 1 - 2*(y^2 + z^2)))` is yaw from a quaternion. y, z and w each
reference another configured signal's **raw** field, including hidden signals; the settings
show a picker for each one the expression uses. Their latest values must be no older than the
time window; output follows x arrivals, without interpolation or extrapolation. Expressions
never execute JavaScript. Normalization maps a fixed input range to 0–1 without clamping;
derivatives use backward differences and integrals use the trapezoidal rule in seconds.

The plot uses the same floating pill-menu and round-icon design as BT, TF and 3D panels.
On mobile, signals occupy one horizontally scrollable legend row. Mode, axis selection and extra actions use the existing **More** menu. Settings adapt to tile width. Plot/performance settings control
retention (1–600 seconds), per-signal capacity (100–10,000 samples), bridge throttle (0–2,000 ms),
rendering (5–60 Hz), point markers and automatic/manual Y. Edits save with the workspace and
travel with exported layouts. Filter/math/source edits clear affected history; label/color/
visibility edits retain it. Native panels use the same trusted ROS connection as other built-ins.

## XY plots

Choose **More → Plot mode → XY plot**, then explicitly choose an **X signal**. Each visible
signal other than X becomes a Y curve. Settings under **XY settings** choose **Trajectory**
(ordered lines) or **Scatter** (points). The X axis uses the selected signal's processed values
and unit; the ordinary math/filter pipeline applies to both axes. Existing capture limits,
zoom, pan, pause, legend visibility and CSV controls remain available. XY CSV exports
`series,time_ms,x,y`, preserving each Y sample's original panel-clock time.

**Same message only** is the default: X and Y must have been processed from the same incoming
message. Equal timestamps on separate messages are not sufficient. For different topics,
explicitly choose **Latest X within tolerance** and set **Maximum X age (ms)** (0–2,000 ms).
Pairing follows Y arrivals, uses only a preceding X within that age, never uses a future X,
and never crosses connection epochs. Unmatched Y samples create gaps in trajectories.
The clock is live reception time or the existing replay playback clock, not `header.stamp`;
this is not acquisition-time sensor synchronization. A hidden X stays subscribed while it
is the XY axis. Removing X leaves the axis unselected rather than choosing a replacement.

## Interval statistics

Open **More → Interval statistics** to inspect a frozen copy of captured history while
acquisition continues. In time-series mode the initial interval is the visible time range;
in XY mode it is the captured time span. **Start (s)** and **End (s)** are relative to the
first sample in that capture. Statistics include every finite processed sample in the inclusive
interval, before drawing/decimation: count, minimum, maximum, mean, RMS, population standard
deviation and last-minus-first change (**Change**). They are sample-weighted, not time-weighted.
A signal without samples shows a count of zero and unavailable values. Reversed bounds show
an error. Closing statistics leaves the capture frozen; **Reset / Live** resumes the live view.
Retention and sample capacity bound this analysis; it does not scan the full recording.

The saved configuration is schema 5. Versions 1–4 migrate to the existing time-series mode;
`timeSeries`, the legacy external-panel mapping and workspace storage identities remain
unchanged. The new mode/pairing settings save and export with the existing panel state. Mode,
axis and display changes preserve captured source buffers. There is no new backend or chart
library. The engine attaches tile-local message/connection identity to its bounded samples;
XY pairing is a cached linear merge over those samples. Dense XY drawing samples points in arrival order without reordering trajectory turns; statistics and CSV retain every captured sample. FFT and cross-panel cursor/zoom
synchronization remain separate increments.

## Assistant control

The AI assistant can configure an open Plotting panel through its settings bridge
(`assistantSettings.ts`): add, remove, hide, relabel and recolour signals, derive curves
("plot /odom speed squared"), combine up to four signals with an expression, set smoothing,
scale, offset, normalization, derivative or integral, and change the time window, sample
limit, Y axis, points, throttle and render rate, or pause and clear. It can also select `mode`, `xSignal`, `xyPairing`, `xyToleranceMs` and `xyStyle` through the same validated configuration. A field that is not yet
plotted can be named as `{topic, fieldPath}` and is added as a hidden input.

Each turn the model sees every signal's status: plotting (with sample count and latest value),
waiting for an input, no samples yet, or "sample limit reached", which says how much of the
window is actually kept. Changes go through the same validation as the settings: a wrong field
path on a topic the panel has already seen is refused with the closest real fields, an
expression that does not compile or names an input without a signal is refused, and clamped
values are reported as clamped. Changes save with the workspace like any settings edit.

## Baseline and architecture (before implementation)

Branch `feat/native-time-series` starts at dev `88b7f1b` after a fast-forward pull.
Inspected the external sibling repository's README and all four implementation files
(`config.ts`, `data.ts`, `subscriptions.ts`, `index.ts`) plus its tests.

Preserve: 16 independently configured signals across topics; first-message discovery
(up to eight automatic fields, nested/indexed paths, telemetry before timestamps);
manual fields; labels, units, colors, hide/show and remove; raw/MA/EMA filters;
arrival timestamps; pause that keeps processors current; clear; long-form CSV;
time window, sample cap, bridge throttle, render rate, auto/manual Y, point markers;
v1/v2/v3 saved settings; one subscription per topic/type; reconnect and inactivity cleanup.

Native ownership: catalog registration and workspace normalization own migration from
`la.tessel.roboboy.timeseries` to `timeSeries`, including saved/imported/mobile tiles.
React owns controls, configuration, discovery and errors. A panel-local engine owns
bounded buffers and incremental processors. Canvas draws at a capped rate; callbacks
never put streaming samples into React state. ROSLIB subscriptions are reconciled by
topic/type/throttle and released on inactive/disconnected/unmounted panels. Native
panels use the application's ROS connection and trust model, not iframe permissions.
Existing external state is read from `panelState.values.config`; native state stays
in the same workspace storage/export lifecycle. No new chart dependency.

## PlotJuggler reference review

Reviewed upstream commit `c3077496c37c85f0457eda8f4404c3dc3a42be3a` at
https://github.com/facontidavide/PlotJuggler :

- `pj_plotting/widget/src/PlotZoomer.cpp`: rectangle selection, minimum drag size.
- `pj_plotting/widget/src/PlotWidgetBase.cpp`: left-drag zoom, modified/middle-drag
  pan, wheel magnification, zoom reset and axis limits.
- `pj_plotting/widget/src/CurveTracker.cpp`: time cursor and per-curve readouts.
- `pj_datastore/src/builtin_transforms.cpp`: incremental derivative, suppress first
  output until a previous sample exists.
- README and scripting sources: derived series and reusable analysis configuration.

Implement these interaction patterns independently using browser pointer events,
including touch selection and pinch, keyboard zoom/reset, and visible controls.
Keep expressions deliberately small (arithmetic, x/y and common scalar functions),
with no eval, scripting runtime or code copied from PlotJuggler. Reuse Robo-Boy's
workspace panels instead of adding PlotJuggler's separate docking/layout system.
XY plots, file replay and general Lua/Python plugins are outside this migration.

## Implementation sequence and invariants

1. Port and test data/config/subscription primitives; extend schema to v4 with math.
2. Engine: validate before processing; bounded memory; filters O(1); derive on the
   primary topic's arrival using the latest raw secondary value within the time
   window. Missing/stale secondary samples produce no output. No dependency cycles:
   expressions refer to raw source fields, never another derived output.
3. Native React settings and canvas. A duplicate signal creates a derived curve
   without losing the original. Pipeline: expression x/y, scale + offset, operation
   (identity, fixed-range normalization, derivative or trapezoidal integral), filter.
   Derivative/integral time is seconds. Pause retains history but processes arrivals.
   Source/math/filter edits reset affected history; presentation edits preserve it.
4. Register and migrate workspace tiles, retaining IDs/layout/settings. Zoom holds a
   bounded snapshot for inspection while live capture continues. Reset returns live.
5. Prove data math, expression safety, subscriptions, migrations, settings and canvas
   gestures in tests; build/typecheck; verify desktop/mobile layouts and a multi-topic
   high-rate workload. Record results below after implementation.

## Verification and completion audit

Verified on the feature branch using the current source and the installed Chrome browser:

| Requirement | Evidence |
| --- | --- |
| Updated dev and isolated branch | Fast-forward to `88b7f1b`, branch `feat/native-time-series` |
| Baseline inspection and PlotJuggler research before implementation | Baseline inventory and upstream file/commit references above |
| Native catalog, workspace lifecycle and migration | `builtInPanels.test.ts`, `MainControlView.test.tsx`, `TimeSeriesPanel.test.tsx`; browser migration/reload and native add-panel tests |
| Preserve multi-topic, field discovery/custom fields, labels/units/colors/visibility, filter and plot settings | Ported config/data tests, streaming engine tests, browser multi-topic/derived/settings restoration and field-removal/throttle tests |
| Drag zoom, zoom out/reset, pan, wheel, keyboard and touch | Geometry tests plus browser rectangle/wheel/pan/reset, touch selection and pinch tests |
| Filtering and math | Parser safety/precedence tests; scale, offset, normalization, derivative, trapezoidal integral, x/y freshness and hidden dependency tests; browser derived-curve output |
| Automatic/manual Y and legend | In-window visible-series range tests; browser manual range/point marker controls and legend toggling |
| Performance and bounded retention | 64,000-arrival engine test; 16-topic 200 Hz browser workload; capacity checks and draw-rate instrumentation |
| Native responsive settings, long names and themes | 390px mobile overflow assertions, settings/plot screenshots, desktop light/dark/Solarized theme checks; inert covered controls and focus restoration |
| Pause/clear/CSV, maximum capture | Pause/filter-state and clear tests, browser download, 160,000-sample CSV regression test |
| Reconnect, inactivity, close and persistence | Subscription controller and component lifecycle tests; browser removal verifies subscriptions reach zero; same-tile layout-state restoration test |

- Full unit suite: **151 files passed, 1,102 tests passed, 10 existing skips**.
  Two subsequent catalog/maximum-CSV regressions also pass; final targeted run:
  **66 passed, 8 existing skips** across eight files.
- Native browser suite: **5 passed**. The follow-up custom-field/removal/throttle scenario
  also passes after migrating the retired external test.
- Browser streaming measurement: **12,800 messages across 16 topics in 4.06 seconds**,
  244 animation frames (~60 Hz), 76 canvas draws (<20 Hz), maximum observed animation
  gap 16.8 ms, bounded history of 3,200 samples. Settings remained interactive.
- Production web build, TypeScript, scoped ESLint, configuration syntax and diff whitespace checks pass.
- Removed the obsolete iframe Plotting test and its pinned CI artifact checkout;
  Hello and WebRTC remain external tests. No new runtime dependencies.

These checks use simulated rosbridge traffic and Chrome desktop/mobile emulation. Physical
ROS devices and packaged iOS/Android shells were not exercised. Real throughput depends on
message size, source rates and device capabilities; sample and rendering limits remain user-controlled.
