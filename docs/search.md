# Search inside Shiira

Home tabs, address-bar searches, command-bar web searches, and selection searches use the selected provider. API credentials are optional: with a configured key, Shiira can display API answers and sources inside its search tab; without one, it opens that provider's website in the same tab. Scira searches open `scira.ai` with the original `q` and selected `group`, including Reddit. Shiira also initializes the website's active sources before its scripts submit the query. API failures also fall back to Scira itself. Shiira never silently substitutes a different provider for Scira.

The `brave`, `scira`, and `duckduckgo` Tab to Search shortcuts also use the internal results page. Other site-specific shortcuts such as YouTube and GitHub still open those sites' search pages. Internal search pages use the home-tab surface; webpage results continue to support split view.

Startpage's engine option, autocomplete requests, defaults, preconnections and renderer permissions have been removed. An existing Startpage engine selection migrates to Brave Search. User bookmarks and ordinary browsing URLs are unaffected.

## Setup

Open **Settings → Search** and paste your own Brave Search or Scira API key, then select **Save key**. Keys are stored through the operating system keychain using `keytar`. Saved keys are not returned to the renderer, written to localStorage, or included in session files. Removing a key removes the saved keychain entry.

Enter also saves a key. A save is confirmed only after the keychain returns the saved value. If saving fails, the input keeps the entered key for another attempt. Credential status and the last API error appear in Search settings. A configured key means it is stored, not that the provider has accepted it. Missing, unreadable or rejected keys do not block website searches or force users through a key form.

**Settings → General → Home page** controls the Home button, new tabs, and startup when a previous tab is not restored. Bare domains such as `google.com` are saved as HTTPS URLs. With **Continue where you left off** enabled, restored tabs keep their saved pages. Private tabs and internal API search pages continue to use Shiira's built-in surface.

For development or managed installations, the main process also supports `BRAVE_SEARCH_API_KEY` and `SCIRA_API_KEY`. A saved keychain key takes priority over the corresponding environment variable. Removing a saved key leaves an environment-provided key active, and Settings identifies it as such. No shared API keys are bundled in the app, and no subscriptions are created automatically.

Packaged builds use the same keychain and environment lookup as development. A local `.env` file is not bundled or implicitly loaded; set environment variables before starting the application, or save a key in Settings. Credential diagnostics report presence and source only, never the key itself. This integration uses the REST API rather than MCP.

The APIs require credentials and apply their own access limits and billing; ordinary website searches do not require a key in Shiira. Obtain API credentials from the [Brave API dashboard](https://api-dashboard.search.brave.com/) or [Scira API platform](https://api.scira.ai/). Brave Autosuggest access may require a separate enabled product on the key. See the official [Brave authentication guide](https://api-dashboard.search.brave.com/documentation/guides/authentication), [Autosuggest guide](https://api-dashboard.search.brave.com/documentation/services/suggest), and [Scira API reference](https://api.scira.ai/docs).

## Providers

| Provider | In-app results | API contract |
| --- | --- | --- |
| Brave Search | Ranked web results, snippets, spelling corrections, and **More results** pagination | `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token` header. Ten results per page, offsets 0–9. |
| Scira AI — Web | Generated answer and source links | `POST https://api.scira.ai/api/search`, `x-api-key` header, `messages: [{ role: "user", content: query }]`. |
| Scira AI — Reddit | Answer, source links and discussion excerpts when provided | `POST https://api.scira.ai/api/reddit`, `x-api-key` header, `query` body. |
| Scira AI — X | Answer and post sources when provided | `POST https://api.scira.ai/api/xsearch`, `x-api-key` header, `query` body. |
| Scira AI — People | Profile name, bio and website/social links | `POST https://api.scira.ai/api/people`, `x-api-key` header, `query` body. |
| DuckDuckGo Quick | Instant answers and related topics, with no key | `GET https://api.duckduckgo.com/?q=...&format=json&no_html=1&skip_disambig=1`. This is not a full web-search results API, and many queries have no instant answer. |

The Brave contract follows its [Web Search reference](https://api-dashboard.search.brave.com/api-reference/web/search/get). Scira's endpoint bodies and normalized responses follow its [API reference](https://api.scira.ai/docs). Scira's web-app autocomplete route was also inspected on [GitHub](https://github.com/zaidmukaddam/scira/blob/main/app/api/suggest/route.ts); it proxies DuckDuckGo suggestions and is not used as an AI search API.

## Behavior and privacy

- API calls run in the main process using an isolated Electron `session.fetch` transport. This uses [Chromium networking](https://www.electronjs.org/docs/latest/api/net), including its proxy and certificate behavior, instead of Node's global fetch. Cookies are omitted and the API session is separate from webpages and their request-filtering hooks. Calls remain bounded, cancelable and limited to fixed provider endpoints.
- Missing/rejected keys, rate limits, server errors, unreadable responses, timeouts and connection failures open the selected provider's website. Scira uses `https://scira.ai/?q=...&group=reddit` for a Reddit query, and the corresponding group for other scopes. No API key is put in the URL. A missing key causes no API network request and no key-entry gate. Scira's own website controls its account requirements, limits and any verification steps. Canceling or submitting invalid input does not open a website.
- Scira's deployed website sends `enabledGroups` independently of its `group` URL parameter. The URL alone can submit `group: "reddit"` with `enabledGroups: ["web"]`. A credential-free, isolated webview preload sets `scira-selected-group` and `scira-delegate-enabled-groups` for explicit Web, Reddit and X searches before page scripts run. It also turns off the website's saved multi-agent override for that explicit search. It runs only on the exact HTTPS Scira origin, root search route and supported group; ordinary Scira pages, existing chat URLs, subframes and other sites retain their preferences. The website contract needs to be checked against the deployed site as well as the public source.
- After a Scira server or unreadable-response failure, further requests for that scope and key pause for one minute. A failed Web request does not prevent a Reddit request. Authentication and quota errors apply to all scopes. Explicit retry makes another request; success clears that scope's pause, and saving/removing a key clears all pauses. There are no automatic paid retries.
- A second search replaces the first request. A late response cannot replace a newer query or another tab's results. Different search tabs retain their own answers during the session.
- Clicking a provider chip runs the current query with that provider immediately; with an empty input it just selects the provider and focuses the input. Scira scope changes rerun the current query too. The selected scope is saved for new tabs and restarts; existing search tabs retain their own scope. Home Enter/submit, address-bar searches, Scira shortcuts, retries, restored URLs, and website URL builders all carry the scope. Website URLs use Scira's `group` parameter. Switching to another engine does not reset the Scira scope to Web. Repeated clicks on an identical in-flight search do not send duplicate requests.
- DuckDuckGo's Instant Answer API serves JSON with a legacy `application/x-javascript` content type. Shiira accepts that type only for the DuckDuckGo endpoint and still uses strict JSON parsing, so JavaScript and JSONP are never evaluated.
- The API service distinguishes rejected credentials from server failures and preserves a bounded, credential-redacted error and safe request ID when available. HTTP 500 is not treated as an invalid key. Website sign-in cookies are not used for API authentication. Google sign-in on Scira's website is a separate flow and can be blocked in Electron; a website fallback does not imply that the API key is invalid.
- Search tabs can restore their query/provider with session restore enabled. Answers are not stored in the session, and reopening a restored search requires **Search again** before another API request is sent.
- Private searches stay out of saved sessions. Result links and automatic website fallbacks retain private browsing. Background responses leave the active tab and address bar alone. Private address/command bars do not request online suggestions.
- Normal address/command bars use official Brave Autosuggest only when online suggestions are enabled and the key has access. Scira and DuckDuckGo Quick retain local history suggestions. The provider can still apply API authentication, quotas and service limits; Shiira does not bypass them.

## Verification

Run `npm test` for request contracts, response normalization, key handling, website fallback URLs and error paths, cancellation, race handling, private suggestions and internal search URLs.

Run `npm run test:search:electron` for the real main/preload/renderer flow using an isolated temporary profile and in-memory keychain. Fixture responses intercept the API partition's HTTPS protocol, so the test exercises the production Electron `session.fetch` transport rather than replacing it with Node fetch. It operates the native scope selector, Enter and submit button, and verifies the endpoint, JSON body and credential headers. It checks that a no-key search opens Scira with `q` and `group`, with no API request, key form, settings gate or provider substitution. Rejected keys and server failures stay on Scira too. It also checks scope restoration, pauses, retries, pagination, narrow layouts and private sessions. Layout captures go to `tmp/search-smoke/`; the temporary profile is removed. It makes no authenticated live requests and spends no API credits.

Run `npm run test:settings:electron` to exercise the settings controls across two separate Electron launches. It checks homepage save/reset, startup and new tabs, download/update preferences, and Brave/Scira key save, use after restart, and removal. It uses a temporary profile, temporary entries in the real OS keychain, and fixture API responses. The runner removes the profile and test credentials when finished and writes its result to `tmp/settings-smoke/result.json`.

Run `npm run test:scira:website:electron` to verify website submission bodies through the actual homepage and webview preload, including stale Web/multi-source preferences, switching back to Web, private X searches and API-error fallback to Reddit. Its local website fixture reads active sources in the first page script, so a late `dom-ready` injection cannot pass. To check Scira's currently deployed scripts, set `SHIIRA_SCIRA_WEBSITE_LIVE=1` for this command. Live mode loads public website assets and cancels search POSTs before they reach Scira; it does not read real keys or perform authenticated searches. The result includes the website's actual `group` and `enabledGroups` in `tmp/scira-website-smoke/result.json`.

`SHIIRA_SEARCH_SMOKE_APP_ROOT` can point to a packaged `resources/app.asar` to exercise the shipped code and dependencies.
