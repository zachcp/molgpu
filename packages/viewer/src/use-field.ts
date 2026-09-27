import { useContext, useMemo } from "@use-gpu/live";
import { useShader } from "@use-gpu/workbench";
import { loadModuleWithCache } from "@use-gpu/shader/wgsl";
import { compile, type Field, readsNearestVolume } from "@molgpu/fields";
import type { ShaderSource } from "@use-gpu/shader";
import { TimelineContext } from "./timeline-context.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";
import { useVolumeSources } from "./internal/volume-buffers.ts";
import { VolumeContext } from "./volume-context.ts";

/**
 * Lower a numeric `@molgpu/fields` Field to a use.gpu shader source, composing
 * it over existing GPU inputs instead of materialising a per-row array.
 *
 * `inputs` maps each compiled binding id to a use.gpu value: a StorageSource for
 * a buffer input (e.g. the already-uploaded `attr:element` column or the row's
 * `positions`) and a number or ShaderRef for a uniform input. A `volumeSample`
 * field's `volume:<n>` input is bound here to the volume's shared GPU samples,
 * and an argument-free `volumeSample()` (`volume:nearest`) to the nearest
 * `<Volume>`/`<EField>`'s live samples. Because the field is composed shader-side,
 * a per-atom colour/size column is never uploaded, and changing a uniform value
 * is a binding update — no re-upload. This is the viewer-owned GPU lowering that
 * `@molgpu/fields` deliberately leaves out (its API exposes no ShaderSource).
 */
export function useField(
  field: Field,
  inputs?: Record<string, ShaderSource | number | { current: number }>,
  options: { domain?: "atom" | "residue" } = {},
): ShaderSource {
  const { domain } = options;
  const time = useContext(TimelineContext);
  const nearest = useContext(VolumeContext);
  useBindingProbe("field", field, time);
  // Only a field that samples the nearest volume depends on its grid.
  const grid = readsNearestVolume(field) ? nearest?.grid : undefined;
  const compiled = useMemo(
    () => compile(field, { target: "link", domain, volume: grid }),
    [field, domain, grid],
  );
  const module = useMemo(
    () => loadModuleWithCache(compiled.wgsl, "molgpu-field", "auto"),
    [compiled.wgsl],
  );
  // volumeSample inputs bind the volume's shared GPU samples, never a copy.
  const volumes = useVolumeSources(
    useMemo(
      () =>
        compiled.bindings.flatMap((b) =>
          b.volume ? [{ id: b.id, volume: b.volume }] : []
        ),
      [compiled],
    ),
  );
  const values = compiled.bindings.map((b) => {
    const value = inputs?.[b.id] ?? volumes[b.id] ??
      (b.id === "volume:nearest" ? nearest?.source : undefined) ??
      (b.id === "curve:t" ? time ?? undefined : undefined);
    if (value === undefined) {
      throw new Error(`useField: no input provided for '${b.id}'`);
    }
    return value;
  });
  return useShader(module, values);
}
