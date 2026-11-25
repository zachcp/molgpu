import React, { useEffect, useState } from "react";
import { DemosPage } from "./pages/demos.tsx";
import { HomePage } from "./pages/home.tsx";
import { ExperimentsPage } from "./pages/experiments.tsx";
import { packageReadme } from "./links.ts";

type Page = "home" | "demos" | "experiments";

// Experiments are routed but deliberately absent from the navigation.
const pageFromHash = (): Page =>
  location.hash.startsWith("#demos")
    ? "demos"
    : location.hash.startsWith("#experiments")
    ? "experiments"
    : "home";

export const App = () => {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const update = () => {
      setPage(pageFromHash());
      setHash(location.hash);
    };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#home" aria-label="molgpu home">molgpu</a>
        <nav aria-label="Primary navigation">
          <a href="#home" aria-current={page === "home" ? "page" : undefined}>
            Overview
          </a>
          <a href="#demos" aria-current={page === "demos" ? "page" : undefined}>
            Demos
          </a>
          <a href={packageReadme("viewer")}>API</a>
          <a href="https://github.com/zachcp/molgpu">GitHub</a>
        </nav>
      </header>
      <main>
        {page === "demos"
          ? <DemosPage />
          : page === "experiments"
          ? <ExperimentsPage hash={hash} />
          : <HomePage />}
      </main>
      <footer>MIT licensed · WebGPU-powered molecular visualization</footer>
    </>
  );
};
