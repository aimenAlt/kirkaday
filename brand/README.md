# Brand masters (not deployed)

The approved KirkaDay brand package (`KirkaDay_Brand_Assets`, guidelines v1.0) is the source
of truth for every logo, color, font and pattern on the site. Copy its files as delivered;
never redraw, recolor, retype or trace the artwork. The rules live in
`08_Brand_Guidelines/KirkaDay_Brand_Guidelines.pdf`.

## What lives where

| Path | Contents |
| --- | --- |
| `brand/logo/` | Master RGB vectors from the package's `01_Master_Vector/SVG/` (not served) |
| `brand/logo/_superseded/` | The earlier logo SVGs traced from the old rasters. Retired; kept for history only |
| `assets/brand/` | Web SVGs from `03_Web/SVG/`, plus the metallic K monogram from `02_Logo_Variations/Monogram/` |
| `assets/brand/pattern/` | Seamless 2048×1736 tiles from `06_Pattern/Seamless/`, with WebP twins |
| site root | Favicons, touch/PWA icons, `site.webmanifest` and `og-image-1200x630.png` from `03_Web/` |

## Palette

| Token | Name | Hex | Use |
| --- | --- | --- | --- |
| `--kd-red` | Hibiscus Red | `#C8102E` | Primary: buttons, links, accents |
| `--kd-gold` | Saffron Gold | `#BD9B60` | Rules and ornaments; text only when large, or on Deep/Ink |
| `--kd-deep` | Roselle Deep | `#76232F` | Accent: dark bands, small labels on cream |
| `--kd-ink` | Roselle Ink | `#2A1A1D` | Text, footer |
| `--kd-cream` | Hibiscus Cream | `#F6EEE3` | Page background |
| `--kd-white` | White | `#FFFFFF` | Cards that sit lighter than the page |

Neutral text tints are `color-mix()`es of these tokens (see `assets/site.css`). Never set small
gold text on cream.

The previous palette (oxblood `#8E0B16`, gold `#BE9A42`, cream `#FCF7E9` and the browns around
them) is retired and must not come back.

## Type

- Display: Cinzel 700 (headlines), 600 (subheads). Cinzel has no italic.
- Body: Jost 400. Labels, nav and buttons: Jost 500, uppercase, tracked 0.2–0.34em.
- The wordmark is artwork. Never set it as live text.
