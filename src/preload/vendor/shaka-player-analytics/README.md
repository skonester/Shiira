# FastPix Shaka adapter in Shiira

Source: the supplied `shaka-player-analytics-main` tree, package
`@fastpix/video-data-shakaplayer` 1.0.7, copyright 2025 FastPix, Inc (MIT).
The license is retained in `THIRD_PARTY_NOTICES/fastpix-shaka-analytics-MIT.txt`.

Shiira uses the adapter's actual media listeners, Shaka rendition inspection,
state extraction, response filter and ad-manager adapter. The FastPix cloud
core is replaced by `youtube-analytics-core.js`, a local event sink. No FastPix
account, cloud dependency, network upload, cookies or viewer ID is required.
The upstream cloud aggregation and dashboard are not included.

Local changes fix media-listener teardown, unregister the networking filter,
bind the already-attached video immediately, inspect renditions on `loaded`,
track rate/volume changes, and remove the page-global loader. Error details are
handled by Shiira's numeric allowlist rather than the adapter's raw error data.
Events stay inside the isolated preload and reach a bounded main-process store.
