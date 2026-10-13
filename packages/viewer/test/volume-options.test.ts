import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { ColorStops } from "../src/types.ts";
import { normalizeFieldArrowsOptions as arrows } from "../src/volume/representations/field-arrows-options.ts";
import { normalizeFieldLinesOptions as lines } from "../src/volume/representations/field-lines-options.ts";
import { normalizeVolumeSliceOptions as slice } from "../src/volume/representations/volume-slice-options.ts";
import { colorRampWgsl } from "../src/volume/representations/color-ramp.ts";

Deno.test("volume options preserve borrowed inputs and scientific defaults", () => {
  const color = Float32Array.of(1, 0, 0, 1);
  const range = [0, 2] as const;
  const seeds = Float32Array.of(0, 0, 0);
  const stops: ColorStops = [[1, [1, 1, 1, 1]], [0, [0, 0, 0, 1]]];
  const options = arrows({ spacing: 4, color, colorRange: range, stops });
  assertEquals(options.maxLength, 3.6);
  assertStrictEquals(options.color, color);
  assertStrictEquals(options.colorRange, range);
  assertStrictEquals(options.stops, stops);
  assertStrictEquals(lines({ seeds }).seeds, seeds);
  assertEquals(lines({}).step, 0.25);
  assertEquals(lines({}).steps, 128);
  assertEquals(lines({}).maxLines, 4096);
  assertEquals(
    lines({}).maxPotential,
    undefined,
    "cap stays nearest-volume dependent",
  );
  const fallback = [4, -4] as const;
  assertStrictEquals(slice({ stops }, fallback).range, fallback);
  assertStrictEquals(slice({ stops }, fallback).stops, stops);
  assertEquals(
    stops[0][0],
    1,
    "normalization must not sort the borrowed array",
  );
});

Deno.test("volume options reject nonfinite ranges before binding", () => {
  for (
    const range of [[0, Infinity], [-Infinity, 1], [NaN, 1], [0, 1e100], [
      1,
      1,
    ]] as const
  ) {
    assertThrows(() => arrows({ colorRange: range }), TypeError);
    assertThrows(() => lines({ colorRange: range }), TypeError);
    assertThrows(() => slice({ range }, [0, 1]), TypeError);
  }
  assertThrows(() => arrows({ colorRange: [1, 0] }), TypeError);
  assertThrows(() => lines({ colorRange: [1, 0] }), TypeError);
  assertEquals(slice({ range: [1, 0] }, [0, 1]).range, [1, 0]);
});

Deno.test("volume ramps reject malformed entries and preserve single/duplicate stop policies", () => {
  const malformed = [[], [[0, [Infinity, 0, 0, 1]]], [[NaN, [0, 0, 0, 1]]], [[
    0,
    [0, 0, 0],
  ]], [[0, ["1", 0, 0, 1]]]];
  for (const bad of malformed) {
    const stops = bad as unknown as ColorStops;
    assertThrows(() => arrows({ colorRange: [0, 1], stops }), TypeError);
    assertThrows(() => lines({ colorRange: [0, 1], stops }), TypeError);
    assertThrows(() => slice({ stops }, [0, 1]), TypeError);
    assertThrows(() => colorRampWgsl(stops), TypeError);
  }
  const single: ColorStops = [[0.5, [1, 0, 0, 1]]];
  assertStrictEquals(
    arrows({ colorRange: [0, 1], stops: single }).stops,
    single,
  );
  assertStrictEquals(
    lines({ colorRange: [0, 1], stops: single }).stops,
    single,
  );
  assertThrows(() => slice({ stops: single }, [0, 1]), TypeError);
  const duplicate: ColorStops = [[0, [0, 0, 0, 1]], [0, [1, 1, 1, 1]]];
  assertStrictEquals(slice({ stops: duplicate }, [0, 1]).stops, duplicate);
  assertEquals(colorRampWgsl(duplicate).includes("mix("), true);
  assertEquals(
    arrows({ stops: [] }).stops,
    [],
    "unused glyph stops remain ignored",
  );
});

Deno.test("field scalar controls retain strict positive/integer validation", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    for (const name of ["width", "scale", "spacing", "minField", "maxLength"]) {
      assertThrows(() => arrows({ [name]: value }), TypeError);
    }
    for (
      const name of [
        "width",
        "step",
        "minField",
        "maxPotential",
        "steps",
        "maxLines",
      ]
    ) {
      assertThrows(() => lines({ [name]: value }), TypeError);
    }
  }
  assertThrows(() => lines({ steps: 1.5 }), TypeError);
  assertThrows(() => slice({ opacity: 2 }, [0, 1]), RangeError);
});

Deno.test("volume ranges reject collapse and nonfinite width at GPU precision", () => {
  for (
    const range of [[1, 1 + 1e-8], [0, 1e-50], [-3e38, 3e38]] as const
  ) {
    assertThrows(() => arrows({ colorRange: range }), TypeError, "FieldArrows");
    assertThrows(() => lines({ colorRange: range }), TypeError, "FieldLines");
    assertThrows(() => slice({ range }, [0, 1]), TypeError, "VolumeSlice");
    const reversed = [range[1], range[0]] as const;
    assertThrows(() => slice({ range: reversed }, [0, 1]), TypeError);
  }
  // Adjacent f32 values and a subnormal interval still have usable widths.
  for (const range of [[1, 1 + 2 ** -23], [0, 2 ** -149]] as const) {
    assertStrictEquals(arrows({ colorRange: range }).colorRange, range);
    assertStrictEquals(lines({ colorRange: range }).colorRange, range);
    assertStrictEquals(slice({ range }, [0, 1]).range, range);
    const reversed = [range[1], range[0]] as const;
    assertStrictEquals(slice({ range: reversed }, [0, 1]).range, reversed);
  }
});

Deno.test("volume ramps reject holes in stops and every RGBA channel", () => {
  const complete = [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]] as const;
  const sparse = new Array(2);
  sparse[1] = complete[1];
  const malformed = [sparse];
  for (let i = 0; i < 4; i++) {
    const rgba = [1, 1, 1, 1];
    delete rgba[i];
    malformed.push([[0, rgba], complete[1]]);
  }
  for (const bad of malformed) {
    const stops = bad as unknown as ColorStops;
    assertThrows(
      () => arrows({ colorRange: [0, 1], stops }),
      TypeError,
      "FieldArrows",
    );
    assertThrows(
      () => lines({ colorRange: [0, 1], stops }),
      TypeError,
      "FieldLines",
    );
    assertThrows(() => slice({ stops }, [0, 1]), TypeError, "VolumeSlice");
    assertThrows(() => colorRampWgsl(stops), TypeError, "Color ramp");
    assertStrictEquals(arrows({ stops }).stops, stops);
    assertStrictEquals(lines({ stops }).stops, stops);
  }
});
