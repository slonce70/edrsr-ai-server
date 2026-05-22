# Extension Processed Link Highlighting Design

## Goal

Restore the Chrome extension behavior that visually marks already processed
EDRSR case links on current registry result pages.

## Approach

`extension/content.js` will use the current page-scoped
`API_CHECK_PROCESSED` message to ask the background worker which visible
decision URLs already have processed membership. The content script will mark
matching anchors with `data-edrsr-processed="true"` and keep the historical
visited-link purple color (`#551a8b`) through a content-script style rule.

The existing `uniqueOnly` filtering path remains unchanged. Highlighting is a
page cue only; it does not change which URLs are sent unless the user already
enabled the unique-only collection filter.

## Page Lifecycle

Highlighting runs when a registry page already contains decision links during
content-script initialization and again when the existing mutation observer sees
decision links appear later. The helper only checks links present on that page,
so it reuses the current bounded processed-membership API rather than loading
the entire processed URL history.

## Release

The extension version will move from `2.0.5` to `2.0.6` in the root package and
source manifest. The Chrome Web Store artifact will be produced through the
production release build, which patches `extension-build/` for production and
creates `edrsr-ai-extension-v2.0.6.zip`.

## Verification

The self-check contract will assert that the content script retains processed
link highlighting markers and the page-scoped processed API usage. The release
will also run the local quality gate and inspect the generated production
manifest/config/archive before pushing `main`.
