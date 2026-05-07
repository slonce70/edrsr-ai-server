EDRSR‑AI Browser Extension — Privacy Policy

Effective date: 2026-05-07

1. Summary
- Purpose: Help users collect and analyze public court decisions from reyestr.court.gov.ua.
- No Ads. No sale of personal data. No third‑party trackers.
- Minimal data collection necessary to deliver the service.

2. Data We Process
- Account: Email and authentication tokens via Supabase (for sign‑in). Stored in browser storage (extension local storage), not shared with third parties beyond Supabase.
- User inputs: Prompt text you enter for analysis.
- URLs of cases: Links you choose to analyze from EDRSR pages.
- Results: AI‑generated analysis text and metadata (job ID, status, counts, timestamps).

3. What We Do NOT Collect
- No browsing history, keystrokes, or unrelated page content.
- No cookies from reyestr.court.gov.ua (the extension does not request the “cookies” permission).
- No precise location, contacts, payment information, or device identifiers.

4. How We Use the Data
- Provide the analysis service (queue jobs, run AI analysis on your selected URLs, return reports).
- Show real‑time job progress and chat related to your analysis results.
- Improve reliability and debugging (aggregated logs and error events without personal data wherever possible).

5. Storage and Retention
- Extension side: Auth session (access/refresh tokens, expiry) kept in Chrome extension storage on your device. You may sign out to clear it.
- Server side: Analysis jobs, prompts, links, and reports stored in our database to enable history and re‑downloads. Retention policy: kept until the user deletes jobs via the UI or requests deletion.

6. Sharing and Disclosure
- No sale of personal data. No advertising partners.
- Third parties: Supabase (authentication), the configured Gemini provider for analysis, and our hosting/database infrastructure. Data is used strictly to deliver the service.
- Legal: We may disclose if required by applicable law.

7. Security
- Transport security via HTTPS.
- Access control on the server is tied to your Supabase user account.

8. Your Choices
- Export/download your reports via the UI.
- Delete specific jobs in History or the web portal (server will delete corresponding records).
- Sign out at any time to remove the session from your browser.

9. Children’s Privacy
- Not intended for children under 16. We do not knowingly collect children’s personal information.

10. Contact
- Use the repository issue tracker or the contact configured in the Chrome Web Store listing.

11. Changes
- We may update this policy. Updated versions will be published in the repository and referenced in the store listing.
