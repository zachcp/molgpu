import React, { useEffect, useState } from "react";
import type { StructureData } from "@molgpu/table";
import crambinUrl from "../../../packages/io/test/fixtures/1crn.bcif?url";
import chargesUrl from "../../../packages/io/test/fixtures/1crn-amber.pqr?url";
import { attributeColumn } from "@molgpu/table";
import {
  densityMapFor,
  loadChargedCrambin,
  loadCrambin,
} from "../demos/data.ts";
import { demoById, demoCamera, type DemoId, demos } from "../demos/registry.ts";
import {
  type MaterialMode,
  renderDemoScene,
  type SurfaceMode,
} from "../demos/scenes.tsx";
import { mountViewer } from "../demos/viewer.tsx";

/** Demos whose scene is driven by the scrub slider's seconds. */
const scrubbed = (id: DemoId): boolean =>
  id === "timeline" || id === "coordinates" || id === "trajectory";
const SCRUB_DURATION = 4;

const demoFromHash = (): DemoId =>
  demoById(location.hash.replace(/^#demos\/?/, "")).id;

export const DemosPage = () => {
  const [id, setId] = useState<DemoId>(demoFromHash);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("glass");
  const [materialMode, setMaterialMode] = useState<MaterialMode>("matte");
  // Slice position as a fraction of the map's k extent, and isolevel in sigma.
  const [sliceFraction, setSliceFraction] = useState(0.5);
  const [isoSigma, setIsoSigma] = useState(2);
  const demo = demoById(id);
  useEffect(() => {
    const update = () => setId(demoFromHash());
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [id]);
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
      if (status) status.textContent = "Loading real 1CRN structure…";
      try {
        const crambin = await loadCrambin(crambinUrl);
        const data = demo.id === "charge" || demo.id === "efield"
          ? await loadChargedCrambin(crambin, chargesUrl)
          : crambin;
        if (cancelled) return;
        const host = document.querySelector<HTMLElement>("#molecule-canvas");
        if (host) {
          host.dataset.demo = demo.id;
          host.dataset.fixture = demo.fixture;
          host.dataset.assertion = demo.assertion;
          host.dataset.orbit = "enabled";
        }
        const sliceIndex = demo.id === "volume"
          ? sliceFraction * (densityMapFor(data).dims[2] - 1)
          : 0;
        if (host && demo.id === "charge") {
          const charge = attributeColumn(data, "partialCharge")!;
          let net = 0;
          for (const q of charge.values) net += q;
          host.dataset.netCharge = net.toFixed(3);
          host.dataset.chargeProvenance = charge.provenance;
        }
        if (host && demo.id === "volume") {
          host.dataset.sliceIndex = sliceIndex.toFixed(2);
        }
        const scene = (current: StructureData) =>
          renderDemoScene(demo.id, current, {
            surfaceMode,
            materialMode,
            sliceIndex,
            isoSigma,
          });
        mountViewer(
          demo.id,
          "#molecule-canvas",
          data,
          scene,
          demoCamera(data, demo.id),
          scrubbed(demo.id) ? { ...demo.options, time } : demo.options,
        );
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
  }, [demo, time, surfaceMode, materialMode, sliceFraction, isoSigma]);
  return (
    <section className="demo-page" aria-labelledby="demo-title">
      <div className="demo-copy">
        <p className="eyebrow">Maintained example</p>
        <h1 id="demo-title">{demo.title}</h1>
        <p>{demo.summary}</p>
        <p className="demo-assertion" data-demo-assertion={demo.id}>
          Behavior: {demo.assertion}.
        </p>
        {scrubbed(demo.id) && (
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
        )}
        {demo.id === "surface" && (
          <label className="timeline-control">
            Surface{" "}
            <select
              aria-label="Surface material"
              value={surfaceMode}
              onChange={(event) =>
                setSurfaceMode(event.currentTarget.value as SurfaceMode)}
            >
              <option value="opaque">Opaque</option>
              <option value="glass">Glass</option>
              <option value="pumice">Pumice</option>
            </select>
          </label>
        )}
        {demo.id === "volume" && (
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
        {demo.id === "materials" && (
          <label className="timeline-control">
            Material{" "}
            <select
              aria-label="Material model"
              value={materialMode}
              onChange={(event) =>
                setMaterialMode(event.currentTarget.value as MaterialMode)}
            >
              <option value="matte">Matte PBR</option>
              <option value="metal">Metal PBR</option>
              <option value="basic">Basic</option>
              <option value="normal">Normal debug</option>
            </select>
          </label>
        )}
        <p className="hint">
          Drag or touch-drag to orbit; scroll, trackpad, or pinch to zoom.
        </p>
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
    </section>
  );
};
