# Central icons

The shared app controls match the glyphs in Codex, including its folder,
new-chat, copy, scheduled, plugin, terminal, and sidebar icons.
`public/central-icons-app` contains this curated artwork; the source glyph names
are recorded in `src/lib/central-icons-app.json`. The Codex paths and view boxes
were exported from the installed ChatGPT/Codex app version `26.908.40834`.
The export retains the original geometry and `currentColor` paint.

The Environment menu uses Central's `bullet-list`, the right sidebar toggle uses
`sidebar-hidden-right-wide`, and the bottom terminal toggle uses
`bottombar-hidden-bottom-wide`. These resolve through the Central fallback sets.
The Environment toggle stays hidden on empty-chat landings until the chat starts.

Skills deliberately retain Synara's original `building-blocks` artwork, copied
unchanged from `public/central-icons-reversed/building-blocks.svg`. The shared
`SKILL_ICON_NAME` covers Settings, profile rows, command menus, composer tokens,
and sent-message chips.

`src/lib/icons.tsx` keeps the app's existing component API. React controls,
imperative composer chips, and native menus all resolve assets through
`central-icons.tsx`, using this fallback order: app, rounded Central, reversed
Central. Explicit `round`, `reversed`, and `fill` variants retain their artwork.

Other controls and file-type icons use legacy `graft-studio`'s installed
`@central-icons-react/round-outlined-radius-3-stroke-1.5` version `1.1.223`.
`public/central-icons-round` and `src/lib/central-icons-round.json` contain the
exported subset. The older reversed assets also support saved/custom names,
including legacy Graft's custom `shield-access` glyph.

To regenerate the rounded fallback set from the installed legacy checkout, run
from the repository root:

```sh
node scripts/migrate-legacy-central-icons.mjs ../graft-studio
node scripts/migrate-legacy-central-icons.mjs ../graft-studio --check
```

The check compares the rounded fallback artwork byte for byte with the legacy
package; it does not replace the curated app icons. That package's original
license is preserved in `CENTRAL-ICONS-LICENSE.md`.
