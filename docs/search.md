# Search inside Shiira

Home tabs, address-bar searches, command-bar web searches, and selection searches try the provider API first. They call APIs from the main process and display answers and source links in the current home/search tab. If Brave or Scira's API is unavailable, Shiira automatically searches that provider's website in the same tab with the original query. Following an inline result opens its website in a tab.

The `brave`, `scira`, and `duckduckgo` Tab to Search shortcuts also use the internal results page. Other site-specific shortcuts such as YouTube and GitHub still open those sites' search pages. Internal search pages use the home-tab surface; webpage results continue to support split view.

Startpage's engine option, autocomplete requests, defaults, preconnections and renderer permissions have been removed. An existing Startpage engine selection migrates to Brave Search. User bookmarks and ordinary browsing URLs are unaffected.

## Setup

Open **Settings → Search** and paste your own Brave Search or Scira API key, then select **Save key**. Keys are stored through the operating system keychain using `keytar`. Saved keys are not returned to the renderer, written to localStorage, or included in session files. Removing a key removes the saved keychain entry.

For development or managed installations, the main process also supports `BRAVE_SEARCH_API_KEY` and `SCIRA_API_KEY`. A saved keychain key takes priority over the corresponding environment variable. Removing a saved key leaves an environment-provided key active, and Settings identifies it as such. No shared API keys are bundled in the app, and no subscriptions are created automatically.

Both services require API credentials and apply their own access limits and billing. Obtain them from the [Brave API dashboard](https://api-dashboard.search.brave.com/) or [Scira API platform](https://api.scira.ai/). Brave Autosuggest access may require a separate enabled product on the key. See the official [Brave authentication guide](https://api-dashboard.search.brave.com/documentation/guides/authentication), [Autosuggest guide](https://api-dashboard.search.brave.com/documentation/services/suggest), and [Scira API reference](https://api.scira.ai/docs).

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

- API calls are bounded, cancelable and limited to the fixed provider endpoints. Search results render as text with validated HTTP/HTTPS source links, rather than provider-supplied HTML.
- For Brave and Scira, missing/rejected keys, rate limits, server errors, unreadable responses, timeouts and connection failures automatically open the same provider's website search. No second click is needed, and only the query is put in the URL; API keys never leave the main process. Scira's website fallback uses its general web search, including when an API-specific scope was selected. Canceling or submitting invalid input does not open a website. DuckDuckGo Quick stays inline and shows a retry action if its API fails.
- A second search replaces the first request. A late response cannot replace a newer query or another tab's results. Different search tabs retain their own answers during the session.
- Clicking a provider chip runs the current query with that provider immediately; with an empty input it just selects the provider and focuses the input. Scira scope changes rerun the current query too. Repeated clicks on an identical in-flight search do not send duplicate requests.
- DuckDuckGo's Instant Answer API serves JSON with a legacy `application/x-javascript` content type. Shiira accepts that type only for the DuckDuckGo endpoint and still uses strict JSON parsing, so JavaScript and JSONP are never evaluated.
- The API service distinguishes rejected credentials from upstream server failures and preserves a bounded, credential-redacted error and safe request ID when available. Brave and Scira failures then trigger the website fallback. Their websites can still require sign-in, enforce limits or display bot checks; fallback does not bypass those requirements.
- Search tabs can restore their query/provider with session restore enabled. Answers are not stored in the session, and reopening a restored search requires **Search again** before another API request is sent.
- Private searches stay out of saved sessions. Result links and automatic website fallbacks retain private browsing. A fallback that finishes in a background tab leaves the active tab and address bar alone. Private address/command bars do not request online suggestions.
- Normal address/command bars use official Brave Autosuggest only when online suggestions are enabled and the key has access. Scira and DuckDuckGo Quick retain local history suggestions. The provider can still apply API authentication, quotas and service limits; Shiira does not bypass them.

## Verification

Run `npm test` for request contracts, response normalization, key handling, website fallback URLs and error paths, cancellation, race handling, private suggestions and internal search URLs.

Run `npm run test:search:electron` for the real main/preload/renderer flow using an isolated temporary profile, an in-memory keychain and fixture API responses. It checks automatic website fallback, key setup, inline Brave/Scira results, pagination, narrow layouts, restored searches and private-session handling. It reproduces an empty Scira HTTP 500, verifies that background fallback leaves the active tab alone, uses DuckDuckGo's actual MIME type, and sends real mouse-down/mouse-up events to verify provider chips work on one click. It writes layout captures under the ignored `tmp/search-smoke/` directory and removes its temporary profile when finished. It makes no authenticated requests against live providers and spends no API credits.
