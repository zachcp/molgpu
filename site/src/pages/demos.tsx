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
import chargesUrl from "../../../packages/io/test/fixtures/1crn-amber.pqr?url";
import { element, resolve } from "@molgpu/select";
import {
  densityMapFor,
  loadChargedCrambin,
  loadStructure,
} from "../demos/data.ts";
import {
  type ComposeLayer,
  demoById,
  demoCamera,
  demoFromRoute,
  type DemoId,
  demoOptions,
  type DemoPreset,
  demos,
  type MotionMode,
  scrubbed,
  structureById,
  type StructureId,
  structures,
  type VolumeMode,
} from "../demos/registry.ts";
import {
  demoSource,
  type EnvironmentPreset,
  type FieldMode,
  type MaterialMode,
  renderDemoScene,
  selectionFor,
  type SelectionMode,
  type SurfaceColorMode,
  type SurfaceMode,
  type Tonemap,
  type TrajectoryMode,
} from "../demos/scenes.tsx";
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
};

const LAYERS: ReadonlyArray<readonly [ComposeLayer, string]> = [
  ["cartoon", "Cartoon"],
  ["tube", "Tube"],
  ["sticks", "Ball and stick"],
  ["spacefill", "Spacefill"],
  ["surface", "Glass surface"],
  ["sulfur", "Sulfur atoms"],
  ["measure", "Measure (click atoms)"],
];

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

/** Roughness each material mode starts at; metal reads best glossy. */
const defaultRoughness = (mode: MaterialMode) => mode === "metal" ? 0.2 : 0.85;

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

/**
 * Download the canvas's presented frame as a PNG at canvas pixel size (device
 * pixel ratio included). The browser snapshots the last presented WebGPU
 * frame, so no GPU readback buffer is created; the site tests read the canvas
 * the same way. Size and byte count land on the host for tests.
 */
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
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [structureId, setStructureId] = useState<StructureId>("1crn");
  const structure = structureById(structureId);
  const [layers, setLayers] = useState<readonly ComposeLayer[]>(
    initial.preset?.layers ?? ["cartoon", "sulfur"],
  );
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("opaque");
  const [clipDepth, setClipDepth] = useState(0);
  const [picks, setPicks] = useState<readonly number[]>([]);
  const [readout, setReadout] = useState<readonly string[]>([]);
  const onPick = useCallback(
    (row: number) => setPicks((current) => addPick(current, row)),
    [],
  );
  // Select click-to-focus: a camera curve from the shown pose to the picked
  // atom's residue, played on a local seconds clock.
  const [focusMode, setFocusMode] = useState(false);
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
  const [surfaceColorMode, setSurfaceColorMode] = useState<SurfaceColorMode>(
    "neutral",
  );
  const [materialMode, setMaterialMode] = useState<MaterialMode>(
    initial.preset?.materialMode ?? "matte",
  );
  const [worldLight, setWorldLight] = useState(
    initial.preset?.worldLight ?? false,
  );
  const [roughness, setRoughness] = useState(
    defaultRoughness(initial.preset?.materialMode ?? "matte"),
  );
  const [fresnel, setFresnel] = useState(true);
  const [figure, setFigure] = useState(initial.preset?.figure ?? false);
  const [shadows, setShadows] = useState(true);
  const [bump, setBump] = useState(0.6);
  const [bumpScale, setBumpScale] = useState(1.2);
  const [environment, setEnvironment] = useState<EnvironmentPreset>("none");
  const [tonemap, setTonemap] = useState<Tonemap>("linear");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    initial.preset?.selectionMode ?? "site",
  );
  const [fieldMode, setFieldMode] = useState<FieldMode>(
    initial.preset?.fieldMode ?? "element",
  );
  const [motionMode, setMotionMode] = useState<MotionMode>(
    initial.preset?.motionMode ?? "trajectory",
  );
  const [trajectoryMode, setTrajectoryMode] = useState<TrajectoryMode>("tube");
  const [volumeMode, setVolumeMode] = useState<VolumeMode>(
    initial.preset?.volumeMode ?? "density",
  );
  const [efieldSpacing, setEfieldSpacing] = useState(1);
  const [seedSpacing, setSeedSpacing] = useState(7);
  const [lineDistance, setLineDistance] = useState(30);
  // Slice position as a fraction of the map's k extent, and isolevel in sigma.
  const [sliceFraction, setSliceFraction] = useState(0.5);
  const [isoSigma, setIsoSigma] = useState(2);
  const demo = demoById(id);
  // Data that only ships for some structures falls back to what every one has.
  const effectiveField = structure.charges ? fieldMode : "element";
  const effectiveMotion = !structure.trajectory && motionMode === "trajectory"
    ? "wobble"
    : motionMode;
  const effectiveVolume = structure.charges ? volumeMode : "density";
  const applyPreset = (preset?: DemoPreset) => {
    if (!preset) return;
    if (preset.layers) setLayers(preset.layers);
    if (preset.figure !== undefined) setFigure(preset.figure);
    if (preset.selectionMode) setSelectionMode(preset.selectionMode);
    if (preset.fieldMode) setFieldMode(preset.fieldMode);
    if (preset.worldLight !== undefined) setWorldLight(preset.worldLight);
    if (preset.materialMode) {
      setMaterialMode(preset.materialMode);
      setRoughness(defaultRoughness(preset.materialMode));
    }
    if (preset.motionMode) setMotionMode(preset.motionMode);
    if (preset.volumeMode) setVolumeMode(preset.volumeMode);
  };
  useEffect(() => {
    const update = () => {
      const route = routeFromHash();
      setId(route.id);
      applyPreset(route.preset);
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
        // Charges ship for 1CRN only: select colours by them and volume's
        // potential sums them. Other structures use element and density.
        const data = structure.charges &&
            (demo.id === "select" || demo.id === "volume")
          ? await loadChargedCrambin(loaded, chargesUrl)
          : loaded;
        if (cancelled) return;
        const host = document.querySelector<HTMLElement>("#molecule-canvas");
        if (host) {
          host.dataset.demo = demo.id;
          host.dataset.fixture = structure.id;
          host.dataset.assertion = demo.assertion;
          host.dataset.orbit = "enabled";
          host.dataset.atomCount = String(data.topology.atoms.count);
          host.dataset.residueCount = String(data.topology.residues.count);
          host.dataset.worldLight = String(demo.id === "surface" && worldLight);
          host.dataset.clipDepth = demo.id === "surface"
            ? String(clipDepth)
            : "";
          const surface = demo.id === "surface";
          host.dataset.environment = surface ? environment : "";
          host.dataset.tonemap = surface ? tonemap : "";
          host.dataset.roughness = surface ? String(roughness) : "";
          host.dataset.fresnel = surface ? String(fresnel) : "";
          host.dataset.bump = surface ? `${bump},${bumpScale}` : "";
          host.dataset.motion = demo.id === "motion" ? effectiveMotion : "";
          host.dataset.volume = demo.id === "volume" ? effectiveVolume : "";
          host.dataset.layers = demo.id === "compose" ? layers.join(",") : "";
          host.dataset.figure = demo.id === "compose" && figure
            ? (shadows ? "shadows" : "plane")
            : "";
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
            host.dataset.sulfurCount = String(
              resolve(element(16), data).indices.length,
            );
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
            structure: structure.id,
            layers,
            fieldMode: effectiveField,
            motionMode: effectiveMotion,
            volumeMode: effectiveVolume,
            surfaceMode,
            surfaceColorMode,
            clipDepth,
            roughness,
            fresnel,
            bump,
            bumpScale,
            measure: { picks, onPick },
            onFocusPick: demo.id === "select" && focusMode
              ? onFocusPick
              : undefined,
            materialMode,
            selectionMode,
            trajectoryMode,
            efieldSpacing,
            seedSpacing,
            lineDistance,
            sliceIndex,
            isoSigma,
          });
        const camera = demoCamera(
          data,
          demo.id,
          { motionMode: effectiveMotion, volumeMode: effectiveVolume },
          time,
        );
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
          worldLight,
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
          // Motion sources differ in tree shape, so each gets its own root.
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
  }, [
    demo,
    structure,
    time,
    layers,
    effectiveField,
    effectiveMotion,
    effectiveVolume,
    worldLight,
    surfaceMode,
    surfaceColorMode,
    clipDepth,
    roughness,
    fresnel,
    bump,
    bumpScale,
    environment,
    tonemap,
    figure,
    shadows,
    focusMode,
    focus,
    focusTime,
    picks,
    materialMode,
    selectionMode,
    trajectoryMode,
    efieldSpacing,
    seedSpacing,
    lineDistance,
    sliceFraction,
    isoSigma,
  ]);
  return (
    <section className="demo-page" aria-labelledby="demo-title">
      <div className="demo-copy">
        <p className="eyebrow">Maintained example</p>
        <h1 id="demo-title">{demo.title}</h1>
        <p>{demo.summary}</p>
        <p className="demo-assertion" data-demo-assertion={demo.id}>
          Behavior: {demo.assertion}.
        </p>
        <label className="timeline-control">
          Structure{" "}
          <select
            aria-label="Example structure"
            value={structure.id}
            onChange={(event) => {
              // Picks are atom rows of the previous structure.
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
        {demo.id === "compose" && (
          <fieldset className="timeline-control">
            <legend>Layers</legend>
            {LAYERS.map(([layer, label]) => (
              <label key={layer}>
                <input
                  type="checkbox"
                  checked={layers.includes(layer)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setLayers((current) =>
                      on
                        ? LAYERS.map(([name]) => name).filter((name) =>
                          name === layer || current.includes(name)
                        )
                        : current.filter((name) => name !== layer)
                    );
                  }}
                />{" "}
                {label}
                {" "}
              </label>
            ))}
          </fieldset>
        )}
        {demo.id === "compose" && (
          <>
            <label className="timeline-control">
              <input
                type="checkbox"
                aria-label="Figure mode"
                checked={figure}
                onChange={(event) => setFigure(event.currentTarget.checked)}
              />{" "}
              Figure mode (ground plane, SSAO)
            </label>
            {figure && (
              <label className="timeline-control">
                <input
                  type="checkbox"
                  aria-label="Cast shadows"
                  checked={shadows}
                  onChange={(event) => setShadows(event.currentTarget.checked)}
                />{" "}
                Key-light shadows
              </label>
            )}
          </>
        )}
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
        {demo.id === "select" && (
          <>
            <label className="timeline-control">
              <input
                type="checkbox"
                aria-label="Click to focus"
                checked={focusMode}
                onChange={(event) => setFocusMode(event.currentTarget.checked)}
              />{" "}
              Click an atom to fly to its residue
            </label>
            <label className="timeline-control">
              Selection{" "}
              <select
                aria-label="Selection query"
                value={selectionMode}
                onChange={(event) =>
                  setSelectionMode(event.currentTarget.value as SelectionMode)}
              >
                <option value="site">{structure.site}</option>
                <option value="cysteine">Cysteine residues</option>
                <option value="sulfur">Sulfur atoms</option>
                <option value="all">All atoms</option>
              </select>
            </label>
            <label className="timeline-control">
              Color{" "}
              <select
                aria-label="Color field"
                value={effectiveField}
                onChange={(event) =>
                  setFieldMode(event.currentTarget.value as FieldMode)}
              >
                <option value="element">Element</option>
                <option value="charge" disabled={!structure.charges}>
                  Partial charge{structure.charges ? "" : " (1CRN only)"}
                </option>
              </select>
            </label>
          </>
        )}
        {demo.id === "surface" && (
          <>
            <label className="timeline-control">
              Surface{" "}
              <select
                aria-label="Surface style"
                value={surfaceMode}
                onChange={(event) => {
                  const mode = event.currentTarget.value as SurfaceMode;
                  setSurfaceMode(mode);
                  setRoughness(
                    mode === "pumice" ? 1 : defaultRoughness(materialMode),
                  );
                }}
              >
                <option value="opaque">Opaque</option>
                <option value="glass">Glass</option>
                <option value="pumice">Pumice</option>
              </select>
            </label>
            <label className="timeline-control">
              Clip{" "}
              <input
                aria-label="Surface clip depth"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={clipDepth}
                onChange={(event) =>
                  setClipDepth(Number(event.currentTarget.value))}
              />{" "}
              <output>{Math.round(clipDepth * 100)}%</output>
            </label>
            <label className="timeline-control">
              Color{" "}
              <select
                aria-label="Surface color field"
                value={surfaceColorMode}
                onChange={(event) =>
                  setSurfaceColorMode(
                    event.currentTarget.value as SurfaceColorMode,
                  )}
              >
                <option value="neutral">Neutral</option>
                <option value="element">Nearest atom element</option>
              </select>
            </label>
            <label className="timeline-control">
              Material{" "}
              <select
                aria-label="Material model"
                value={materialMode}
                disabled={surfaceMode === "pumice"}
                onChange={(event) => {
                  const mode = event.currentTarget.value as MaterialMode;
                  setMaterialMode(mode);
                  setRoughness(defaultRoughness(mode));
                }}
              >
                <option value="matte">Matte PBR</option>
                <option value="metal">Metal PBR</option>
                <option value="basic">Basic</option>
                <option value="normal">Normal debug</option>
              </select>
            </label>
            <label className="timeline-control">
              <input
                type="checkbox"
                aria-label="World-fixed light"
                checked={worldLight}
                onChange={(event) => setWorldLight(event.currentTarget.checked)}
              />{" "}
              World-fixed light
            </label>
            <label className="timeline-control">
              Roughness{" "}
              <input
                aria-label="Surface roughness"
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={roughness}
                disabled={surfaceMode !== "pumice" &&
                  materialMode !== "matte" && materialMode !== "metal"}
                onChange={(event) =>
                  setRoughness(Number(event.currentTarget.value))}
              />{" "}
              <output>{roughness.toFixed(2)}</output>
            </label>
            {surfaceMode === "glass" && (
              <label className="timeline-control">
                <input
                  type="checkbox"
                  aria-label="Fresnel glass"
                  checked={fresnel}
                  disabled={materialMode !== "matte" &&
                    materialMode !== "metal"}
                  onChange={(event) => setFresnel(event.currentTarget.checked)}
                />{" "}
                Fresnel edges
              </label>
            )}
            {surfaceMode === "pumice" && (
              <>
                <label className="timeline-control">
                  Bump{" "}
                  <input
                    aria-label="Pumice bump amplitude"
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={bump}
                    onChange={(event) =>
                      setBump(Number(event.currentTarget.value))}
                  />{" "}
                  <output>{bump.toFixed(2)}</output>
                </label>
                <label className="timeline-control">
                  Grain{" "}
                  <input
                    aria-label="Pumice bump scale"
                    type="range"
                    min="0.4"
                    max="3"
                    step="0.1"
                    value={bumpScale}
                    onChange={(event) =>
                      setBumpScale(Number(event.currentTarget.value))}
                  />{" "}
                  <output>{bumpScale.toFixed(1)}/Å</output>
                </label>
              </>
            )}
            <label className="timeline-control">
              Environment{" "}
              <select
                aria-label="Environment preset"
                value={environment}
                onChange={(event) =>
                  setEnvironment(
                    event.currentTarget.value as EnvironmentPreset,
                  )}
              >
                <option value="none">None</option>
                <option value="park">Park</option>
                <option value="pisa">Pisa</option>
                <option value="road">Road</option>
                <option value="field">Field</option>
              </select>
            </label>
            <label className="timeline-control">
              Tone map{" "}
              <select
                aria-label="Tone mapping"
                value={tonemap}
                onChange={(event) =>
                  setTonemap(event.currentTarget.value as Tonemap)}
              >
                <option value="linear">Linear</option>
                <option value="aces">ACES</option>
                <option value="hable">Hable</option>
                <option value="reinhard">Reinhard</option>
              </select>
            </label>
          </>
        )}
        {demo.id === "motion" && (
          <>
            <label className="timeline-control">
              Source{" "}
              <select
                aria-label="Motion source"
                value={effectiveMotion}
                onChange={(event) =>
                  setMotionMode(event.currentTarget.value as MotionMode)}
              >
                <option value="trajectory" disabled={!structure.trajectory}>
                  XTC trajectory{structure.trajectory ? "" : " (1CRN only)"}
                </option>
                <option value="wobble">GPU coordinate wobble</option>
                <option value="elastic">Elastic network dynamics</option>
                <option value="camera">Camera move</option>
              </select>
            </label>
            <div className="timeline-control">
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
              />{" "}
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
            {effectiveMotion === "trajectory" && (
              <label className="timeline-control">
                Representation{" "}
                <select
                  aria-label="Trajectory representation"
                  value={trajectoryMode}
                  onChange={(event) =>
                    setTrajectoryMode(
                      event.currentTarget.value as TrajectoryMode,
                    )}
                >
                  <option value="tube">Backbone tube</option>
                  <option value="ball-and-stick">Ball and stick</option>
                </select>
              </label>
            )}
          </>
        )}
        {demo.id === "volume" && (
          <>
            <label className="timeline-control">
              Volume{" "}
              <select
                aria-label="Volume source"
                value={effectiveVolume}
                onChange={(event) =>
                  setVolumeMode(event.currentTarget.value as VolumeMode)}
              >
                <option value="density">Atom density map</option>
                <option value="potential" disabled={!structure.charges}>
                  Electrostatic potential{structure.charges
                    ? ""
                    : " (1CRN only)"}
                </option>
              </select>
            </label>
            {effectiveVolume === "density" && (
              <>
                <label className="timeline-control">
                  Slice{" "}
                  <input
                    aria-label="Slice position"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={sliceFraction}
                    onChange={(event) =>
                      setSliceFraction(Number(event.currentTarget.value))}
                  />{" "}
                  <output data-output="slice">
                    {Math.round(sliceFraction * 100)}%
                  </output>
                </label>
                <label className="timeline-control">
                  Isolevel{" "}
                  <input
                    aria-label="Isosurface level in sigma"
                    type="range"
                    min="0.5"
                    max="4"
                    step="0.1"
                    value={isoSigma}
                    onChange={(event) =>
                      setIsoSigma(Number(event.currentTarget.value))}
                  />{" "}
                  <output data-output="iso">{isoSigma.toFixed(1)} σ</output>
                </label>
              </>
            )}
            {effectiveVolume === "potential" && (
              <details className="timeline-control">
                <summary>Advanced</summary>
                <label className="timeline-control">
                  Grid spacing{" "}
                  <select
                    aria-label="Potential grid spacing"
                    value={efieldSpacing}
                    onChange={(event) =>
                      setEfieldSpacing(Number(event.currentTarget.value))}
                  >
                    <option value={1.5}>Coarse · 1.5 Å</option>
                    <option value={1}>Standard · 1 Å</option>
                    <option value={0.75}>Fine · 0.75 Å</option>
                  </select>
                </label>
                <label className="timeline-control">
                  Field line density{" "}
                  <select
                    aria-label="Field line seed spacing"
                    value={seedSpacing}
                    onChange={(event) =>
                      setSeedSpacing(Number(event.currentTarget.value))}
                  >
                    <option value={9}>Sparse · 9 Å</option>
                    <option value={7}>Standard · 7 Å</option>
                    <option value={3.5}>Dense · 3.5 Å</option>
                  </select>
                </label>
                <label className="timeline-control">
                  Field line distance{" "}
                  <select
                    aria-label="Field line distance"
                    value={lineDistance}
                    onChange={(event) =>
                      setLineDistance(Number(event.currentTarget.value))}
                  >
                    <option value={18}>Short · 18 Å</option>
                    <option value={30}>Standard · 30 Å</option>
                    <option value={60}>Long · 60 Å</option>
                  </select>
                </label>
              </details>
            )}
          </>
        )}
        <p className="hint">
          Drag or touch-drag to orbit; scroll, trackpad, or pinch to zoom.
        </p>
        <button type="button" onClick={() => void savePng(demo.id)}>
          Save PNG
        </button>
        <nav className="demo-links" aria-label="Demo gallery">
          {demos.map((item) => (
            <a
              key={item.id}
              href={`#demos/${item.id}`}
              aria-current={item.id === demo.id ? "page" : undefined}
            >
              {item.title}
            </a>
          ))}
        </nav>
      </div>
      <div
        id="molecule-canvas"
        className="molecule-canvas"
        aria-label="Interactive molecular WebGPU demo"
      >
        <p data-webgpu-error="true" role="status">Preparing WebGPU…</p>
      </div>
      <SourcePanel id={demo.id} />
    </section>
  );
};
