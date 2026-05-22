# Extension Processed Link Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore processed EDRSR link highlighting in the Chrome extension and ship a versioned Chrome Web Store release artifact.

**Architecture:** Keep the current background/API contract and restore the content-script page cue through the existing page-scoped `API_CHECK_PROCESSED` flow. Pin the behavior with the repo self-check contract, bump the source release version, and let the release build generate production `extension-build/` plus the ZIP artifact.

**Tech Stack:** Chrome MV3 extension, vanilla JavaScript, Node.js self-check scripts, npm release build.

---

### Task 1: Contract Guard

**Files:**
- Modify: `scripts/selfcheck.js`
- Test: `npm run test:selfcheck`

- [ ] **Step 1: Write the failing self-check**

Read `extension/content.js` in `scripts/selfcheck.js` and assert it keeps the
processed-link data attribute, style id, API message, and highlight helper.

- [ ] **Step 2: Verify the red state**

Run: `npm run test:selfcheck`

Expected: FAIL because the current content script no longer contains the
highlight helper and markers.

### Task 2: Content Script Restore

**Files:**
- Modify: `extension/content.js`
- Test: `npm run test:selfcheck`

- [ ] **Step 1: Implement the highlight helper**

Restore page-scoped processed link marking through `API_CHECK_PROCESSED`,
`data-edrsr-processed`, and the historical `#551a8b` CSS rule.

- [ ] **Step 2: Wire the page lifecycle**

Call the helper when decision links are present during initialization and from
the existing mutation observer after decision links appear dynamically.

- [ ] **Step 3: Verify green**

Run: `npm run test:selfcheck`

Expected: PASS.

### Task 3: Versioned Release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `extension/manifest.json`
- Modify: `README.md`
- Generated: `edrsr-ai-extension-v2.0.6.zip`

- [ ] **Step 1: Bump release version**

Move the root package, root lockfile package entries, source extension manifest,
and README package version from `2.0.5` to `2.0.6`.

- [ ] **Step 2: Run broad verification**

Run: `npm run quality:local`

Expected: PASS.

- [ ] **Step 3: Build Chrome Web Store release**

Run: `npm run build:extension:release`

Expected: production `extension-build/` and
`edrsr-ai-extension-v2.0.6.zip` are generated.

- [ ] **Step 4: Inspect release outputs**

Check the built manifest version and production endpoints in
`extension-build/config.js` before publishing.

### Task 4: Publish Main

**Files:**
- Commit the tracked source/docs/version files and the release ZIP if Git policy
  tracks ZIP releases for this repository.

- [ ] **Step 1: Inspect git status and diff**

Review staged scope and avoid local env files or untracked workspace helpers.

- [ ] **Step 2: Commit the verified update**

Use a terse commit message describing the extension highlight release.

- [ ] **Step 3: Push direct to main**

Run: `git push origin main`

Expected: GitHub `main` contains the verified release update.
