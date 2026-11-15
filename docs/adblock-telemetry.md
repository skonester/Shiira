# Adblock telemetry

`RequestHandler` owns session-wide network statistics for Ghostery and the
bundled fallback. The old API reported only `RuleEngine` statistics, which
Ghostery never increments. The renderer also fetched those statistics only at
startup and when opening the menu, leaving its counter state at zero.

The network callback now records actual cancellations and Ghostery resource
redirects once. Allowed requests and the YouTube playback/Shorts exemptions do
not increase the blocked count. Additional profile and private sessions use the
same counting path. Cosmetic selectors and page-script messages are not network
requests and do not contribute to this metric.

Each block publishes a `stats-updated` event. The main process sends the snapshot
to browser windows over `adblock-stats-updated`; the preload exposes a removable
subscription. The renderer updates `adblockBlockedCount`, the address-bar badge,
and the menu text together. A monotonic revision also advances on reset, so a
delayed IPC read cannot restore an older count. Closing the renderer releases
its subscription.

The menu uses a grid row for the label and a separate row for the blocked count.
The count takes up layout space, leaving the toggle in its own column. The
address-bar badge is labeled as requests blocked this session, since the metric
spans tabs rather than representing only the current page.

Verify with `npm test` and `npm run test:youtube:electron`. The latter exercises
the real request hook, main/preload/renderer IPC, reset delivery and rendered
menu bounds; its media sources are synthetic fixtures.
