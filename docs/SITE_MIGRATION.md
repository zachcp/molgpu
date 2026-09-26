# From spikes to the project site

This repository will replace the exploratory `spikes/` tree with `site/`, a
first-class top-level website. `site/` is product-facing: it explains molgpu,
links to its packages, and hosts maintained, runnable WebGPU demonstrations. It
is not a new package and is not published with the JSR workspace.

## Target layout

```
site/
  index.html                 # Vite's minimal document shell
  src/
    main.tsx                 # route selection and site mount
    app.tsx                  # navigation, layout, and page composition
    pages/
      home.tsx               # landing page
      demos.tsx              # maintained representation gallery
    demos/
      scene.tsx              # composed reference scene
      viewer.tsx             # WebGPU/camera/pass JSX harness
      data.ts                # typed fixture and selection helpers
    styles.css
  assets/
    font.ttf
  test/
    run-browser.mjs
  vite.config.mjs
  README.md
```

Every application page and WebGPU composition is TSX. `index.html` remains the
small browser document required by the bundler; it owns no page content.

## What moves, what is retired

| Current area                                           | Disposition | Replacement or rationale                                                                                                            |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `spikes/examples/` gallery                             | Rebuild     | `site/` TSX app. Start from one composed reference scene, then add only maintained representation demos as explicit TSX components. |
| `spikes/examples/assets/font.ttf`                      | Move        | `site/assets/font.ttf`; update viewer browser fixtures that load it.                                                                |
| `spikes/examples/test/`                                | Rebuild     | `site/test/` checks the landing page and maintained demos.                                                                          |
| `spikes/s1-spacefill/`                                 | Retire      | Its lessons are covered by package tests and dated findings; no standalone application survives.                                    |
| `spikes/s3-molecular-surface/`                         | Retire      | Preserve conclusions in findings and package tests, not a second app. Rewrite any docs that link to its source.                     |
| `spikes/jsr/`                                          | Retire      | JSR publication checks now live in root Deno tasks and hardening. Preserve the finding, not its experimental project.               |
| `spikes/` build products and nested dependency folders | Delete      | Generated/local files; never migrate.                                                                                               |

## Execution order

1. **Inventory and freeze behavior.** Record every task, CI job, documentation
   link, browser runner, asset, and code reference that mentions `spikes/`. Keep
   package-level GPU runners when they validate library invariants rather than a
   site page.
2. **Create the site shell.** Add `site/` with a TSX entry, app layout, home
   page, demo page, styles, Vite configuration, and Deno tasks (`dev:site`,
   `build:site`, `typecheck:site`, `test:site`). Vite remains Deno-launched:
   Deno's static server cannot transform TSX, resolve workspace aliases, or
   bundle use.gpu's browser dependencies.
3. **Build the first maintained demo.** Recreate the composed crambin scene with
   public `@molgpu/*` components and JSX. Put fixture data and the
   WebGPU/camera/pass setup in typed `site/src/demos/` modules. Do not copy the
   old layer-by-layer helpers wholesale.
4. **Migrate demonstrations intentionally.** Add a representation only when it
   documents a supported public API and has a clear visual/interaction
   assertion. The initial candidates are spacefill, ball-and-stick, bonds, tube,
   ribbon, and surface. Selection, lighting, and timeline become focused
   controls inside a maintained demo rather than separate exploratory pages.
5. **Move browser coverage.** Replace `test:examples` and `test:examples:figure`
   with `test:site`. Retain package browser tests such as component, geometry,
   invalidation, and field tests. Move the shared font path before removing the
   old asset.
6. **Switch repository entry points.** Update root tasks, CI, README package
   links, package viewer documentation, and release guidance to point at the new
   site. Replace source-code links in historical findings with stable
   prose/snippets or the corresponding maintained site file.
7. **Delete `spikes/`.** Remove it only after `rg 'spikes/'` is empty outside
   explicitly historical migration prose, no task references it, and the new
   site is built and browser-tested. Remove obsolete ignore rules at the same
   time.

## Definition of done

- `site/` is the only top-level browser application and is entirely TSX except
  for the required HTML shell and configuration files.
- The home page clearly presents the project and links to package docs; the
  demos page hosts the maintained WebGPU examples.
- The new site has Deno-owned development, build, typecheck, and browser-test
  tasks.
- All retained examples use typed, shared setup instead of spike-local copies.
- `spikes/` and active references to it are gone; findings remain readable
  without linking to deleted code.
