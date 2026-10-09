# Hachi branding

These are unmodified assets from [`japan-gse-builders/shutas-playground`](https://github.com/japan-gse-builders/shutas-playground).
The header uses the same transparent dog-and-Hachi wordmark as its Flutter app. The browser tab,
installed app and push notifications use that project's matching dog icon.

| Local asset | Source path | Git blob SHA |
| --- | --- | --- |
| `hachi-logo.png` | `app/assets/branding/hachi-logo.png` | `45ede2253efdab3544d7b5ce00b16a28e23981e5` |
| `favicon.png` | `app/web/favicon.png` | `b4af6fb4237aa1435d275d7abb293a2763c0a52b` |
| `apple-touch-icon.png` | `app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-60x60@3x.png` | `8722ba7dc8f2e99c039cea1c416ba9973917272f` |
| `icon-192.png` | `app/web/icons/Icon-192.png` | `533736b959c58881535629eed9a84533536c1b75` |
| `icon-512.png` | `app/web/icons/Icon-512.png` | `b74c0d86312d79e252a2e5e6ccf486af497b1fbd` |

The wordmark is displayed at 110 × 64 CSS pixels with `object-fit: cover`, matching the reference
app's framing while cropping only its transparent side margins. Its intrinsic dimensions and `alt`
text keep the home link accessible and avoid a layout shift as the image loads. All assets are
self-hosted; no external image service is used.
