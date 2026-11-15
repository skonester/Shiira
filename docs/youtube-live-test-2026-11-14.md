# YouTube real-network test — November 14, 2026

Overall result: **failed**. The replacement player passed the minute-duration
target, but seeking beyond the buffered content failed on real YouTube media.
The earlier synthetic fixture checks do not establish reliable network playback.

Tested the supplied [ksMN3cZR8D4 video](https://www.youtube.com/watch?v=ksMN3cZR8D4)
in Shiira's production main/preload/Shaka pipeline using an isolated, signed-out
profile. No resolver, manifest or media responses were replaced with fixtures.
The title returned was **Coffeezilla did not deserve this..**, duration
982.349 seconds (16:22). This URL is a recorded video; active livestream/DVR
behavior was not tested.

The iOS client provided DASH media with English audio. Two decoded-frame IPC
confirmations came from Shiira's closed-shadow replacement video at 1920×1080.
The native YouTube video remained paused near time zero. The test used decoded
frame counters, video events, buffered/seekable ranges and media request results.
It changed `currentTime` on that same video to exercise the media seeking path.

| Check | Observed result |
| --- | --- |
| Minute-duration target | 63.12 seconds of decoded progress during a 65.53-second observation; video reached 1:04.01. This included one source refresh and two terminal errors, so playback was not uninterrupted. |
| Backward seek | Target 0:34.25; settled and resumed at 0:34.71. |
| Forward seek outside the buffer | Target 2:04.89; timed out after 20 seconds. |
| Rapid scrubbing | Six targets from approximately 1:40 to 3:45, ending at 2:19.89; timed out. |
| Paused seek | Target 1:34.89; timed out before it could settle or test resume. |

After the failed seeks, `buffered` was empty, `readyState` was 1,
`seeking` remained true and `playbackRate` was 0. Frame count stopped advancing.
The replacement overlay was marked failed and showed its unavailable state.

The final run recorded 295 media operations: 200 completed, 90 failed and five
were cancelled. HTTP 403 persisted after GET-to-POST compatibility attempts.
Failures affected both audio formats and multiple video formats. The initial
VisionOS route required verification; web routes did not produce a supported
manifest. Recovery returned to iOS, since the other clients were unavailable,
and encountered the same media refusal. Shaka reported critical network error
1001 twice; the wrapper spent its single source refresh and then marked failure.

The immediate observed failure is missing media data following HTTP refusals.
The test does not establish why YouTube refused those requests, or prove that
changing seek listeners can repair stream authorization or source identity.
The transport/source-selection and recovery path still needs work. No production
playback fix was applied in this testing follow-up.

Reproduce:

```sh
npm run test:youtube:live:electron -- "https://www.youtube.com/watch?v=ksMN3cZR8D4"
```

The harness records each seek independently and returns a failing status when
terminal player errors occur, any seek fails, or the overlay remains failed.
Full samples are saved to `tmp/youtube-live-smoke/result.json`. This run was
also retained as `tmp/youtube-live-smoke/ksMN3cZR8D4-2026-11-14.json`.
The ordinary Node suite still passed all 223 tests.

## Follow-up with the local analytics integration

A later run using the production FastPix-derived local collector passed the
minute and all four seek scenarios. VisionOS supplied DASH successfully in that
run, whereas the failing run above exhausted its alternatives and used iOS.
This client-availability change does not establish that iOS media refusal is
fixed, and the analytics integration makes no such claim.

The independent test observed 65.69 seconds of decoded progress with no source
refresh or terminal errors. The local report measured 1.07-second first-frame
startup, four completed seek episodes, no rebuffering, and 68 completed HTTP
operations with zero failures. It recorded 1080p60 VP9 video and English AAC
audio. The report is retained at
`tmp/youtube-live-smoke/playback-analytics-ksMN3cZR8D4-2026-11-14.json`.
Metric definitions and usage are in [local playback analytics](playback-analytics.md).
