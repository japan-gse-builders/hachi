# Web typography

Headings use **DM Serif Display Regular**, bundled in `apps/web/public/fonts/`. Body text keeps
the existing **Avenir Next → Segoe UI → sans-serif** stack at **18px / 1.45**. The cream background
and deep green links, buttons and card titles are unchanged.

The heading font is the unmodified asset from
[`japan-gse-builders/shutas-playground`](https://github.com/japan-gse-builders/shutas-playground/tree/main/app/assets/fonts).
It is distributed under the **SIL Open Font License 1.1**; the copyright notice and full license
are included alongside it as [DMSerifDisplay-OFL.txt](../apps/web/public/fonts/DMSerifDisplay-OFL.txt).
The font is self-hosted, preloaded from the same origin and uses `font-display: swap`. Georgia,
Times New Roman and the system serif face provide immediate fallback text if it is slow or unavailable.

## Scale and semantics

| Use | Element | Size | Line height | Face |
| --- | --- | --- | --- | --- |
| Page title | `h1` | 32–42px, responsive | 1.15 | DM Serif Display |
| Card title | `h2` | 28px | 1.2 | DM Serif Display |
| Subsection / fieldset title | `h3` / `legend` | 22px | 1.2 | DM Serif Display |
| Metadata label | heading with `.eyebrow` | 13px, uppercase, 0.1em tracking | 1.45 | Body stack, bold |
| Body | inherited | 18px | 1.45 | Body stack |

Page titles are promoted to `h1` in staff, family and sign-in screens. The tile grid still spans
page titles across its columns. Card and subsection headings retain their semantic levels.
Metadata labels such as “What was said”, “Notifications” and “Calls” remain `h2` for navigation
by assistive technology, while their visual treatment distinguishes them from card titles.
Family alerts, care contacts and call notes use the same label treatment.

Eyebrows use the existing muted colour `#5c564c`: contrast is **7.27:1 on white** and **6.38:1
on cream (`#f4f0e6`)**, above the 4.5:1 minimum for small text. No opacity reduction is applied.

## Visual verification

These screenshots render the actual app components with **entirely fictional residents and
conversations**, using a temporary local preview that substitutes authentication and API responses.
No real resident information, credentials or backend access was used. Before and after use the
same fixtures, Japan timezone, fixed 9 October 2026 clock, browser and viewport.

| Screen | Before | After |
| --- | --- | --- |
| Staff queue, 1440 × 1000 | [Before](screenshots/typography/before-queue-1440.png) | [After](screenshots/typography/after-queue-1440.png) |
| Staff case, 1440 × 1000 | [Before](screenshots/typography/before-case-1440.png) | [After](screenshots/typography/after-case-1440.png) |
| Family glance, 1440 × 1000 | [Before](screenshots/typography/before-glance-desktop.png) | [After](screenshots/typography/after-glance-desktop.png) |
| Family glance, 390 × 844 | [Before](screenshots/typography/before-glance-mobile.png) | [After](screenshots/typography/after-glance-mobile.png) |

Full-page captures include content beyond the viewport. The desktop images correspond to the
queue, case and glance views requested in issue #18; the phone comparison checks the shared styles.
All four updated views keep the body at 18px with a computed 26.1px line height and have no
horizontal page overflow. Their rendered page titles are 42px on desktop and 32px on the phone;
card titles are 28px, subsections 22px and eyebrows 13px.

Additional browser checks confirm the heading actually renders in DM Serif Display when loaded.
With the font [blocked](screenshots/typography/blocked-glance-mobile.png), or
[delayed three seconds](screenshots/typography/slow-glance-mobile.png), headings remain visible
in Georgia and the family screen fits the phone. The delayed font then swaps in successfully.
The temporary preview and browser tooling are outside the repository and are not part of the app.

Validation: `npm run check` (1,043 tests passed, 13 Firestore emulator tests skipped),
`npm run build`, and `npm run build -w @hachi/web`.
