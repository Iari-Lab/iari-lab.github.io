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

Steps:

1. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the GitHub repository
   `Iari-Lab/iari-lab.github.io`: production branch `main`, build command empty, build output directory `/`.
   Every push to `main` deploys; every other branch gets a preview URL (`<branch>.<project>.pages.dev`), which
   is the easiest way to review `impressum` and `live-app` before merging.
2. Custom domains → add `www.iari.io` and `iari.io`. Cloudflare will ask to move iari.io's DNS to its
   nameservers (today Namecheap: `dns1/dns2.registrar-servers.com`). It imports the zone first: check that the
   Google Workspace mail records (MX `smtp.google.com`, the SPF/DKIM/DMARC TXT records) came across before
   changing the nameservers at Namecheap.
   Without moving DNS: at Namecheap set CNAME `www` → `<project>.pages.dev` and a URL redirect for the apex;
   then the apex rule in `_redirects` is not needed.
3. SSL/TLS → "Full (strict)", and Edge Certificates → "Always Use HTTPS". HSTS comes from `_headers`.
4. Once www.iari.io answers from Cloudflare: GitHub repository Settings → Pages → Source "None", so there is one
   origin. `CNAME` can stay or go; it does nothing on Cloudflare.
5. IARI Live (branch `live-app`): the app page comes from Cloudflare; the stream goes from the camera to the
   phone on the local network and never touches Cloudflare. If `acam.iari.io` is created for iPhones (see
   `docs/acam/phone_app_plan.md` in the acamera repository), make it a **DNS-only** record (grey cloud): its
   target is a private address, which the proxy cannot reach.
6. Optional, not done: Cloudflare Web Analytics is cookieless and needs no consent; it could replace the
   statistics service and the banner altogether. The banner stays, as decided on 1 Nov 2026.

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
  for us").
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
