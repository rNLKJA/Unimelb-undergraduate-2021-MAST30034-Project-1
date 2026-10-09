# Self-hosted fonts

These are the latin subsets of the site's three typefaces. They are loaded with `next/font/local` in `src/app/layout.tsx`, so a build never has to reach Google Fonts.

| File                                     | Source package (npm pack)                   | Axes                              | Variable              |
| ---------------------------------------- | ------------------------------------------- | --------------------------------- | --------------------- |
| `archivo-latin-wdth-normal.woff2`        | `@fontsource-variable/archivo@5.3.0`        | wght 100 to 900, wdth 62% to 125% | `--font-archivo`      |
| `source-serif-4-latin-opsz-normal.woff2` | `@fontsource-variable/source-serif-4@5.3.0` | wght 200 to 900, opsz 8 to 60     | `--font-source-serif` |
| `jetbrains-mono-latin-wght-normal.woff2` | `@fontsource-variable/jetbrains-mono@5.3.0` | wght 100 to 800                   | `--font-jetbrains`    |

Archivo declares `font-stretch: 62% 125%` so that `.font-condensed` can still narrow the headlines.

All three families are licensed under the SIL Open Font License 1.1. The licence for each family sits next to its files as `OFL-*.txt`.
