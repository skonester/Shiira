# Litube playback source audit

Reviewed November 14, 2026 against the supplied
`C:/Users/admin/Desktop/Litube-master` tree and Shiira's working source.

Litube delegates its central player protocol to **MediaServiceCore v1.0.0**.
Its dependency declaration is in `gradle/libs.versions.toml`; reading the Android
adapter alone does not cover that implementation. The upstream tag resolves to
`68f2f6a10dedf0842cbc99fa79d84bf1bfd9b21f`, which was used for this review.

## Confirmed differences corrected

| Code examined | Litube behavior | Shiira before this audit | Correction |
| --- | --- | --- | --- |
| MSC `PlayerReadiness.kt`, lines 3–36 | Prefer pre-content ad slots; inspect legacy placements otherwise; unknown fulfillment estimates 15 seconds; cap the total at 30 seconds. | Only legacy placements with a recognized instream duration produced a hold. Forecasting ads and modern slots could produce zero. | Ported slot precedence, bounded traversal, skip offsets, `length_seconds`, and the unknown-duration estimate. |
| `PlaybackLoadErrorPolicy.kt`, lines 28–52; `YoutubeHttpDataSource.kt`, lines 151–155 | A temporary 403 retains the media deadline and retries the existing source. | The earlier request handling existed, but missed deadline metadata bypassed it. Separate preload timers could unload a merely buffering player. | Completed metadata handling and removed timed first-frame/buffering source replacement. Network deadlines and terminal Shaka errors own recovery. |
| `AdaptiveClientOrder.kt`, lines 3–22; MSC `PlayerAttempt.kt` | Actual refused media defers the exact client for the same video/identity for 30 seconds. It remains a final candidate. | Any source recovery could exclude the selected client, including ordinary transport failures. | Backend refusal tracking now drives deferral; the preload does not accuse a client based on a generic player error. |
| MSC `PlayerChallenges.kt`, lines 5–46 | Solve the VOD HLS manifest's path-bound `n`, as well as format challenges. | HLS URLs were returned unchanged. | Solve `/n/...` before returning a VOD HLS source. |
| `AndroidChallengeSolver.kt`, lines 50–85; MSC `CachedPlayerSolver` | Share/cache challenge results bound to script revision and arguments. | Concurrent representations could repeatedly evaluate identical extracted solver code. | Coalesce equal evaluations and cache successful results by source/argument hash; failures remain retryable. |
| MSC `PlayerRequest.kt`, WEB_SAFARI profile | WEB requests with Safari identity; media retains the same identity. | IOS was described as a substitute for WEB_SAFARI. They are different clients. | Added a separate WEB_SAFARI route. IOS remains an additional fallback. |
| `PlaybackEngine.kt`, first-frame listener and diagnostics | Rendering evidence is separate from play intent and buffering. | A `playing` event could promote a client without decoded-frame evidence. | Require `requestVideoFrameCallback` from Shiira's closed-shadow video, bound to the current opaque source URI. Main-process validation rejects old-source/native confirmations. |
| Shiira's Shaka networking contract | HTTP status and elapsed transfer time inform retries and bitrate estimation. | The plugin reported every success as `timeMs: 0` and flattened HTTP status into a generic error. | Let Shaka measure transfer time; use its HTTP-status error shape for HTTP failures. |

The request layer retains the same opaque handle, URL, range, and client through
readiness retries. Its GET-to-POST compatibility request is attempted only for
eligible adaptive media after readiness, with the same URL and range. Successful
POST transport is reused for later ranges. Cancellation still aborts pending work.

## Concrete response observed

An anonymous backend read for the public video `zh9yOE1eiY8` returned `OK`,
48 adaptive formats, no HLS URL, and a start placement containing
`clientForecastingAdRenderer`. The former duration reader would assign no hold
to that placement. The corrected reader retained approximately 15 seconds.
This sanitized shape is covered by the adapter regression test.

The initial anonymous VISIONOS read was refused with a bot-verification response.
WEB and IOS returned format metadata. WEB_EMBEDDED and the television/VR routes
did not establish playback in that read. These were protocol reads, **not proof
that any replacement player decoded those media URLs**.

## Remaining implementation gaps

The changes above do not make Shiira a complete port of Litube:

- `YoutubeSessionProvider.kt` freezes the actual browser/account/visitor/player
  configuration and distinguishes account changes from harmless page-config
  refreshes. Shiira still primarily uses locally generated YouTube.js sessions
  with the tab's cookies for applicable API clients.
- `PoTokenProvider.kt` and `MscPlayback.TokenAdapter` mint separate player, media,
  and subtitle tokens with video/visitor/account binding. Shiira has no equivalent
  BotGuard minter. A WEB response containing formats does not establish that
  token-gated media will remain readable.
- MSC `PlaybackSession.mergeFloor` obtains an ANDROID `reel_item_watch` muxed
  floor. This is different from making an ordinary ANDROID_VR `/player` request.
  Shiira has no equivalent muxed-floor playback path.
- `MediaSourceResolver.kt` chooses between trusted adaptive streams, HLS,
  remote DASH, muxed floor, and audio-only sources. Its window-exemption checks
  and media-request plans are richer than Shiira's DASH/HLS-only selection.
- TV_TIZEN's authenticated device/capability posture is not implemented.
- Litube's byte-cache keys bind object id, revision, itag, track and length;
  rotating signed URLs can reuse proven bytes. Shiira currently retains Shaka's
  existing buffered source during DOM changes, but does not port this disk cache.
- Litube has distinct bounded light refresh, full session/token refresh and
  existing-source backup paths. Shiira retains a single bounded source refresh.

These gaps remain relevant when a direct client is bot-checked or a web client
requires proof-of-origin tokens. A successful test using fabricated media cannot
close them. A native YouTube picture on screen cannot establish success for the
replacement player either.

## Review coverage

The review followed the playback path statement by statement through these
production files, including their cancellation, failure, and cleanup branches.
This is the playback/extraction path, not an audit of every Android screen.

| Layer | Files reviewed |
| --- | --- |
| Engine and ownership | `player/engine/PlaybackEngine.kt` (all 2,419 lines), `PlaybackAttempt.kt`, `PlaybackTransport.kt`, `PlaybackDiagnostics.kt`, `PlaybackProgress.kt`; `player/PlaybackSession.kt`, `PlaybackLifecycle.kt`; `datasource/PlaybackClaim.kt` |
| Source construction | `MediaSourceResolver.kt`, `DashManifestFactory.kt`, `StreamSelection.kt`, `PlaybackStartup.kt`, `CodecCapabilities.kt`, `SubtitleSelection.kt` |
| Requests and recovery | `YoutubeHttpDataSource.kt`, `PlayerDataSource.kt`, `PlaybackLoadErrorPolicy.kt`, `PlaybackRecovery.kt`, `MediaNotReadyException.kt`, `MediaOpenTimeout.kt`, `YoutubePlaybackCacheKey.kt`, `VodManifestCache.kt` |
| Extraction and identity | `Extractor.kt`, `MscPlayback.kt`, `Resolve.kt`, `MediaPlan.kt`, `Models.kt`, `ExtractionContext.kt`, `ExtractionReadRetry.kt`, `YoutubeExtractionHost.kt`, `YoutubeSessionProvider.kt`, `BrowserPlayerResponses.kt`, `AdaptiveClientOrder.kt`, `WebSession.kt`, `InnertubeAuth.kt`, `MediaCookieIdentity.kt`, `ExtractionDiagnostics.kt` |
| Challenge/runtime/cache | `AndroidChallengeSolver.kt`, `ChallengeEngine.kt`, `JavascriptRuntime.kt`, `RemoteEjsRuntime.kt`, `PoTokenProvider.kt`, `Cache.kt`, `LayeredCache.kt`, `MemCache.kt` |
| MSC dependency | `PlayerClientQueues.kt`, `PlayerAttempt.kt`, `PlayerReadiness.kt`, `PlayerRequest.kt`, `PlayerContext.kt`, `PlayerResponse.kt`, `PlaybackSession.kt`, `PlayerPlayback.kt`, `PlayerOpen.kt`, `PlayerChallenges.kt`, `PlaybackPreference.kt`, `PlaybackRecovery.kt`, `PlayerScriptRead.kt`, `PlayerPost.kt` |
| Shiira integration | `youtube-service.js`, `youtube-playback.js`, `youtube-player.js`, `webview-entry.js`, shared YouTube URL helpers, startup/preload/window handling, and the installed YouTube.js/Shaka contracts those adapters call |

## Home screen and platform compatibility

The supplied white screenshot contains fully rendered home-page content. It
therefore cannot be explained solely as an initial empty BrowserWindow.
Shiira also forced ANGLE/Vulkan, native GPU buffers, zero-copy rendering and a
driver-blocklist bypass on every OS. That override was removed so Chromium can
select the supported platform backend and respect driver restrictions.

The preload dark canvas, non-blocking font activation and paint-gated splash
handoff remain. The exact cause of the user's white surface has not been
confirmed in a live reproduction after these changes. Windows, macOS and Linux
visual/decoder behavior cannot be certified by the offline checks.

## Verification boundaries

Offline tests exercise real YouTube.js response parsing, the forecasting-ad
shape, modern slots, timing/cancellation, request identity, POST compatibility,
challenge coalescing, HLS `n`, client deferral, DOM retention, and the frame/IPC
ownership contract. No synthetic Electron smoke test was run during this audit.
Computer control was not resumed after the user stopped it with Escape.

The source records `source_selected`, `client_failed`, `media_wait`,
`media_failed`, `player_failed`, and `first_frame` events through the app's local
logger. The first-frame event is the minimum evidence for claiming that Shiira's
replacement player rendered; a completed API response is insufficient.

Upstream sources: [PlayerReadiness.kt](https://github.com/HydeYYHH/MediaServiceCore/blob/68f2f6a10dedf0842cbc99fa79d84bf1bfd9b21f/common/src/main/kotlin/com/liskovsoft/youtubeapi/videoinfo/V2/PlayerReadiness.kt),
[PlayerChallenges.kt](https://github.com/HydeYYHH/MediaServiceCore/blob/68f2f6a10dedf0842cbc99fa79d84bf1bfd9b21f/common/src/main/kotlin/com/liskovsoft/youtubeapi/videoinfo/V2/PlayerChallenges.kt),
[PlayerContext.kt](https://github.com/HydeYYHH/MediaServiceCore/blob/68f2f6a10dedf0842cbc99fa79d84bf1bfd9b21f/common/src/main/kotlin/com/liskovsoft/youtubeapi/videoinfo/V2/PlayerContext.kt),
[PlaybackSession.kt](https://github.com/HydeYYHH/MediaServiceCore/blob/68f2f6a10dedf0842cbc99fa79d84bf1bfd9b21f/common/src/main/kotlin/com/liskovsoft/youtubeapi/videoinfo/V2/PlaybackSession.kt).
