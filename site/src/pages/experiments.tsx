/// <reference path="../vite.d.ts" />
import React, { useEffect, useState } from "react";

/**
 * One standalone experiment: a single TypeScript file in `site/src/experiments/`
 * that exports `experiment`. It owns its canvas, camera, passes and lights, and
 * mounts into the host element it is given.
 */
export interface Experiment {
  readonly title: string;
  readonly summary: string;
  /** Mount into `host`; returns the teardown. `params` are the hash's query. */
  mount(host: HTMLElement, params: URLSearchParams): () => void;
}

// Each experiment is its own lazily loaded chunk: built and deployed, but not
// linked from the site navigation. Reach them at #experiments.
const modules = import.meta.glob<{ experiment: Experiment }>(
  "../experiments/*.tsx",
);
const load = (id: string) => modules[`../experiments/${id}.tsx`]?.();
export const experimentIds = Object.keys(modules)
  .map((path) => path.replace(/^.*\/|\.tsx$/g, ""))
  .sort();

/** `#experiments` or `#experiments/<id>?query`. */
export const experimentRoute = (hash: string) => {
  const [path, query = ""] = hash.replace(/^#experiments\/?/, "").split("?");
  return { id: path || null, params: new URLSearchParams(query) };
};

const ExperimentIndex = () => {
  const [entries, setEntries] = useState<[string, Experiment][]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(
      experimentIds.map(async (id) =>
        [id, (await load(id)!).experiment] as [string, Experiment]
      ),
    ).then((loaded) => live && setEntries(loaded));
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="experiments">
      <h1>Experiments</h1>
      <p>
        Standalone sketches on molgpu data structures. Some may grow into
        reusable components; none are part of the supported API.
      </p>
      <ul className="experiment-list">
        {entries.map(([id, { title, summary }]) => (
          <li key={id}>
            <a href={`#experiments/${id}`}>{title}</a>
            <p>{summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};

const ExperimentView = ({ id, params }: { id: string; params: string }) => {
  const [title, setTitle] = useState("");
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const host = document.querySelector<HTMLElement>("#experiment-canvas");
    const loading = load(id);
    if (!host || !loading) {
      setMissing(true);
      return;
    }
    let dispose: (() => void) | null = null;
    let live = true;
    void loading.then(({ experiment }) => {
      if (!live) return;
      setTitle(experiment.title);
      host.dataset.experiment = id;
      dispose = experiment.mount(host, new URLSearchParams(params));
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [id, params]);
  if (missing) {
    return (
      <section className="experiments">
        <p>
          No experiment named “{id}”. <a href="#experiments">All experiments</a>
        </p>
      </section>
    );
  }
  return (
    <section className="experiment">
      <header>
        <a href="#experiments">Experiments</a>
        <h1>{title}</h1>
      </header>
      <div id="experiment-canvas" className="experiment-canvas" />
      <p data-webgpu-error="" role="status" />
    </section>
  );
};

export const ExperimentsPage = ({ hash }: { hash: string }) => {
  const { id, params } = experimentRoute(hash);
  return id
    ? <ExperimentView key={id} id={id} params={params.toString()} />
    : <ExperimentIndex />;
};
