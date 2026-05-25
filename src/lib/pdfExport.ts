/**
 * pdfExport.ts
 *
 * Two entry points:
 *   exportToPdf         — captures the note editor surface as a paginated A4 PDF.
 *   exportMindMapToPdf  — captures the React Flow canvas as a single-page
 *                         landscape A4 PDF.
 *
 * Both routes use html2canvas for the pixel capture and jsPDF for packaging.
 * See buildCloneStyle() for the colour-accuracy fixes (CSS custom-property
 * resolution, backdrop-filter removal, animation freeze).
 *
 * British English spelling maintained throughout.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { isTauri } from './tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

// ── Page constants ─────────────────────────────────────────────────────────────

/** A4 portrait dimensions in millimetres */
const A4_W_MM = 210;
const A4_H_MM = 297;

/** A4 landscape dimensions in millimetres */
const A4_W_MM_L = 297;
const A4_H_MM_L = 210;

/** Content margins for note pages (mm) */
const MARGIN_MM = 18;

/** Content margins for mind-map page — tighter so the diagram has room (mm) */
const MAP_MARGIN_MM = 12;

/** Retina-quality render scale for html2canvas */
const SCALE = 2;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a <style> element injected into the *cloned* document inside
 * html2canvas's `onclone` callback.  This is the html2canvas analogue of the
 * @media print block in theme.css — both follow the same principle:
 *
 *   Structural containers → white, no shadows, no tinted app backgrounds.
 *   Content elements      → targeted color-adjust: exact only where needed.
 *
 * Three responsibilities:
 *
 * 1. CSS custom-property resolution
 *    html2canvas clones the DOM but may not fully re-evaluate CSS custom
 *    properties from Vite-bundled stylesheets.  We enumerate every --*
 *    property in the live :root rules and emit their *computed concrete*
 *    values into a new :root block in the clone so that every
 *    rgba(var(--pocket-color-N-rgb), α) resolves to a real pastel colour
 *    rather than transparent.
 *
 * 2. White document base + box-shadow removal
 *    The previous version applied color-adjust: exact to * which forced
 *    html2canvas to render the app's cream #F9F6FA body background and the
 *    Academic A4 card's box-shadow onto the canvas, producing a UI screenshot
 *    rather than a clean document.  We now explicitly reset structural
 *    containers to white and strip decorative surfaces.
 *
 * 3. Targeted colour preservation
 *    color-adjust: exact is applied only to elements that carry intentional
 *    colour in the document: tag pills, code blocks, highlight marks, and
 *    mind-map nodes.  Everything else lets the white base show through.
 *
 * 4. backdrop-filter removal + animation freeze
 *    html2canvas does not support backdrop-filter.  Frosted-glass elements
 *    render as opaque white voids without this override.  Transitions and
 *    animations are killed so the snapshot is always a crisp still.
 */
function buildCloneStyle(doc: Document): HTMLStyleElement {
  const liveStyle = getComputedStyle(document.documentElement);

  // Enumerate every --* property declared in any :root rule across all live
  // stylesheets (Vite inlines them as <style> tags so they are enumerable).
  const allVarNames = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style.item(i);
            if (prop.startsWith('--')) allVarNames.add(prop);
          }
        }
      }
    } catch {
      // Cross-origin stylesheet — nothing we can do.
    }
  }

  // Map each variable to its current computed concrete value (not a var() ref).
  const declarations = [...allVarNames]
    .map((p) => {
      const val = liveStyle.getPropertyValue(p).trim();
      return val ? `${p}: ${val}` : null;
    })
    .filter((d): d is string => d !== null)
    .join(';\n  ');

  const style = doc.createElement('style');
  style.textContent = `
    /* ── 1. Resolved CSS custom properties ─────────────────────────────────── */
    :root {
      ${declarations};
    }

    /* ── 2. Snapshot hygiene — freeze animations, kill backdrop-filter ──────── */
    *, *::before, *::after {
      /* backdrop-filter is unsupported by html2canvas.  Frosted-glass elements
         (mm-node, emoji-popover, command-palette) render as opaque white voids
         without this.  Removing it falls back to the element's solid background
         so the content behind it remains visible.                              */
      backdrop-filter:         none !important;
      -webkit-backdrop-filter: none !important;

      /* Freeze all animations / transitions — the snapshot must be a still.   */
      animation:  none !important;
      transition: none !important;
    }

    /* ── 3. White document base — structural containers ─────────────────────── */
    /* The wildcard color-adjust: exact in the previous version forced html2canvas
       to render the app's cream body background and the Academic A4 card shadow
       onto the canvas.  We now reset every structural wrapper to white and strip
       decorative surfaces.  The @page margin / MARGIN_MM constant handles spacing
       — no padding is needed on the containers themselves.                      */
    html,
    body {
      background: #ffffff !important;
      color:      #1a1a1a !important;
    }

    .editor-root,
    .editor-scroll,
    .editor-surface,
    .editor-scroll.academic-mode,
    .editor-scroll.academic-mode .editor-surface {
      background:    #ffffff !important;
      box-shadow:    none    !important;
      border:        none    !important;
      border-radius: 0       !important;
      /* Remove the fixed 794 px card width so the surface fills the canvas.  */
      width:         100%    !important;
      max-width:     none    !important;
      min-height:    unset   !important;
      margin:        0       !important;
      padding:       0       !important;
    }

    /* ── 4. Selective colour preservation ────────────────────────────────────── */
    /* color-adjust: exact is deliberately withheld from the document body so the
       browser does NOT force-render the app's cream or card backgrounds.  We opt
       specific content elements back in — only those with intentional colour.   */

    /* Tag pills — each carries a per-category pastel fill */
    .editor-tag--pill {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust:         exact !important;
    }

    /* Inline code — solid tint (de-alpha'd from rgba(203,170,203,0.18) on white) */
    .phing-editor code,
    .phing-print-area code {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust:         exact !important;
      background: #f0eaf7 !important;
      color: #7b5ea7;
    }

    /* Code blocks */
    .phing-editor pre,
    .phing-print-area pre {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust:         exact !important;
      background: #f9f6fa !important;
    }

    /* Highlight marks */
    mark, [data-highlight] {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust:         exact !important;
    }

    /* Mind-map nodes — branch-tinted fills must survive the snapshot */
    .mm-node,
    .mm-node--root,
    .mm-node--l1,
    .mm-node--deep {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust:         exact !important;
    }

    /* ── 5. Typography ───────────────────────────────────────────────────────── */
    .editor-surface,
    .phing-editor {
      font-family: "Lora", Georgia, serif !important;
    }
  `;
  return style;
}

/**
 * Saves a jsPDF document to disk via Tauri's file-save dialogue, or triggers
 * a synthetic browser download when running outside Tauri (e.g. dev mode).
 */
async function persistPdf(
  pdf: jsPDF,
  filename: string,
  dialogTitle: string,
): Promise<void> {
  const pdfBytes = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);

  if (isTauri()) {
    const savePath = await save({
      title:       dialogTitle,
      filters:     [{ name: 'PDF Document', extensions: ['pdf'] }],
      defaultPath: filename,
    });
    if (!savePath) return; // User dismissed the dialogue.
    await writeFile(savePath, pdfBytes);
  } else {
    // Browser fallback — trigger a synthetic <a download> click.
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: filename,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

// ── Note / editor surface export ──────────────────────────────────────────────

/**
 * Exports the given DOM element to a multi-page portrait A4 PDF file.
 *
 * @param surfaceEl  The element whose contents are captured (.editor-surface).
 * @param title      Used as the suggested filename in the save dialogue.
 */
export async function exportToPdf(
  surfaceEl: HTMLElement,
  title: string,
): Promise<void> {
  // Wait for all web fonts (Lora, LINESeedSans) to finish loading so the
  // canvas snapshot has correctly-shaped glyphs.
  await document.fonts.ready;

  // ── Temporarily expand the element so html2canvas captures full height ─────
  const prev = {
    overflow:  surfaceEl.style.overflow,
    maxHeight: surfaceEl.style.maxHeight,
    height:    surfaceEl.style.height,
  };
  surfaceEl.style.overflow  = 'visible';
  surfaceEl.style.maxHeight = 'none';
  surfaceEl.style.height    = 'auto';

  let fullCanvas: HTMLCanvasElement;
  try {
    // White canvas base.  buildCloneStyle injects solid fallback colours for
    // every element that previously relied on a semi-transparent pastel over
    // the cream app background (e.g. code blocks get #f0eaf7 instead of
    // rgba(203,170,203,0.13)), so a white base now produces the correct result.
    fullCanvas = await html2canvas(surfaceEl, {
      scale:           SCALE,
      useCORS:         true,
      allowTaint:      false,
      logging:         false,
      backgroundColor: '#ffffff',
      onclone: (doc) => {
        doc.head.appendChild(buildCloneStyle(doc));
      },
    });
  } finally {
    // Always restore original styles — even if html2canvas throws.
    surfaceEl.style.overflow  = prev.overflow;
    surfaceEl.style.maxHeight = prev.maxHeight;
    surfaceEl.style.height    = prev.height;
  }

  // ── Page-slicing ───────────────────────────────────────────────────────────
  // Determine how many source pixels fit in one usable page height, then
  // slice the full canvas into page-sized strips and add each as an image.
  const usableW     = A4_W_MM  - MARGIN_MM * 2;
  const usableH     = A4_H_MM  - MARGIN_MM * 2;
  // Pixels-per-mm ratio derived from the canvas width vs the usable page width.
  const pxPerMm     = fullCanvas.width / usableW;
  const pageSlicePx = Math.floor(usableH * pxPerMm);
  const totalPages  = Math.ceil(fullCanvas.height / pageSlicePx);

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    const srcY = page * pageSlicePx;
    const srcH = Math.min(pageSlicePx, fullCanvas.height - srcY);

    // Temporary canvas holding only this page's horizontal strip.
    const sliceCanvas       = document.createElement('canvas');
    sliceCanvas.width       = fullCanvas.width;
    sliceCanvas.height      = srcH;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        fullCanvas,
        0, srcY,               // source: origin
        fullCanvas.width, srcH, // source: dimensions
        0, 0,                  // dest:   origin
        fullCanvas.width, srcH, // dest:   dimensions
      );
    }

    const sliceHeightMm = srcH / pxPerMm;
    pdf.addImage(
      sliceCanvas, 'PNG',
      MARGIN_MM, MARGIN_MM,
      usableW, sliceHeightMm,
      `page-${page}`, 'FAST',
    );
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '_') || 'note';
  await persistPdf(pdf, `${safeTitle}.pdf`, 'Export Note as PDF');
}

// ── Mind map export ────────────────────────────────────────────────────────────

/**
 * Captures the React Flow canvas as a single-page landscape A4 PDF.
 *
 * ⚠️  The caller MUST call `fitView({ duration: 0 })` on the React Flow
 * instance *before* calling this function and wait at least one animation
 * frame so the viewport transform has been committed to the DOM.  Without
 * fitView the snapshot will show only whatever the user last panned to.
 *
 * How the React Flow transform is handled
 * ────────────────────────────────────────
 * React Flow positions its nodes via a CSS `transform: translate(x, y) scale(z)`
 * on the `.react-flow__viewport` element.  html2canvas v1 resolves CSS
 * transform matrices and renders children at their transformed positions, so
 * the output is a faithful pixel-accurate snapshot of what's on screen after
 * fitView has been called.
 *
 * @param canvasEl  The `.mm-canvas-wrap` element wrapping the React Flow canvas.
 * @param title     Map title — used as the suggested filename.
 */
export async function exportMindMapToPdf(
  canvasEl: HTMLElement,
  title: string,
): Promise<void> {
  await document.fonts.ready;

  // Capture the React Flow canvas at 2× resolution for crisp node labels and
  // bezier edges.  The viewport transform (translate + scale) applied by React
  // Flow is honoured by html2canvas's transform matrix resolver.
  const canvas = await html2canvas(canvasEl, {
    scale:           SCALE,
    useCORS:         true,
    allowTaint:      false,
    logging:         false,
    backgroundColor: '#ffffff',
    onclone: (doc) => {
      doc.head.appendChild(buildCloneStyle(doc));
    },
  });

  // ── Landscape A4 — scale the diagram to fill the content area ─────────────
  const usableW = A4_W_MM_L - MAP_MARGIN_MM * 2;
  const usableH = A4_H_MM_L - MAP_MARGIN_MM * 2;

  const canvasAspect = canvas.width  / canvas.height;
  const pageAspect   = usableW / usableH;

  let imgW: number;
  let imgH: number;
  if (canvasAspect > pageAspect) {
    // Diagram is wider than the page ratio — constrain by width.
    imgW = usableW;
    imgH = usableW / canvasAspect;
  } else {
    // Diagram is taller than the page ratio — constrain by height.
    imgH = usableH;
    imgW = usableH * canvasAspect;
  }

  // Centre the diagram on the page.
  const offsetX = MAP_MARGIN_MM + (usableW - imgW) / 2;
  const offsetY = MAP_MARGIN_MM + (usableH - imgH) / 2;

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.addImage(canvas, 'PNG', offsetX, offsetY, imgW, imgH, 'mindmap', 'FAST');

  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '_') || 'mindmap';
  await persistPdf(pdf, `${safeTitle}-map.pdf`, 'Export Mind Map as PDF');
}
