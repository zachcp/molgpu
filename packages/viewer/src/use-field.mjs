import { useContext, useMemo } from '@use-gpu/live';
import { useShader } from '@use-gpu/workbench';
import { loadModuleWithCache } from '@use-gpu/shader/wgsl';
import { compile } from '@molgpu/fields';
import { TimelineContext } from './timeline-context.mjs';

/**
 * Lower a numeric `@molgpu/fields` Field to a use.gpu shader source, composing
 * it over existing GPU inputs instead of materialising a per-row array.
 *
 * `inputs` maps each compiled binding id to a use.gpu value: a StorageSource for
 * a buffer input (e.g. the already-uploaded `attr:element` column) and a number
 * or ShaderRef for a uniform input. Because the field is composed shader-side,
 * a per-atom colour/size column is never uploaded, and changing a uniform value
 * is a binding update — no re-upload. This is the viewer-owned GPU lowering that
 * `@molgpu/fields` deliberately leaves out (its API exposes no ShaderSource).
 */
export const useField = (field, inputs, { domain } = {}) => {
  const time = useContext(TimelineContext);
  const compiled = useMemo(() => compile(field, { target: 'link', domain }), [field, domain]);
  const module = useMemo(() => loadModuleWithCache(compiled.wgsl, 'molgpu-field', 'auto'), [compiled.wgsl]);
  const values = compiled.bindings.map((b) => {
    const value = inputs?.[b.id] ?? (b.id === 'curve:t' ? time ?? undefined : undefined);
    if (value === undefined) throw new Error(`useField: no input provided for '${b.id}'`);
    return value;
  });
  return useShader(module, values);
};
