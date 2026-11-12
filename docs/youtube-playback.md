# YouTube playback

YouTube watch, Shorts, live and embedded video pages use Shiira's separate
stream player by default. Browsing, comments and channel pages stay on YouTube.
Hover over the video to find **Reload video** and **Use YouTube player**.

The primary pipeline adapts the supplied Litube v4 source to Electron:

1. Resolve streams through YouTube.js, starting with Litube's VisionOS route.
   Try WEB, WEB_EMBEDDED, IOS, TV and finally ANDROID_VR when a client refuses
   playback or returns an unsupported source. IOS supplies the HLS fallback
   role; YouTube.js does not implement MSC's separate WEB_SAFARI/TV_TIZEN clients.
2. Share in-flight extraction within the tab, cache successful streams for at
   most two minutes (and never beyond their expiry), and reject late results
   from previous video navigations or source recoveries.
3. Play direct DASH video/audio with Shaka's adaptive buffering. Live sources
   use HLS when available. The complete playable track pool remains available
   for automatic quality selection.
4. Fetch media through a separate transient Electron session, using the
   selected client's identity and byte ranges. The tab only receives opaque
   media handles. Cookies, signed upstream URLs and privileged APIs are not
   exposed to website scripts. Signed-in WEB fallbacks use the tab's own
   YouTube cookies; private tabs retain separate identity and caches.
5. Refresh a refused or stalled source once, preserving playback position and
   deferring the failed client. A successful fallback client leads later loads
   in that tab. Stream resolution has an 18-second total deadline, individual
   clients have a five-second deadline, and media requests have a 20-second
   deadline. Failure returns to YouTube's player; there is no reload loop.

Ghostery continues filtering other sites and YouTube's advertising/tracking
requests. YouTube page scriptlets and cosmetic player modifications are skipped,
and player API/media requests are allowed. The legacy experimental YouTube ad
script is no longer injected, even when its old environment flags are set.

The stream player uses Chromium video controls and automatic quality selection.
YouTube-specific controls, captions, cast, purchases/DRM and account-restricted
content can use **Use YouTube player**. That choice lasts for the current video;
the next video attempts the primary pipeline again. Third-party embedded
iframes retain their original YouTube player.

## Build and verify

Source launches compile `src/preload/webview-entry.js` into the sandboxed
`src/preload/webview.bundle.js`. Electron-builder runs the same build in its
`beforePack` hook; no CDN script or runtime esbuild dependency is needed in a
packaged app. Scira's existing source initialization is included in the bundle.

```sh
npm test
npm run test:youtube:electron
npm run test:scira:website:electron
```

The YouTube Electron test decodes synthetic H.264/AAC media through the real
preload, IPC and Shaka path. It checks timestamps, consecutive videos, navigation
races, HTTP 403 recovery, private playback and native fallback. Live-service
verification is opt-in because YouTube availability and bot challenges vary:

```powershell
$env:SHIIRA_YOUTUBE_LIVE='1'
npm run test:youtube:electron
```

Upstream attribution and license copies are in
`THIRD_PARTY_NOTICES/litube-GPL-3.0-NOTICE.txt`.
