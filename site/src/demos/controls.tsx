import React from "react";
import type { ComposeLayer, DemoId, StructureDefinition } from "./registry.ts";
import { defaultRoughness, type DemoSettings } from "./options.ts";

const LAYERS: readonly (readonly [ComposeLayer, string])[] = [
  ["cartoon", "Cartoon"],
  ["tube", "Tube"],
  ["sticks", "Ball and stick"],
  ["spacefill", "Spacefill"],
  ["surface", "Glass surface"],
  ["measure", "Measure (click atoms)"],
];

const Choice = <T extends string>(
  { label, name = label, value, options, onChange, disabled }: {
    label: string;
    name?: string;
    value: T;
    options: readonly (readonly [T, string, boolean?])[];
    onChange: (value: T) => void;
    disabled?: boolean;
  },
) => (
  <label className="timeline-control">
    {label}
    <select
      aria-label={name}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value as T)}
    >
      {options.map(([key, title, disabled]) => (
        <option key={key} value={key} disabled={disabled}>{title}</option>
      ))}
    </select>
  </label>
);

const Toggle = ({ label, name = label, value, onChange, disabled }: {
  label: string;
  name?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) => (
  <label className="timeline-control toggle-control">
    <input
      type="checkbox"
      aria-label={name}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    {label}
  </label>
);

const Slider = (
  { label, name, value, min, max, step, output, onChange, disabled, readout }: {
    label: string;
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
    output: string;
    onChange: (value: number) => void;
    disabled?: boolean;
    readout?: string;
  },
) => (
  <label className="timeline-control">
    {label}
    <input
      type="range"
      aria-label={name}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
    <output data-output={readout}>{output}</output>
  </label>
);

/** Ordinary React controls; the example files stay focused on molecular JSX. */
export const DemoControls = ({ id, settings: s, structure, onChange: change }: {
  id: DemoId;
  settings: DemoSettings;
  structure: StructureDefinition;
  onChange: (patch: Partial<DemoSettings>) => void;
}) => {
  switch (id) {
    case "compose":
      return (
        <>
          <fieldset className="timeline-control layer-controls">
            <legend>Layers</legend>
            {LAYERS.map(([layer, label]) => (
              <Toggle
                key={layer}
                label={label}
                value={s.layers.includes(layer)}
                onChange={(on) =>
                  change({
                    layers: on
                      ? LAYERS.map(([name]) => name).filter((name) =>
                        name === layer || s.layers.includes(name)
                      )
                      : s.layers.filter((name) => name !== layer),
                  })}
              />
            ))}
          </fieldset>
          <Toggle
            label="Figure mode (ground plane, SSAO)"
            name="Figure mode"
            value={s.figure}
            onChange={(figure) => change({ figure })}
          />
          {s.figure && (
            <Toggle
              label="Key-light shadows"
              name="Cast shadows"
              value={s.shadows}
              onChange={(shadows) => change({ shadows })}
            />
          )}
        </>
      );
    case "select":
      return (
        <>
          <Toggle
            label="Click an atom to fly to its residue"
            name="Click to focus"
            value={s.focusMode}
            onChange={(focusMode) => change({ focusMode })}
          />
          <Choice
            label="Selection"
            name="Selection query"
            value={s.selectionMode}
            options={[
              ["site", structure.site],
              ["cysteine", "Cysteine residues"],
              ["sulfur", "Sulfur atoms"],
              ["all", "All atoms"],
            ]}
            onChange={(selectionMode) => change({ selectionMode })}
          />
          <Choice
            label="Color"
            name="Color field"
            value={structure.charges ? s.fieldMode : "element"}
            options={[
              ["element", "Element"],
              [
                "charge",
                `Partial charge${structure.charges ? "" : " (1CRN only)"}`,
                !structure.charges,
              ],
            ]}
            onChange={(fieldMode) => change({ fieldMode })}
          />
        </>
      );
    case "surface": {
      const pbr = s.materialMode === "matte" || s.materialMode === "metal";
      return (
        <>
          <Choice
            label="Surface"
            name="Surface style"
            value={s.surfaceMode}
            options={[
              ["opaque", "Opaque"],
              ["glass", "Glass"],
              ["pumice", "Pumice"],
            ]}
            onChange={(surfaceMode) =>
              change({
                surfaceMode,
                roughness: surfaceMode === "pumice"
                  ? 1
                  : defaultRoughness(s.materialMode),
              })}
          />
          <Choice
            label="Type"
            name="Surface type"
            value={s.surfaceKind}
            options={[
              ["accessible", "Solvent-accessible"],
              ["excluded", "Solvent-excluded"],
            ]}
            onChange={(surfaceKind) => change({ surfaceKind })}
          />
          <div className="timeline-control">
            Clip
            <span className="dual-range">
              <input
                aria-label="Clip front"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.clip[0]}
                onChange={(event) =>
                  change({
                    clip: [
                      Math.min(
                        Number(event.currentTarget.value),
                        s.clip[1] - 0.02,
                      ),
                      s.clip[1],
                    ],
                  })}
              />
              <input
                aria-label="Clip back"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={s.clip[1]}
                onChange={(event) =>
                  change({
                    clip: [
                      s.clip[0],
                      Math.max(
                        Number(event.currentTarget.value),
                        s.clip[0] + 0.02,
                      ),
                    ],
                  })}
              />
            </span>
            <output>
              {s.clip[0] === 0 && s.clip[1] === 1
                ? "off"
                : `${Math.round(s.clip[0] * 100)}–${
                  Math.round(s.clip[1] * 100)
                }%`}
            </output>
          </div>
          <Choice
            label="Color"
            name="Surface color field"
            value={s.surfaceColorMode}
            options={[
              ["neutral", "Neutral"],
              ["element", "Nearest atom element"],
            ]}
            onChange={(surfaceColorMode) => change({ surfaceColorMode })}
          />
          <Choice
            label="Material"
            name="Material model"
            value={s.materialMode}
            disabled={s.surfaceMode === "pumice"}
            options={[
              ["matte", "Matte PBR"],
              ["metal", "Metal PBR"],
              ["basic", "Basic"],
              ["normal", "Normal debug"],
            ]}
            onChange={(materialMode) =>
              change({
                materialMode,
                roughness: defaultRoughness(materialMode),
              })}
          />
          <Slider
            label="Roughness"
            name="Surface roughness"
            min={0.05}
            max={1}
            step={0.05}
            value={s.roughness}
            output={s.roughness.toFixed(2)}
            disabled={s.surfaceMode !== "pumice" && !pbr}
            onChange={(roughness) => change({ roughness })}
          />
          {s.surfaceMode === "glass" && (
            <Toggle
              label="Fresnel edges"
              name="Fresnel glass"
              value={s.fresnel}
              disabled={!pbr}
              onChange={(fresnel) => change({ fresnel })}
            />
          )}
          {s.surfaceMode === "pumice" && (
            <>
              <Slider
                label="Bump"
                name="Pumice bump amplitude"
                min={0}
                max={1.5}
                step={0.05}
                value={s.bump}
                output={s.bump.toFixed(2)}
                onChange={(bump) => change({ bump })}
              />
              <Slider
                label="Grain"
                name="Pumice bump scale"
                min={0.4}
                max={3}
                step={0.1}
                value={s.bumpScale}
                output={`${s.bumpScale.toFixed(1)}/Å`}
                onChange={(bumpScale) => change({ bumpScale })}
              />
            </>
          )}
          <Choice
            label="Environment"
            name="Environment preset"
            value={s.environment}
            options={[
              ["none", "None"],
              ["park", "Park"],
              ["pisa", "Pisa"],
              ["road", "Road"],
              ["field", "Field"],
            ]}
            onChange={(environment) => change({ environment })}
          />
          <Choice
            label="Tone map"
            name="Tone mapping"
            value={s.tonemap}
            options={[
              ["linear", "Linear"],
              ["aces", "ACES"],
              ["hable", "Hable"],
              ["reinhard", "Reinhard"],
            ]}
            onChange={(tonemap) => change({ tonemap })}
          />
        </>
      );
    }
    case "motion": {
      const motion = !structure.trajectory && s.motionMode === "trajectory"
        ? "wobble"
        : s.motionMode;
      return (
        <>
          <Choice
            label="Source"
            name="Motion source"
            value={motion}
            options={[
              [
                "trajectory",
                `XTC trajectory${structure.trajectory ? "" : " (1CRN only)"}`,
                !structure.trajectory,
              ],
              ["wobble", "GPU coordinate wobble"],
              ["elastic", "Elastic network dynamics"],
              ["camera", "Camera move"],
            ]}
            onChange={(motionMode) => change({ motionMode })}
          />
          {motion === "trajectory" && (
            <>
              <Choice
                label="Representation"
                name="Trajectory representation"
                value={s.trajectoryMode}
                options={[
                  ["tube", "Backbone tube"],
                  ["ball-and-stick", "Ball and stick"],
                ]}
                onChange={(trajectoryMode) => change({ trajectoryMode })}
              />
              <Toggle
                label="Ramachandran plot"
                value={s.ramachandran}
                onChange={(ramachandran) => change({ ramachandran })}
              />
            </>
          )}
        </>
      );
    }
    case "volume":
      return (
        <>
          <Choice
            label="Volume"
            name="Volume source"
            value={structure.charges ? s.volumeMode : "density"}
            options={[
              ["density", "Atom density map"],
              [
                "potential",
                `Electrostatic potential${
                  structure.charges ? "" : " (1CRN only)"
                }`,
                !structure.charges,
              ],
            ]}
            onChange={(volumeMode) => change({ volumeMode })}
          />
          {(!structure.charges || s.volumeMode === "density")
            ? (
              <>
                <Slider
                  label="Slice"
                  name="Slice position"
                  min={0}
                  max={1}
                  step={0.01}
                  value={s.sliceFraction}
                  output={`${Math.round(s.sliceFraction * 100)}%`}
                  readout="slice"
                  onChange={(sliceFraction) => change({ sliceFraction })}
                />
                <Slider
                  label="Isolevel"
                  name="Isosurface level in sigma"
                  min={0.5}
                  max={4}
                  step={0.1}
                  value={s.isoSigma}
                  output={`${s.isoSigma.toFixed(1)} σ`}
                  readout="iso"
                  onChange={(isoSigma) => change({ isoSigma })}
                />
              </>
            )
            : (
              <details className="advanced-controls">
                <summary>Advanced</summary>
                <Choice
                  label="Grid spacing"
                  name="Potential grid spacing"
                  value={String(s.efieldSpacing)}
                  options={[
                    ["1.5", "Coarse · 1.5 Å"],
                    ["1", "Standard · 1 Å"],
                    ["0.75", "Fine · 0.75 Å"],
                  ]}
                  onChange={(value) => change({ efieldSpacing: Number(value) })}
                />
                <Choice
                  label="Field line density"
                  name="Field line seed spacing"
                  value={String(s.seedSpacing)}
                  options={[
                    ["9", "Sparse · 9 Å"],
                    ["7", "Standard · 7 Å"],
                    ["3.5", "Dense · 3.5 Å"],
                  ]}
                  onChange={(value) => change({ seedSpacing: Number(value) })}
                />
                <Choice
                  label="Field line distance"
                  name="Field line distance"
                  value={String(s.lineDistance)}
                  options={[
                    ["18", "Short · 18 Å"],
                    ["30", "Standard · 30 Å"],
                    ["60", "Long · 60 Å"],
                  ]}
                  onChange={(value) => change({ lineDistance: Number(value) })}
                />
              </details>
            )}
        </>
      );
  }
};
