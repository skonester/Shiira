# Website sign-in compatibility

Shiira applies browser compatibility at startup, without a user setting:

- Disable Blink's `AutomationControlled` indicator before Electron is ready,
  and retain that setting on tab webviews and native site popups.
- Keep the installed Chromium version and real operating-system identity,
  removing Electron and Shiira product tokens from the browser user agent.
  Chromium supplies its own client hints and language headers.
- Let Electron create website login and requested popup windows in the
  originating page's session. This preserves `window.opener`, the returned
  `WindowProxy`, cross-origin `postMessage`, referrers, form POST bodies,
  named windows, and blank windows that navigate later.
- Keep each popup in the source profile, including background and private
  tabs. The native window shows its current address. Site popups remain
  sandboxed and isolated, with Node integration and the browser UI bridge
  unavailable to website scripts.

The old OAuth modal canceled the original popup and loaded its URL in an
unrelated webview. It could lose the opener, submitted data and source
profile. Native site popups replace that flow. Regular new-tab links still
open in Shiira's tab strip; the main process owns popup decisions for tabs
and Peek.

Implementation: `src/main/browser-compatibility.js` and the popup/session
handling in `src/main/main.js`.

## Verification

`npm run test:auth:electron` exercises the real application with two local
origins and disposable profiles. It checks browser identity, cross-origin
messages, popup self-close, nested windows, explicit `noopener`, blank-window
redirects, form POSTs, profile/private isolation, regular link routing and
cleanup when the opener tab closes. The existing runtime smoke test also
checks browser startup, sandboxed preloads, passwords and extensions.

To check Google's initial email form and Scira's real **Continue with Google**
redirect, set `SHIIRA_AUTH_LIVE=1` for the authentication smoke test. This enters
no credentials and does not verify a completed Google login. Reports explicitly
include `realProviderLoginVerified: false`. Set
`SHIIRA_SMOKE_APP_ROOT` to an absolute packaged `resources/app.asar` path to
run the same checks against a Windows build.

Providers still make their own sign-in decisions. Google documents
[restrictions on embedded-browser sign-in](https://support.google.com/accounts/answer/7675428).
Fixture success establishes browser behavior; completing a real provider
login, MFA or a passkey flow needs a manual check in the release build.

## Scira / Google investigation

Google's "This browser or app may not be secure" rejection was reported after
selecting **Continue with Google** on Scira in the installed compatibility
build. The installed application's compatibility code matched the source.
The same Scira login was reported working in Magnetite on this machine.

Scira redirects the existing tab to Google, so its flow does not exercise the
popup fix. Disposable-profile checks reach Google's email form without entering
an account. Both engines expose `navigator.webdriver === false` and native
Chromium client-hint brands. Magnetite uses `Chrome/156.0.0.0`, whereas Shiira
uses `Chrome/156.0.8078.75`. A candidate matching
[Chromium's UA reduction](https://www.chromium.org/updates/ua-reduction/) was
tested against the actual Scira account login. It still received the same
insecure-browser rejection. The candidate UA change was reverted.

The real Little Shiira feature was also tested through
`ShiiraBrowser.openLittleWindow('https://scira.ai/sign-in')`, using the packaged
application and a disposable profile. Its Google button rendered, and the
test confirmed the Little window used `persist:main`. The user reported the
same insecure-browser rejection there. Little reuses Electron webviews and
does not supply Magnetite's CEF Chrome runtime, so routing sign-in through
Little is not an established fix.

Google login remains unresolved. The exact browser check responsible for the
rejection has not been established. Do not treat initial-form or local-fixture
success as evidence that the rejection has been resolved.
