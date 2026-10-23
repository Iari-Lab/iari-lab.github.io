Iari

## Hosting: Cloudflare Pages (prepared 1 Nov 2026, not switched yet)

The site is static HTML with no build step, so Cloudflare Pages serves the repository as it is. Today it is on
GitHub Pages (the `CNAME` file is GitHub's; Cloudflare ignores it). In the repo for Cloudflare:

- `_headers`: security headers for every page (HSTS, no MIME sniffing, referrer policy, frame-ancestors) and
  long caching for the self-hosted fonts and `live/vendor/`; the service worker `live/sw.js` is revalidated on
  every load. The Content-Security-Policy is shipped **Report-Only**: after the first deploy, open the site, press
  "Allow", play a video, open `live/` and connect to a camera, and look for CSP messages in the browser console;
  when there are none, rename the header to `Content-Security-Policy`.
- `_redirects`: `iari.io` → `www.iari.io` (both domains must be attached to the Pages project).
- `404.html`: served by Cloudflare Pages for missing paths.

What GitHub Pages cannot do, and Cloudflare adds (the reason to move):

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| response headers (CSP, HSTS, Permissions-Policy) | none, not configurable | `_headers` |
| cache lifetimes | fixed `max-age=600` for everything | per path (`_headers`: fonts and `live/vendor/` a year) |
| redirects | apex ↔ www only (automatic) | `_redirects`, any path or domain |
| preview of a branch | none (one branch = the site) | every branch at `<branch>.<project>.pages.dev` |
| analytics | none | Web Analytics, cookieless, free |
| edge protection | GitHub's own | WAF, bot and DDoS rules, rate limits, Access (password a preview) |
| server-side code | none | Pages Functions / Workers (e.g. a token check for a customer's live stream) |
| DNS | at Namecheap (API needs an IP allowlist) | Cloudflare DNS with a clean API: Let's Encrypt DNS-01 for `acam.iari.io` from any machine |
| limits | 1 GB site, 100 GB/month soft, Jekyll build by default | 25 MiB per file, 20,000 files, unlimited bandwidth |

Middle path, without moving the hosting: point iari.io's DNS at Cloudflare and proxy (orange cloud) the GitHub
Pages records. Headers then come from Rules → Transform Rules, redirects from Redirect Rules, caching from
Cache Rules, and Web Analytics from the dashboard; `_headers` and `_redirects` do nothing in that setup. Gotcha:
GitHub issues and renews the site's certificate only while it can see its own IPs behind the name, so keep the
records DNS-only (grey cloud) until GitHub shows "Enforce HTTPS" ticked, then switch the proxy on; SSL mode must
be "Full (strict)", never "Flexible".

Steps, in an order without downtime (on 1 Nov 2026 www.iari.io is served by GitHub, the apex redirects to www,
the zone is at Namecheap):

0. Push `main` and the branches to review (`impressum`, `live-app`). Nothing below changes the live site before
   step 4.
1. **Cloudflare account → Add a site → `iari.io`, Free plan.** Cloudflare scans the zone; compare with Namecheap's
   Advanced DNS page. Live records on 1 Nov 2026, all of which the scan must show (add by hand what it missed):
   - `A @` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 (GitHub Pages)
   - `CNAME www` → `iari-lab.github.io`
   - `MX @` → `1 smtp.google.com` (Google Workspace)
   - `TXT google._domainkey` → the two DKIM keys
   Set `A @` and `CNAME www` to **DNS only** (grey cloud): proxied, GitHub could not renew its certificate, and
   step 4 replaces them anyway. Add the two mail records that are MISSING today (without them, mail from
   info@iari.io is more likely to land in spam):
   - `TXT @` → `v=spf1 include:_spf.google.com ~all`
   - `TXT _dmarc` → `v=DMARC1; p=none; rua=mailto:info@iari.io` (p=none only reports; tighten to quarantine later)
2. **Nameservers.** Cloudflare shows two (`<name>.ns.cloudflare.com`). Namecheap → Domain List → Manage →
   Nameservers → Custom DNS → paste both → save. Cloudflare mails "zone active" within minutes to a day; the site
   keeps coming from GitHub meanwhile, because the records still point there.
   (Not moving the nameservers is possible: at Namecheap `CNAME www` → `iari-web.pages.dev` and a URL redirect
   for the apex; Cloudflare then verifies the custom domain with a TXT record. But no proxy, no Web Analytics
   injection, no Cloudflare DNS API for `acam.iari.io`.)
3. **Pages project.** Workers & Pages → Create → Pages → Connect to Git → GitHub → install the "Cloudflare Pages"
   GitHub App on the `Iari-Lab` organisation (an owner of the organisation must approve; grant it only this
   repository) → choose `iari-lab.github.io` → project name `iari-web` → production branch `main` → framework
   preset None, build command empty, build output directory `/` → Save and Deploy. The result:
   `https://iari-web.pages.dev`, and every other branch at `https://<branch>.iari-web.pages.dev` (check
   `impressum` and `live-app` there). `_headers`, `_redirects` and `404.html` are active on these URLs, so this
   is the moment for the CSP console check.
4. **Custom domains.** Project → Custom domains → Set up a custom domain → `www.iari.io`: Cloudflare offers to
   replace the GitHub `CNAME www` with one to `iari-web.pages.dev`; accept → Activate. Then `iari.io`: it replaces
   the four `A` records with a flattened CNAME. SSL/TLS → Overview → **Full (strict)**; Edge Certificates →
   **Always Use HTTPS**. Check: `curl -sI https://www.iari.io | grep -i '^server'` says `cloudflare` (today:
   `GitHub.com`), and `https://iari.io/` answers 301 to www (now from `_redirects`).
5. **GitHub.** Repository → Settings → Pages → Source → None, so there is one origin. Delete `CNAME` from the
   repo (it was GitHub's).
6. **Web Analytics.** Project → Metrics → Enable Web Analytics: Cloudflare injects the beacon at the edge and
   `CF_BEACON_TOKEN` in `assets/consent.js` stays empty. The consent-gated statistics are untouched.
7. **Optional, the registration itself.** Cloudflare Registrar takes `.io` (listed at cloudflare.com/tld-policies)
   at cost price, but only after the zone is on Cloudflare's nameservers (step 2) and only if the domain was not
   registered or transferred in the last 60 days. Namecheap → Domain → Sharing & Transfer → Domain Lock off →
   request the Auth/EPP code (comes by e-mail); Cloudflare → Domain Registration → Transfer Domains → `iari.io` →
   paste the code → pay one year's renewal (added to the current term) → approve Namecheap's confirmation e-mail.
   The site is not affected; renewal and the WHOIS contact move to Cloudflare. Keep Namecheap's auto-renew on
   until the transfer completes.

IARI Live (branch `live-app`): the app page comes from Cloudflare; the stream goes from the camera to the phone on
the local network and never touches Cloudflare. If `acam.iari.io` is created for iPhones (see
`docs/acam/phone_app_plan.md` in the acamera repository), it is a **DNS-only** `A` record (grey cloud) to the
camera's private address, which the proxy cannot reach.

## Legal pages (Impressum, privacy notice, consent)

German law requires both pages on any business website, also before the company exists.
Added 22 Oct 2026, changed 1 Nov 2026; the reasoning is summarised here so it survives edits.

**Decisions of 1 Nov 2026**

- `impressum.html` is published as "im Aufbau / under construction": IARI Labs as a founding project in Berlin,
  the e-mail address, and the full provider details to follow at registration. The version with the founders as
  provider (names, address, phone) is in git, commit 9e300f1. Known gap, accepted until the company exists: § 5 DDG
  asks for a name and a serviceable address ("ladungsfähige Anschrift") from the first day.
- The consent banner (`assets/consent.js`) and the privacy notice describe the visitor statistics without naming
  the vendor: what is recorded, which cookies, that the data may leave the EU, how to withdraw. Technically it is
  still Google Analytics 4 (ID G-NVN5NKC27N), loaded only after "Allow". Art. 13(1)(e) GDPR asks for the recipients
  *or categories of recipients*; the notice names the category ("the statistics service that processes this data
  for us"). Cloudflare Web Analytics (cookieless, no consent) runs next to it since 1 Nov 2026, described the
  same way ("a cookieless statistics service", Art. 6(1)(f)).
- The hosting paragraph names no vendor either, so the move from GitHub Pages to Cloudflare needs no edit there.

**Still to fill:** the data-retention period in `datenschutz.html` (one yellow `<mark class="todo">`):
Analytics Admin → Data collection and modification → Data retention (2 months is the shortest).

**What the pages say and why**

- `impressum.html`: § 5 DDG (the Digitale-Dienste-Gesetz replaced § 5 TMG in May 2024). No legal form is claimed
  ("GmbH", "UG" or "i. G." would be wrong before a notary has certified the articles).
- `datenschutz.html`: GDPR Art. 13 notice for what the site actually does: hosting (server logs), visitor
  statistics only with consent, YouTube only on play, e-mail via Google Workspace, LinkedIn as a plain link. Check
  that Google Workspace's data processing terms are accepted: Admin console → Account → Account settings → Legal
  and compliance.
- `assets/consent.js`: the statistics tag loads only after "Allow" (§ 25 TDDDG); "Cookie settings" in every footer
  asks again and deletes the `_ga` cookies on decline. Without consent a first visit contacts no third party at all.
- `assets/fonts/`: Inter and Outfit served from this site. Do not put the fonts.googleapis.com links back: loading
  Google Fonts from Google without consent was ruled unlawful (LG München I, 3 O 17493/20) and set off a wave of
  warning letters.
- No link to the EU online dispute resolution platform: it was shut down on 20 July 2025 and a leftover link
  counts as misleading.

**When things change**

- Articles notarised (GmbH/UG in formation): replace the under-construction card in `impressum.html` with the
  provider block: "IARI Labs GmbH i. G." (or UG (haftungsbeschränkt) i. G.), the registered address,
  "vertreten durch" the managing director(s), a phone number; update "Who is responsible" in `datenschutz.html`.
- Registered: add the register court and number (Berlin: Amtsgericht Charlottenburg, HRB …) and the VAT ID once
  the tax office assigns one; drop "i. G." and the "Register and VAT" paragraph's "not yet" wording.
- A blog or news section: name a person responsible for the content under § 18 (2) MStV.
- Selling to consumers: more duties apply (terms, withdrawal, dispute-resolution statement under § 36 VSBG once
  you have more than 10 employees).
- Any new third-party service (form backend, newsletter, chat, maps, other analytics): add it to the privacy
  notice, and put it behind consent if it sets cookies or sends data before a click.

## IARI Live (`live/`)

The acoustic camera on a phone, as an installable web app: the camera's picture (H.264, decoded by the phone's
hardware through WebCodecs), the sound map (WebGL2), the level and the spectrum (uPlot, in `live/vendor/`, MIT),
the classifier's verdict. Static files, no build step.

- `live/` with no parameters plays a simulation over a real frame of the lab; `?board=192.168.8.130` connects to a
  camera (or to the lab bridge) on the visitor's Wi-Fi; `?replay=URL` plays a recorded session (`.acws`).
- Android Chrome reaches a camera by its IP address after one "local network" prompt. iPhones need the camera's
  secure name (`wss://`), because every iOS browser blocks unencrypted local connections from a secure page.
- The stream goes from the camera to the phone directly, never through this site; the privacy notice's
  "IARI Live" section says so.
- Local test: `python3 -m http.server -d . 8000`, then `http://localhost:8000/live/` (localhost counts as secure,
  so WebCodecs works).
- The protocol (acam-ws v1), the bridge and the plan for the board side live in the acamera repository:
  `docs/acam/phone_app_plan.md`, `sg2002/tools/web/acam_ws_bridge.py`.
- `live/sw.js` is network-first: a new version shows on the next online visit and refreshes the offline copy.
  Bump its `CACHE` name when files are removed or renamed, and list new files in `FILES`.
