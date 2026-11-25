import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  attributeColumn,
  backboneDihedrals,
  bondTopology,
  type StructureData,
} from "@molgpu/table";
import crambinUrl from "../../../packages/io/test/fixtures/1crn.bcif?url";
import p450Url from "../../../packages/io/test/fixtures/1tqn.bcif?url";
import complexUrl from "../../../packages/io/test/fixtures/1a4y.bcif?url";
import membraneUrl from "../../../packages/io/test/fixtures/1c3w.bcif?url";
import chargesUrl from "../../../packages/io/test/fixtures/1crn-amber.pqr?url";
import {
  densityMapFor,
  loadChargedCrambin,
  loadStructure,
  withTemplateCharges,
} from "../demos/data.ts";
import {
  demoById,
  demoCamera,
  demoFromRoute,
  type DemoId,
  demoOptions,
  demos,
  scrubbed,
  structureById,
  type StructureId,
  structures,
} from "../demos/registry.ts";
import { demoSource, renderDemoScene, selectionFor } from "../demos/scenes.tsx";
import {
  defaultRoughness,
  defaultSettings,
  type DemoSettings,
} from "../demos/options.ts";
import { DemoControls } from "../demos/controls.tsx";
import { disposeViewer, mountViewer } from "../demos/viewer.tsx";
import { figureStage } from "../demos/figure.ts";
import { FOCUS_SECONDS, focusCurve } from "../demos/focus.ts";
import type { CameraCurve } from "@molgpu/viewer";
import { addPick, formatMeasurement, measure } from "../demos/measurements.ts";

const SCRUB_DURATION = 4;
const STRUCTURE_URLS: Record<StructureId, string> = {
  "1crn": crambinUrl,
  "1tqn": p450Url,
  "1a4y": complexUrl,
  "1c3w": membraneUrl,
};

/** Normalise a hash to the current ids, keeping the legacy preset once. */
const routeFromHash = () => {
  const route = demoFromRoute(location.hash);
  if (
    location.hash.startsWith("#demos/") &&
    location.hash !== `#demos/${route.id}`
  ) {
    history.replaceState(null, "", `#demos/${route.id}`);
  }
  return route;
};

/** Picked atom names, the measurement and the last residue's phi/psi. */
const measureReadout = (
  data: StructureData,
  picks: readonly number[],
): string[] => {
  const { atoms, residues } = data.topology;
  const name = (row: number) => {
    const r = atoms.residue[row];
    return `${residues.comp[r]}${residues.authSeq[r]} ${atoms.name[row]}`;
  };
  const lines = [picks.map(name).join(" – ")];
  const result = measure(data.positions, picks);
  if (result.kind !== "none") {
    lines.push(`${result.kind}: ${formatMeasurement(result)}`);
  }
  if (picks.length) {
    const r = atoms.residue[picks[picks.length - 1]];
    const { phi, psi } = backboneDihedrals(data);
    const deg = (v: number) => Number.isFinite(v) ? `${v.toFixed(1)}°` : "—";
    lines.push(
      `${residues.comp[r]}${residues.authSeq[r]} φ ${deg(phi[r])} ψ ${
        deg(psi[r])
      }`,
    );
  }
  return lines;
};

/** Download the presented frame at canvas pixel size, without a GPU readback. */
const savePng = async (id: string) => {
  const host = document.querySelector<HTMLElement>("#molecule-canvas");
  const canvas = host?.querySelector("canvas");
  if (!host || !canvas) return;
  host.dataset.capture = "pending";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) {
    host.dataset.capture = "error";
    return;
  }
  host.dataset.captureSize = `${canvas.width}x${canvas.height}`;
  host.dataset.captureBytes = String(blob.size);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `molgpu-${id}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  host.dataset.capture = "done";
};

/** The example's real file, read-only, with a copy button. */
const SourcePanel = ({ id }: { id: DemoId }) => {
  const { file, source } = demoSource(id);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [id]);
  return (
    <details className="demo-source" data-demo-source={id}>
      <summary>
        Source <code>{file}</code>
      </summary>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard.writeText(source).then(
            () => setCopied(true),
            () => setCopied(false),
          )}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre><code>{source}</code></pre>
    </details>
  );
};

export const DemosPage = () => {
  const [initial] = useState(routeFromHash);
  const [id, setId] = useState<DemoId>(initial.id);
  const [settings, setSettings] = useState(() =>
    defaultSettings(initial.preset)
  );
  const changeSettings = (patch: Partial<DemoSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [structureId, setStructureId] = useState<StructureId>("1crn");
  const structure = structureById(structureId);
  const demo = demoById(id);
  const {
    layers,
    figure,
    shadows,
    focusMode,
    environment,
    tonemap,
    surfaceKind,
    clip,
    roughness,
    fresnel,
    bump,
    bumpScale,
    selectionMode,
    ramachandran,
    efieldSpacing,
    seedSpacing,
    lineDistance,
    sliceFraction,
  } = settings;
  // Data that only ships for some structures falls back to what every one has.
  const effectiveField = structure.charges ? settings.fieldMode : "element";
  const effectiveMotion =
    !structure.trajectory && settings.motionMode === "trajectory"
      ? "wobble"
      : settings.motionMode;
  const effectiveVolume = settings.volumeMode;
  const [picks, setPicks] = useState<readonly number[]>([]);
  const [readout, setReadout] = useState<readonly string[]>([]);
  const onPick = useCallback(
    (row: number) => setPicks((current) => addPick(current, row)),
    [],
  );
  const [focus, setFocus] = useState<
    { row: number; curve: CameraCurve } | null
  >(null);
  const [focusTime, setFocusTime] = useState(0);
  const shownData = useRef<StructureData | null>(null);
  const shownPose = useRef<{ target: readonly number[]; radius: number }>({
    target: [0, 0, 0],
    radius: 1,
  });
  const onPose = useCallback(
    (pose: { target: readonly number[]; radius: number }) => {
      shownPose.current = pose;
    },
    [],
  );
  const onFocusPick = useCallback((row: number) => {
    const data = shownData.current;
    if (!data) return;
    setFocus({ row, curve: focusCurve(data, row, shownPose.current) });
    setFocusTime(0);
  }, []);

  useEffect(() => {
    const update = () => {
      const route = routeFromHash();
      setId(route.id);
      if (route.preset) {
        const preset = route.preset;
        setSettings((current) => ({
          ...current,
          ...preset,
          ...(preset.materialMode
            ? { roughness: defaultRoughness(preset.materialMode) }
            : {}),
        }));
      }
    };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  useEffect(() => () => disposeViewer("#molecule-canvas"), []);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [id, effectiveMotion]);
  useEffect(() => setFocus(null), [id, structureId, focusMode]);
  useEffect(() => {
    if (!focus) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const seconds = Math.min(FOCUS_SECONDS, (now - start) / 1000);
      setFocusTime(seconds);
      if (seconds < FOCUS_SECONDS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  useEffect(() => {
    if (!playing || !scrubbed(id)) return;
    let frame = 0;
    let previous: number | undefined;
    const tick = (now: number) => {
      if (previous !== undefined) {
        const elapsed = (now - previous) / 1000;
        setTime((current) => (current + elapsed) % SCRUB_DURATION);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, id]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = document.querySelector<HTMLElement>("[data-webgpu-error]");
      if (status) status.textContent = `Loading ${structure.title}…`;
      try {
        const loaded = await loadStructure(
          STRUCTURE_URLS[structure.id],
          structure.title,
        );
        // Shipped PQR charges where they exist; the volume demo's field
        // falls back to residue-template charges for every other structure.
        const data =
          structure.charges && (demo.id === "select" || demo.id === "volume")
            ? await loadChargedCrambin(loaded, chargesUrl)
            : demo.id === "volume"
            ? withTemplateCharges(loaded)
            : loaded;
        if (cancelled) return;
        const host = document.querySelector<HTMLElement>("#molecule-canvas");
        if (host) {
          Object.assign(host.dataset, {
            demo: demo.id,
            fixture: structure.id,
            assertion: demo.assertion,
            orbit: "enabled",
            atomCount: String(data.topology.atoms.count),
            residueCount: String(data.topology.residues.count),
            clip: demo.id === "surface" ? clip.join(",") : "",
            surfaceKind: demo.id === "surface" ? surfaceKind : "",
            environment: demo.id === "surface" ? environment : "",
            tonemap: demo.id === "surface" ? tonemap : "",
            roughness: demo.id === "surface" ? String(roughness) : "",
            fresnel: demo.id === "surface" ? String(fresnel) : "",
            bump: demo.id === "surface" ? `${bump},${bumpScale}` : "",
            motion: demo.id === "motion" ? effectiveMotion : "",
            rama: demo.id === "motion" ? String(ramachandran) : "",
            volume: demo.id === "volume" ? effectiveVolume : "",
            layers: demo.id === "compose" ? layers.join(",") : "",
            figure: demo.id === "compose" && figure
              ? (shadows ? "shadows" : "plane")
              : "",
          });
          if (demo.id === "select") {
            host.dataset.selectedCount = String(
              selectionFor(data, selectionMode, structure.id).indices.length,
            );
            const charge = attributeColumn(data, "partialCharge");
            let net = 0;
            for (const q of charge?.values ?? []) net += q;
            host.dataset.netCharge = charge ? net.toFixed(3) : "";
            host.dataset.chargeProvenance = charge?.provenance ?? "";
          }
          if (demo.id === "compose") {
            host.dataset.bondCount = String(bondTopology(data).count);
          }
        }
        const sliceIndex = demo.id === "volume" && effectiveVolume === "density"
          ? sliceFraction * (densityMapFor(data).dims[2] - 1)
          : 0;
        if (host && demo.id === "volume") {
          host.dataset.sliceIndex = sliceIndex.toFixed(2);
        }
        const scene = (current: StructureData) =>
          renderDemoScene(demo.id, current, {
            ...settings,
            structure: structure.id,
            fieldMode: effectiveField,
            motionMode: effectiveMotion,
            volumeMode: effectiveVolume,
            measure: { picks, onPick },
            sliceIndex,
            onFocusPick: demo.id === "select" && focusMode
              ? onFocusPick
              : undefined,
          });
        const camera = demoCamera(data, demo.id, {
          motionMode: effectiveMotion,
          volumeMode: effectiveVolume,
        }, time);
        if (host) {
          host.dataset.cameraRadius = camera.radius.toFixed(3);
          if (demo.id === "volume" && effectiveVolume === "potential") {
            host.dataset.gridSpacing = String(efieldSpacing);
            host.dataset.seedSpacing = String(seedSpacing);
            host.dataset.lineDistance = String(lineDistance);
          }
        }
        const options = demoOptions(demo, {
          motionMode: effectiveMotion,
          layers,
          environment,
          tonemap,
          figure: figure ? figureStage(data, shadows) : undefined,
        });
        const focusing = demo.id === "select" && focusMode;
        shownData.current = data;
        if (host) {
          host.dataset.focusRow = focusing && focus ? String(focus.row) : "";
          host.dataset.focusDone = focusing && focus
            ? String(focusTime >= FOCUS_SECONDS)
            : "";
        }
        if (host && demo.id === "compose" && layers.includes("measure")) {
          const result = measure(data.positions, picks);
          host.dataset.measureRows = picks.join(",");
          host.dataset.measureKind = result.kind;
          host.dataset.measureValue = result.kind === "none"
            ? ""
            : String(result.value);
          setReadout(measureReadout(data, picks));
        }
        mountViewer(
          demo.id === "motion" ? `motion-${effectiveMotion}` : demo.id,
          "#molecule-canvas",
          data,
          scene,
          camera,
          scrubbed(demo.id) ? { ...options, time } : focusing
            ? {
              ...options,
              picking: true,
              focusCamera: {
                curve: focus?.curve ?? null,
                time: focusTime,
                onPose,
              },
            }
            : options,
        );
        if (status) status.textContent = "";
      } catch (error) {
        if (status) {
          status.textContent = error instanceof Error
            ? error.message
            : String(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, structure, settings, time, focus, focusTime, picks]);

  return (
    <section className="demo-page" aria-labelledby="demo-title">
      <header className="demo-heading">
        <div>
          <p className="eyebrow">The example collection</p>
          <h1 id="demo-title">{demo.title}</h1>
        </div>
        <p>{demo.summary}</p>
      </header>
      <nav className="demo-links" aria-label="Demo gallery">
        {demos.map((item, index) => (
          <a
            key={item.id}
            href={`#demos/${item.id}`}
            aria-current={item.id === demo.id ? "page" : undefined}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {item.title}
          </a>
        ))}
      </nav>
      <div className="demo-copy">
        <h2>Scene settings</h2>
        <label className="timeline-control">
          Structure
          <select
            aria-label="Example structure"
            value={structure.id}
            onChange={(event) => {
              setPicks([]);
              setStructureId(event.currentTarget.value as StructureId);
            }}
          >
            {structures.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <p className="hint" data-structure-description={structure.id}>
          {structure.description}
        </p>
        <DemoControls
          id={demo.id}
          settings={settings}
          structure={structure}
          onChange={changeSettings}
        />
        {demo.id === "compose" && layers.includes("measure") && (
          <div
            className="timeline-control measure-readout"
            data-measure-readout
          >
            {picks.length === 0
              ? <p>Click 2–4 atoms: distance, angle, dihedral.</p>
              : readout.map((line) => <p key={line}>{line}</p>)}
            {picks.length > 0 && (
              <button
                type="button"
                onClick={() => setPicks([])}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {demo.id === "motion" && (
          <div className="timeline-control playback-control">
            <label htmlFor="timeline-time">Scrub</label>
            <input
              id="timeline-time"
              aria-label="Timeline time in seconds"
              type="range"
              min="0"
              max={SCRUB_DURATION}
              step="0.01"
              value={time}
              onChange={(event) => setTime(Number(event.currentTarget.value))}
            />
            <output htmlFor="timeline-time">{time.toFixed(2)} s</output>
            <button
              type="button"
              aria-label={playing
                ? "Pause looping playback"
                : "Play looping playback"}
              aria-pressed={playing}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        )}
        <p className="hint">
          Drag or touch-drag to orbit; scroll, trackpad, or pinch to zoom.
          {demo.id === "motion" && effectiveMotion === "elastic" &&
            " Right-drag an atom to tug its residue."}
        </p>
        <details className="demo-notes">
          <summary>How this example works</summary>
          <p className="demo-assertion" data-demo-assertion={demo.id}>
            {demo.assertion}.
          </p>
        </details>
      </div>
      <div className="demo-stage">
        <div className="viewer-toolbar">
          <span>
            <strong>{structure.id.toUpperCase()}</strong> / Molecular view
          </span>
          <button type="button" onClick={() => void savePng(demo.id)}>
            Save PNG
          </button>
        </div>
        <div
          id="molecule-canvas"
          className="molecule-canvas"
          aria-label="Interactive molecular WebGPU demo"
        >
          <p data-webgpu-error="true" role="status">Preparing WebGPU…</p>
        </div>
        <p className="viewer-caption">
          Interactive molecular scene <span>WebGPU / use.gpu</span>
        </p>
      </div>
      <SourcePanel id={demo.id} />
    </section>
  );
};
