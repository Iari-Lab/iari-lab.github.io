Iari

## Legal pages (Impressum, privacy notice, consent)

German law requires both pages on any business website, also before the company exists.
Added 22 Oct 2026; the reasoning is summarised here so it survives edits.

**Before publishing, fill the yellow `<mark class="todo">` fields** (`impressum.html`: 6, `datenschutz.html`: 1):

- the full legal names of the founders who run the site (one, some or all of the team);
- an address where every person named can be served with court papers ("ladungsfähige
  Anschrift"): a home or an office with your name at the door. A P.O. box does not count, and a
  bare virtual-office address risks failing (OLG München, 29 U 8/17);
- a phone number, the safe second contact channel next to e-mail (CJEU C-298/07);
- the Google Analytics data retention you set: Admin → Data collection and modification → Data
  retention (2 months is the shortest).

**What the pages say and why**

- `impressum.html`: § 5 DDG (the Digitale-Dienste-Gesetz replaced § 5 TMG in May 2024). Without a
  company, the people who run the site are the provider; no legal form is claimed ("GmbH",
  "UG" or "i. G." would be wrong before a notary has certified the articles).
- `datenschutz.html`: GDPR Art. 13 notice for what the site actually does: GitHub Pages hosting
  (logs visitor IPs), Google Analytics only with consent, YouTube only on play, e-mail via Google
  Workspace, LinkedIn as a plain link. Check that Google Workspace's data processing terms are
  accepted: Admin console → Account → Account settings → Legal and compliance.
- `assets/consent.js`: Google Analytics loads only after "Allow" (§ 25 TDDDG); "Cookie settings" in
  every footer asks again and deletes the `_ga` cookies on decline. Without consent a first visit
  contacts no third party at all.
- `assets/fonts/`: Inter and Outfit served from this site. Do not put the fonts.googleapis.com
  links back: loading Google Fonts from Google without consent was ruled unlawful
  (LG München I, 3 O 17493/20) and set off a wave of warning letters.
- No link to the EU online dispute resolution platform: it was shut down on 20 July 2025 and a
  leftover link counts as misleading.

**When things change**

- Articles notarised (GmbH/UG in formation): the provider becomes "IARI Labs GmbH i. G." (or UG),
  "vertreten durch" the managing director(s).
- Registered: add the register court and number (Berlin: Amtsgericht Charlottenburg, HRB …),
  the managing directors, and the VAT ID once the tax office assigns one; drop "i. G.".
- A blog or news section: name a person responsible for the content under § 18 (2) MStV.
- Selling to consumers: more duties apply (terms, withdrawal, dispute-resolution statement under
  § 36 VSBG once you have more than 10 employees).
- Any new third-party service (form backend, newsletter, chat, maps, other analytics): add it to
  the privacy notice, and put it behind consent if it sets cookies or sends data before a click.
