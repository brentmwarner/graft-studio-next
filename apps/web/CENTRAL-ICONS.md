# Central icons

The default artwork comes from legacy `graft-studio`'s installed
`@central-icons-react/round-outlined-radius-3-stroke-1.5` version `1.1.223`.
The SVGs retain that package's paths, corner radii, and 1.5px strokes.

`src/lib/icons.tsx` maps app controls to legacy Graft's choices: `folder-1`,
`settings-gear-1`, `edit-big`, `square-behind-square-1`, `arrows-repeat-right-left`,
`fork-code`, `blocks`, `group-1`, and `compass-round`, among others. File icons
share the legacy mappings in `src/file-icons.ts`. React controls, imperative
composer chips, and native menus all resolve assets through `central-icons.tsx`.

`public/central-icons-round` contains only the subset referenced by this app.
`src/lib/central-icons-round.json` records the exported names. The older
`reversed` assets remain a fallback for saved/custom names absent from the legacy
package, including legacy Graft's custom `shield-access` glyph. Explicit filled
status icons retain the `fill` set.

To regenerate from the installed legacy checkout, run from the repository root:

```sh
node scripts/migrate-legacy-central-icons.mjs ../graft-studio
node scripts/migrate-legacy-central-icons.mjs ../graft-studio --check
```

The check compares exported artwork byte for byte with the legacy package.
The original license is preserved in `CENTRAL-ICONS-LICENSE.md`.
