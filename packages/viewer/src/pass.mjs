import { use } from '@use-gpu/live';
import { Pass as UpstreamPass } from '@use-gpu/workbench';

/**
 * Thin @molgpu/viewer wrapper over @use-gpu/workbench's <Pass> — the scene-level
 * render pass that draws the representations and hosts the lights. It adds one
 * molecular default and nothing else: `lights` defaults on, because a molecular
 * scene is always lit and, without it, the light components warn and do nothing.
 *
 * Postprocessing is opt-in through the upstream flags, forwarded untouched:
 *   - `ssao`    — screen-space ambient occlusion: `true`, an intensity number,
 *                 or a Partial<SSAOOptions>. Enabling it also turns on the normal
 *                 and motion buffers it needs (handled upstream).
 *   - `outline` — silhouette/edge outline: `true`, a width number, or a
 *                 Partial<OutlineOptions>. Enabling it turns on the normal buffer.
 *   - `oit`     — order-independent transparency: `true` or a Partial<OITOptions>.
 *                 The pass that matters for transparent molecular surfaces, where
 *                 painter's-order alpha blending would otherwise show seams.
 * Depth of field is not offered: it does not exist upstream in this version
 * (tracked as molgpu-sept-hj0.5).
 */
export const Pass = ({ lights = true, ...props }) => use(UpstreamPass, { lights, ...props });
