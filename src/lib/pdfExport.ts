/**
 * pdfExport.ts
 * Captures the editor surface as a high-fidelity, paginated PDF and saves it
 * to disk via Tauri's native file-save dialogue. Falls back to a browser
 * download when running outside Tauri (e.g. during development).
 *
 * British English spelling maintained throughout.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { isTauri } from './tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

// ── Page constants ─────────────────────────────────────────────────────────────

/** A4 dimensions in millimetres */
const A4_W_MM   = 210;
const A4_H_MM   = 297;

/** Content margins in millimetres */
const MARGIN_MM = 18;

/** Retina-quality render scale for html2canvas */
const SCALE = 2;

// ── Main export function ───────────────────────────────────────────────────────

/**
 * Exports the given DOM element to a multi-page A4 PDF file.
 *
 * @param surfaceEl  The element whose contents are captured (editor surface).
 * @param title      Used as the suggested filename in the save dialogue.
 */
export async function exportToPdf(
  surfaceEl: HTMLElement,
  title: string,
): Promise<void> {
  // Wait for all web fonts (including Lora) to finish loading
  await document.fonts.ready;

  // ── Temporarily expand the element so html2canvas captures the full height ─
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
    fullCanvas = await html2canvas(surfaceEl, {
      scale:           SCALE,
      useCORS:         true,
      allowTaint:      false,
      logging:         false,
      // Force white background so dark-mode colours don't bleed into the PDF
      backgroundColor: '#ffffff',
      onclone: (doc) => {
        // Ensure Lora is applied in the cloned document
        const style = doc.createElement('style');
        style.textContent = `
          * { -webkit-print-color-adjust: exact !important; }
          .editor-surface, .phing-editor { font-family: "Lora", Georgia, serif !important; }
        `;
        doc.head.appendChild(style);
      },
    });
  } finally {
    // Always restore original styles
    surfaceEl.style.overflow  = prev.overflow;
    surfaceEl.style.maxHeight = prev.maxHeight;
    surfaceEl.style.height    = prev.height;
  }

  // ── Calculate page slicing dimensions ─────────────────────────────────────
  // usable content area per page (mm)
  const usableW = A4_W_MM - MARGIN_MM * 2;
  const usableH = A4_H_MM - MARGIN_MM * 2;

  // Pixels-per-mm horizontal ratio (based on canvas vs usable width)
  const pxPerMm = fullCanvas.width / usableW;

  // How many source pixels fit in one page of usable height
  const pageSlicePx = Math.floor(usableH * pxPerMm);
  const totalPages  = Math.ceil(fullCanvas.height / pageSlicePx);

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) pdf.addPage();

    const srcY = page * pageSlicePx;
    const srcH = Math.min(pageSlicePx, fullCanvas.height - srcY);

    // Create a temporary canvas containing only this page's slice
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width  = fullCanvas.width;
    sliceCanvas.height = srcH;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        fullCanvas,
        0, srcY,               // source origin
        fullCanvas.width, srcH, // source dimensions
        0, 0,                  // destination origin
        fullCanvas.width, srcH, // destination dimensions
      );
    }

    // Convert pixel height back to mm for accurate placement
    const sliceHeightMm = srcH / pxPerMm;

    pdf.addImage(
      sliceCanvas,
      'PNG',
      MARGIN_MM,
      MARGIN_MM,
      usableW,
      sliceHeightMm,
      `page-${page}`,
      'FAST',
    );
  }

  // ── Persist to disk ────────────────────────────────────────────────────────
  const safeTitle = title.replace(/[/\\:*?"<>|]/g, '_') || 'note';
  const filename  = `${safeTitle}.pdf`;

  const pdfBytes = new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);

  if (isTauri()) {
    const savePath = await save({
      title:       'Export Note as PDF',
      filters:     [{ name: 'PDF Document', extensions: ['pdf'] }],
      defaultPath: filename,
    });

    if (!savePath) return; // User dismissed the dialogue

    await writeFile(savePath, pdfBytes);
  } else {
    // Browser fallback — trigger a synthetic download
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
