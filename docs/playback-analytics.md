# Local YouTube playback analytics

Shiira now uses the supplied FastPix Shaka analytics adapter, version 1.0.7,
with a local event sink. Its media listeners, rendition extraction, Shaka state
inspection, networking filter and ad-manager adapter run against Shiira's actual
replacement player in the isolated preload. The FastPix cloud core is replaced;
this integration does not upload reports, set tracking cookies, or need a
Workspace Key. The underlying Shaka Player library is retained.

Hover over a YouTube video and choose **Playback stats**. The panel shows the
current source, resolution, audio language, startup, watch time, rebuffering,
seeks, pending seek duration, buffer ahead, dropped frames, request outcomes,
HTTP 403 count and source recovery count. Choose **Save JSON report** to save
the full report through Shiira's save dialog. Reports remain in memory until
exported; nothing is automatically written to the browsing profile.

## Measurements

| Field | Meaning |
| --- | --- |
| `metrics.startupMs` | Time from mounting the replacement player to its first confirmed decoded frame. Includes source resolution and loading. Absent until a frame is confirmed; a play event alone does not set it. |
| `metrics.watchMs` | Observed wall time during advancing playback. Seeking, paused time, loading and recovery do not add watch time. Buffered playback continuing behind a failed overlay remains observable. |
| `metrics.rebufferCount`, `rebufferMs` | Waiting/stalled episodes after the first frame, excluding startup, paused time and seek waits. |
| `metrics.seekCount`, `seekCompleted`, `seekMs`, `seekPendingMs` | Media seek episodes after a source's first frame, completed seek duration, and the age of an unfinished seek. Internal startup/resume seeks are excluded. Multiple target changes during an unfinished seek can remain one episode. |
| `metrics.recoveries`, `sourceLoads` | Explicit wrapper recovery and load attempts. Source refresh keeps the same analytics view. |
| `metrics.errorCount`, `criticalErrorCount` | Shaka errors and terminal unhandled errors, with numeric code/category/severity. Load/attach rejections are also recorded by phase. |
| `metrics.variantChanges`, `upshifts`, `downshifts` | Actual active-rendition bitrate changes, excluding the first rendition and duplicate adaptation events. |
| `state` | Current time, finite duration, buffer ranges and buffer ahead, seekable window, decoded dimensions, frame counters, bitrate estimate, active codecs/language, rate and pause/seek/failure flags. Unknown/unsupported values are omitted. |
| `transport.requests` | Main-process media operations, including their final success/failure/cancellation. In-memory generated manifests are excluded. |
| `transport.httpAttempts`, `httpStatuses` | Actual HTTP responses within those operations, including GET-to-POST attempts and readiness/redirect retries. A recovered GET 403 still appears even when POST succeeds. |
| `transport.recent` | Recent operations with byte range, itag when present, bytes transferred, total elapsed time, final method/status and individual response-header timings. |

The failure flag is independent of the observed media state. A player that shows
an error while its remaining buffered video advances, or a failed player stuck
seeking with an empty buffer, retains both facts in the report.

Snapshots publish every two seconds and at load/frame/error/recovery/failure/end
milestones. Seek events are timed immediately in the preload and appear in the
next snapshot. Metrics span source refreshes, while frame and rendition state
describe the current source. A report is diagnostic evidence, not proof that a
403 has been repaired.

## Storage and ownership

The main process keeps at most 30 views, each with 400 recent events, 180 state
samples, 150 recent media operations, 40 format summaries and 20 source entries.
Aggregate counters survive trimming. Each view has its video, source attempts,
start/end time and private-mode marker. Private-mode reports are also kept only
in memory unless the user explicitly exports one.

The IPC receiver checks the owning webview's main frame, current video, source
URI, analytics session and increasing sequence. Browser chrome can list/read/
export only reports belonging to its own window. Raw signed URLs, cookies,
response headers, token values and Shaka `error.data` strings are excluded from
the report schema. The page receives no analytics API or loader global.

The browser chrome preload exposes `shiiraAPI.playbackAnalytics.list()`,
`.get(id)` and `.export(id)` for local inspection. Those APIs are not exposed to
YouTube's page world.

## Verification and provenance

`npm test` covers real adapter callbacks/cleanup, duration classification,
unfinished seeks after failure, rendition changes, transport attempts, export,
bounded retention, sanitization and source/frame/window ownership.
`npm run test:youtube:electron` checks production preload/IPC/Shaka reports while
decoding and seeking fixture media, and saves `tmp/youtube-smoke/playback-analytics.json`.

`npm run test:youtube:live:electron` also saves the production collector's report
to `tmp/youtube-live-smoke/playback-analytics.json`, alongside its independent
test samples and seek assertions. It returns failure when real playback or seek
checks fail, even when analytics capture succeeds.

The vendored code is in `src/preload/vendor/shaka-player-analytics`; its README
lists the local changes. These include fixing the supplied adapter's media
listener teardown and unregistering its network filter. Its MIT license is
retained in `THIRD_PARTY_NOTICES/fastpix-shaka-analytics-MIT.txt`.
