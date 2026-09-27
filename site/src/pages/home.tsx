import React from "react";
import { packageReadme } from "../links.ts";

const packages = [
  [
    "@molgpu/table",
    "Validated molecular structure data and traces.",
    packageReadme("table"),
  ],
  [
    "@molgpu/select",
    "Selections, set operations, and domain conversion.",
    packageReadme("select"),
  ],
  [
    "@molgpu/fields",
    "Typed colour, scalar, and label fields.",
    packageReadme("fields"),
  ],
  [
    "@molgpu/io",
    "Mol* parsers adapted to GPU-native structures, maps, charges, and selections.",
    packageReadme("io"),
  ],
  [
    "@molgpu/geo",
    "Curve and surface geometry kernels.",
    packageReadme("geo"),
  ],
  [
    "@molgpu/timeline",
    "Scrubbable named beats and keyframes.",
    packageReadme("timeline"),
  ],
  [
    "@molgpu/viewer",
    "Composable use.gpu visualization components.",
    packageReadme("viewer"),
  ],
] as const;

export const HomePage = () => (
  <>
    <section className="hero" aria-labelledby="hero-title">
      <p className="eyebrow">WebGPU molecular visualization</p>
      <h1 id="hero-title">
        A small, composable toolkit for seeing molecular data.
      </h1>
      <p className="lede">
        molgpu turns validated structure data into reactive WebGPU scenes using
        focused TypeScript packages and use.gpu components.
      </p>
      <div className="actions">
        <a className="button primary" href="#demos">Explore the demo</a>
        <a className="button" href={packageReadme("viewer")}>
          Read the viewer API
        </a>
      </div>
    </section>
    <section className="principles" aria-labelledby="principles-title">
      <h2 id="principles-title">Designed for composition</h2>
      <div className="card-grid">
        <article>
          <h3>Plain data first</h3>
          <p>
            Tables, selections, fields, and geometry stay independent of the
            renderer.
          </p>
        </article>
        <article>
          <h3>Typed boundaries</h3>
          <p>
            Each package exposes an intentional API that can be checked and
            published independently.
          </p>
        </article>
        <article>
          <h3>GPU-native scenes</h3>
          <p>
            Viewer components compose directly into an application-owned use.gpu
            render tree.
          </p>
        </article>
      </div>
    </section>
    <section className="packages" aria-labelledby="packages-title">
      <h2 id="packages-title">Packages</h2>
      <div className="package-grid">
        {packages.map(([name, description, href]) => (
          <a href={href} key={name}>
            <code>{name}</code>
            <span>{description}</span>
          </a>
        ))}
      </div>
    </section>
  </>
);
