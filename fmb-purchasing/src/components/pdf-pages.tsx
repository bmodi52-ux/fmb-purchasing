"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a PDF as stacked canvases using PDF.js, instead of an <iframe>.
 * Some browsers (notably mobile Chrome) don't render PDFs inline inside an
 * iframe and fall back to a native "open externally" card — rendering the
 * pages ourselves works the same everywhere and never sends the (private,
 * signed) receipt URL to a third-party viewer service.
 */
export function PdfPages({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const container = containerRef.current;
      if (!container) return;

      try {
        const doc = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum);
          const targetWidth = container.clientWidth || 700;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = (targetWidth / unscaledViewport.width) * (window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.marginBottom = pageNum < doc.numPages ? "8px" : "0";

          const context = canvas.getContext("2d");
          if (!context) continue;
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="p-6 text-sm text-maroon/70">Couldn&apos;t render this PDF: {error}</p>;
  return <div ref={containerRef} className="mx-auto max-w-full p-2" />;
}
