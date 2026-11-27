// A left-to-right row of matrices joined by the ops between them: inputs on
// the left, outputs on the right. Each column is a `Heatmap` over a GPU buffer:
// a model tensor, or one this panel owns and rewrites for the hovered residue.
// Columns whose rows are residues share one row height so a residue lines up
// across them, and hovering one selects that residue.
import { Heatmap, type HeatmapPalette } from "./heatmap.ts";

export interface FlowColumn {
  readonly key: string;
  readonly title: string;
  /** Shape or meaning, shown under the title. */
  readonly note: string;
  /** The op that produced this column from the one before, drawn as an arrow. */
  readonly op?: string;
  readonly rows: number;
  readonly cols: number;
  readonly palette: HeatmapPalette;
  readonly scale: number;
  /** A model tensor's buffer; or omit and give `values`. */
  readonly buffer?: GPUBuffer;
  /** Values for hovered residue i, written into a buffer the panel owns. */
  readonly values?: (i: number) => Float32Array;
  readonly rowLabels?: readonly string[] | ((i: number) => readonly string[]);
  /** Evenly spaced labels across the top, such as the 21 letters. */
  readonly colLabels?: readonly string[];
  /** Rows are model positions: tint the hovered one, and hovering selects. */
  readonly residueRows?: boolean;
  /** Row to tint for hovered residue i when rows are not residues. */
  readonly highlight?: (i: number) => number;
  /** Relative width. */
  readonly width: number;
}

interface Cell {
  readonly column: FlowColumn;
  readonly element: HTMLElement;
  readonly map: Heatmap;
  readonly gutter: HTMLElement | null;
  readonly owned: GPUBuffer | null;
}

const STORAGE_COPY_DST = 0x0080 | 0x0008;

export class FlowPanel {
  readonly element: HTMLElement;
  #device: GPUDevice;
  #cells: Cell[] = [];
  #hovered = -1;

  constructor(
    device: GPUDevice,
    host: HTMLElement,
    title: string,
    columns: readonly FlowColumn[],
    onHover: (residue: number) => void,
  ) {
    this.#device = device;
    this.element = document.createElement("div");
    this.element.className = "mpnn-flow";
    const heading = document.createElement("p");
    heading.className = "mpnn-flow-title";
    heading.innerHTML = title;
    const row = document.createElement("div");
    row.className = "mpnn-flow-row";
    this.element.append(heading, row);
    host.append(this.element);
    for (const column of columns) {
      if (column.op) {
        const arrow = document.createElement("div");
        arrow.className = "mpnn-flow-op";
        arrow.innerHTML = `<span>${column.op}</span><b>→</b>`;
        row.append(arrow);
      }
      const element = document.createElement("div");
      element.className = "mpnn-flow-col";
      element.dataset.column = column.key;
      element.style.flexGrow = String(column.width);
      element.innerHTML =
        `<p><strong>${column.title}</strong><small>${column.note}</small></p>` +
        (column.colLabels
          ? `<div class="mpnn-flow-cols">${
            column.colLabels.map((l) => `<i>${l}</i>`).join("")
          }</div>`
          : `<div class="mpnn-flow-cols"></div>`) +
        `<div class="mpnn-flow-body"><span class="mpnn-flow-gutter"></span><canvas></canvas></div>`;
      row.append(element);
      const canvas = element.querySelector("canvas")!;
      const gutter = column.rowLabels
        ? element.querySelector<HTMLElement>(".mpnn-flow-gutter")!
        : null;
      if (!gutter) element.querySelector(".mpnn-flow-gutter")!.remove();
      const owned = column.buffer ? null : device.createBuffer({
        size: Math.max(16, 4 * column.rows * column.cols),
        usage: STORAGE_COPY_DST,
        label: `mpnn:flow:${column.key}`,
      });
      const map = new Heatmap(device, canvas, column.buffer ?? owned!, {
        rows: column.rows,
        cols: column.cols,
        palette: column.palette,
        scale: column.scale,
      });
      if (column.residueRows) {
        canvas.classList.add("residues");
        canvas.addEventListener("mousemove", (event) => {
          const residue = map.rowAt(event);
          if (residue >= 0) onHover(residue);
        });
      }
      this.#cells.push({ column, element, map, gutter, owned });
      if (gutter && Array.isArray(column.rowLabels)) {
        this.#label(gutter, column.rowLabels as readonly string[]);
      }
    }
  }

  /** Show residue i: tint its rows and refill the columns that depend on it. */
  highlight(i: number): void {
    if (i === this.#hovered || i < 0) return;
    this.#hovered = i;
    for (const { column, map, gutter, owned } of this.#cells) {
      if (owned && column.values) {
        const values = column.values(i);
        this.#device.queue.writeBuffer(
          owned,
          0,
          values.buffer,
          values.byteOffset,
          values.byteLength,
        );
      }
      if (gutter && typeof column.rowLabels === "function") {
        this.#label(gutter, column.rowLabels(i));
      }
      const row = column.residueRows ? i : column.highlight?.(i) ?? -1;
      map.highlight(row);
      map.draw();
    }
  }

  /** Mark the columns the current forward-pass step writes. */
  activate(keys: readonly string[]): void {
    for (const { column, element } of this.#cells) {
      element.classList.toggle("active", keys.includes(column.key));
    }
  }

  destroy(): void {
    for (const { map, owned } of this.#cells) {
      map.destroy();
      owned?.destroy();
    }
    this.#cells = [];
    this.element.remove();
  }

  #label(gutter: HTMLElement, labels: readonly string[]): void {
    gutter.style.gridTemplateRows = `repeat(${labels.length}, 1fr)`;
    gutter.replaceChildren(...labels.map((label) => {
      const item = document.createElement("i");
      item.textContent = label;
      return item;
    }));
  }
}
