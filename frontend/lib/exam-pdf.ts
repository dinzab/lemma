/**
 * Browser-side helper that turns the live, rendered `<ExamPaper>`
 * DOM into a downloadable A4 PDF.
 *
 * Why a PDF download instead of `window.print()`:
 *
 *   - On mobile (iOS Safari, Android Chrome), the native print
 *     dialog crops the BAC paper at the viewport edge and treats
 *     scroll-containers as the printable area; the resulting page
 *     is unusable.
 *   - On desktop, several iterations on the print stylesheet
 *     (#83 → #84 → #87 → #88 → #89) still left the same paper
 *     printing differently depending on theme, page-1 clipping
 *     and dialog timing.
 *   - A real PDF is portable: the student gets the same file on
 *     their phone, laptop, or Drive, and can hand it in, share it
 *     with classmates, or print it later with their printer's
 *     native dialog (which behaves *much* better when given a
 *     pre-paginated A4 PDF than a chat-page screenshot).
 *
 * Pipeline (kept deliberately simple):
 *
 *   1. Caller clones the rendered `<aside data-exam-paper>` and
 *      mutates the clone so it already reflects the chosen mode
 *      (énoncé / corrigé / sujet + corrigé). The clone is what
 *      gets passed to `downloadExamPdf`. We don't touch the live
 *      paper in the chat transcript — the student keeps using it
 *      with its interactive reveal toggle.
 *   2. We mount the clone inside a fixed, off-screen host
 *      (`data-exam-pdf-host`) sized to the PDF's content-width in
 *      CSS pixels and add the `exam-pdf-export` class so the
 *      monochrome BAC-paper stylesheet (in `globals.css`) takes
 *      over — same look the print stylesheet used to produce, but
 *      now driven by a real class instead of a media query so it
 *      applies regardless of the device's screen size.
 *   3. We wait for fonts (KaTeX uses webfonts — we MUST wait or
 *      math glyphs render as fallback boxes) and one paint frame.
 *   4. We rasterise the cloned paper with html2canvas-pro
 *      (`html2canvas-pro` — not the original `html2canvas` —
 *      because the original cannot parse the `oklch()` colours
 *      Tailwind v4 emits, and Tailwind v4 is what this app is
 *      built on. The original would throw "Attempting to parse an
 *      unsupported color function" mid-render on any paper that
 *      hits an `bg-amber-500/5` / `text-chart-3` utility class).
 *   5. We slice the resulting tall canvas into A4-page-sized
 *      chunks and emit each chunk as a separate page in a jsPDF
 *      document. Slicing the source canvas (rather than letting
 *      the same image overflow across pages with negative offsets)
 *      keeps the PDF small and lets every page have a clean
 *      white background, even if the original capture has any
 *      transparency.
 *   6. We build a Blob via `pdf.output("blob")` and trigger the
 *      download ourselves through a DOM-attached `<a download>`
 *      anchor that we click() and immediately remove. We
 *      deliberately do NOT call jsPDF's own `pdf.save(filename)`
 *      because internally it creates a *detached* anchor and
 *      dispatches a synthetic, untrusted `MouseEvent("click")`
 *      via `setTimeout(..., 0)` — a pattern Chrome's "automatic
 *      downloads from a single origin" throttle silently
 *      swallows after the first successful download in the same
 *      tab (no console.error, no print dialog, no permission
 *      prompt — the file just never appears). A real, DOM-
 *      attached anchor + native `.click()` is what Chrome treats
 *      as a user-initiated download every time, so the
 *      second/third clicks of the toolbar's other PDF buttons
 *      reliably trigger their own downloads instead of getting
 *      dropped.
 *
 * The function is *async* and resolves once the download has been
 * triggered. Errors propagate to the caller — the caller is
 * expected to surface them via a toast (we don't want to ship a
 * dependency on a specific toast library from a low-level helper).
 */

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";

export interface DownloadExamPdfOptions {
  /**
   * A *clone* of the rendered exam paper, already mutated to
   * reflect the chosen print/export mode (énoncé / corrigé / both).
   * The helper mounts this node off-screen and rasterises it —
   * it must NOT still be parented to the live React tree.
   */
  paperEl: HTMLElement;

  /**
   * Final filename presented to the browser's download dialog.
   * Must end in `.pdf`. The caller is responsible for sanitising
   * exam-supplied strings (matière / session / year) before
   * building this.
   */
  filename: string;
}

// A4 page geometry, in millimetres. Matches the @page declaration
// the old print stylesheet used (14mm top/bottom, 12mm sides), so
// the resulting PDF visually mirrors what the legacy print flow
// produced when it worked.
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PAGE_MARGIN_X_MM = 12;
const PAGE_MARGIN_Y_MM = 14;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - 2 * PAGE_MARGIN_X_MM; // 186mm
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - 2 * PAGE_MARGIN_Y_MM; // 269mm

// CSS-pixel width we lay the clone out at before screenshotting.
// 794px is the canonical "A4 portrait @ 96dpi" width; we scale
// down to the PDF's content width during pagination so the layout
// looks like an A4 page (correct line lengths, exercise heading
// not crammed, marks fit on the right margin) instead of a
// phone-width column awkwardly stretched.
const CSS_RENDER_WIDTH_PX = Math.round(
  794 * (CONTENT_WIDTH_MM / PAGE_WIDTH_MM),
);

// Rasterisation density. 2× gives crisp text + KaTeX glyphs on a
// retina print while keeping each page's PNG small enough that
// the resulting PDF lands under a few MB even for a long paper.
const CANVAS_SCALE = 2;

export async function downloadExamPdf(
  options: DownloadExamPdfOptions,
): Promise<void> {
  const { paperEl, filename } = options;

  // Off-screen host. We position it well off the viewport (rather
  // than `display: none` / `visibility: hidden`) because
  // html2canvas needs the cloned tree to be laid out with real
  // computed styles to capture it. A negative `left` plus a fixed
  // position takes it out of every parent's scroller and keeps it
  // from flashing into view on mobile (where mid-scroll layout
  // can transiently bring offscreen-via-transform elements back).
  const host = document.createElement("div");
  host.setAttribute("data-exam-pdf-host", "");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-100000px";
  host.style.width = `${CSS_RENDER_WIDTH_PX}px`;
  host.style.background = "#ffffff";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";

  // Apply the BAC-paper monochrome / serif / no-card-chrome
  // stylesheet (see `.exam-pdf-export` rules in globals.css).
  paperEl.classList.add("exam-pdf-export");

  host.appendChild(paperEl);
  document.body.appendChild(host);

  try {
    // Wait for webfonts. KaTeX in particular ships its own
    // glyph fonts; without this wait, the rasterised math is
    // rendered with the system fallback and integrals / sums
    // look broken.
    if (
      typeof document !== "undefined" &&
      document.fonts &&
      typeof document.fonts.ready?.then === "function"
    ) {
      try {
        await document.fonts.ready;
      } catch {
        // Best-effort — fonts.ready can reject in rare browser
        // states; we still attempt the capture.
      }
    }

    // Two RAFs to let the browser finish layout *and* paint the
    // KaTeX nodes after fonts settle. A single RAF is sometimes
    // not enough on slower mobile devices.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()),
      );
    });

    const canvas = await html2canvas(paperEl, {
      scale: CANVAS_SCALE,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      // html2canvas-pro respects `windowWidth` to lay out the
      // clone as if the viewport were that width — keeps any
      // viewport-relative units (vw / vh / responsive utilities)
      // stable across phone/desktop captures.
      windowWidth: CSS_RENDER_WIDTH_PX,
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const totalCanvasWidthPx = canvas.width;
    const totalCanvasHeightPx = canvas.height;

    // mm-per-px for the captured canvas, derived from the
    // PDF's content width — every page slice uses the same
    // scale so the rendered text never warps between pages.
    const pxPerMm = totalCanvasWidthPx / CONTENT_WIDTH_MM;
    const pageContentHeightPx = Math.floor(CONTENT_HEIGHT_MM * pxPerMm);

    if (pageContentHeightPx <= 0) {
      throw new Error("Invalid PDF page geometry (zero content height)");
    }

    let consumedHeightPx = 0;
    let pageIndex = 0;
    while (consumedHeightPx < totalCanvasHeightPx) {
      const sliceHeightPx = Math.min(
        pageContentHeightPx,
        totalCanvasHeightPx - consumedHeightPx,
      );

      // Slice the master canvas onto a per-page canvas so each
      // PDF page carries only its own pixels (smaller PDF +
      // guaranteed white background under any KaTeX foreign-
      // object transparency).
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = totalCanvasWidthPx;
      pageCanvas.height = sliceHeightPx;
      const ctx = pageCanvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not acquire 2D context for PDF page slice");
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        consumedHeightPx,
        totalCanvasWidthPx,
        sliceHeightPx,
        0,
        0,
        totalCanvasWidthPx,
        sliceHeightPx,
      );

      // JPEG gives a much smaller file than PNG for the kind of
      // antialiased text + line-art a BAC paper contains, and
      // since we control the canvas background (pure white) the
      // quality difference is invisible at typical reading zoom.
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
      const sliceHeightMm = sliceHeightPx / pxPerMm;

      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(
        imgData,
        "JPEG",
        PAGE_MARGIN_X_MM,
        PAGE_MARGIN_Y_MM,
        CONTENT_WIDTH_MM,
        sliceHeightMm,
      );

      consumedHeightPx += sliceHeightPx;
      pageIndex += 1;
    }

    triggerBlobDownload(pdf.output("blob"), filename);
  } finally {
    host.remove();
  }
}

/**
 * Trigger a real browser download of `blob` under `filename`.
 *
 * This is what jsPDF's `pdf.save()` is *supposed* to do but
 * doesn't reliably on Chrome (see the file header for the full
 * explanation). The key differences vs jsPDF's internal `saveAs`:
 *
 *   - We attach the anchor to `document.body` before clicking it.
 *     Some browsers refuse to fire a click event on a detached
 *     element, and even where they don't, an attached anchor is
 *     the closest thing to a "real" user-initiated download from
 *     Chrome's perspective.
 *   - We call `a.click()` directly (the native method) instead of
 *     dispatching a synthetic `MouseEvent("click")`. The native
 *     `.click()` call inherits the originating user-activation,
 *     which Chrome uses to decide whether a download counts as
 *     user-initiated or "automatic" (the latter is what triggers
 *     the silent-swallow throttle after the first download).
 *   - We do NOT defer the click with `setTimeout(0)`. Pushing
 *     the click out to a fresh task tick is what loses any
 *     remaining activation signal Chrome was tracking.
 *
 * `URL.revokeObjectURL` runs on a 40s delay (same as jsPDF) — we
 * give the browser plenty of time to finish writing the blob to
 * disk before tearing the object URL down, otherwise a slow disk
 * or a save-to-Drive integration can race the revoke and end up
 * with a zero-byte file.
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  // Hide the anchor — it's only here long enough to receive the
  // click; we don't want it briefly visible in the layout.
  anchor.style.position = "fixed";
  anchor.style.top = "0";
  anchor.style.left = "-100000px";
  anchor.style.opacity = "0";
  anchor.style.pointerEvents = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 40_000);
  }
}

/**
 * Build a human-readable PDF filename from an exam payload + the
 * chosen export mode. We slug each header field so the resulting
 * filename is portable across filesystems (no spaces, no
 * accents, no path separators) and stays short enough that
 * Google Drive / iOS Files don't truncate the meaningful bits.
 *
 * Example outputs:
 *   - `bac-sciences-ex-mathematiques-2023-principale-sujet.pdf`
 *   - `bac-eco-gestion-2024-controle-corrige.pdf`
 *   - `exam-sujet-corrige.pdf`  (when no header is available)
 */
export function buildExamPdfFilename(
  header: {
    matiere?: string;
    section?: string;
    year?: number;
    session?: "principale" | "controle" | "rattrapage";
  } | undefined,
  mode: "enonce" | "corrige" | "both",
): string {
  const modeSlug =
    mode === "enonce" ? "sujet" : mode === "corrige" ? "corrige" : "sujet-corrige";

  const tokens: string[] = [];
  if (header?.section) tokens.push(slugify(header.section));
  if (header?.matiere) tokens.push(slugify(header.matiere));
  if (header?.year !== undefined) tokens.push(String(header.year));
  if (header?.session) tokens.push(header.session);

  const stem = tokens.filter((t) => t.length > 0).join("-");
  if (!stem) return `exam-${modeSlug}.pdf`;
  return `bac-${stem}-${modeSlug}.pdf`;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
