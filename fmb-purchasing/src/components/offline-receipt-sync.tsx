"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isConnectionFailure, offlineQueueSupported, QUEUED_EVENT, queuedReceipts, removeQueued } from "@/lib/offline-queue";
import { uploadCapturedReceipt } from "@/app/(app)/submit/inbound-actions";

/**
 * Sends receipt photos kept on this phone while it had no signal (#47), as
 * soon as there is signal and someone is signed in — on any page, since
 * nobody should have to remember to go back to Submit.
 *
 * Also registers the service worker, which is what shows the offline page
 * when the app is opened with no connection at all.
 */
export function OfflineReceiptSync() {
  const router = useRouter();
  const [sent, setSent] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);
  const running = useRef(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Push and the offline page are extras; the app works without them.
      });
    }
    if (!offlineQueueSupported()) return;

    async function flush() {
      setOnline(navigator.onLine);
      if (running.current) return;
      running.current = true;
      let uploaded = 0;
      try {
        const queue = await queuedReceipts();
        setWaiting(queue.length);
        if (!navigator.onLine) return;
        for (const entry of queue) {
          const payload = new FormData();
          payload.append("file", new File([entry.blob], entry.name, { type: entry.type }));
          payload.append("taken_at", entry.takenAt);
          try {
            const result = await uploadCapturedReceipt(payload);
            if (!result.ok) break;
            await removeQueued(entry.id);
            uploaded++;
            setWaiting((n) => Math.max(0, n - 1));
          } catch (err) {
            if (isConnectionFailure(err, navigator.onLine)) break;
            throw err;
          }
        }
      } catch {
        // Tried again on the next page load or reconnection.
      } finally {
        running.current = false;
      }
      if (uploaded > 0) {
        setSent((n) => n + uploaded);
        router.refresh();
      }
    }

    const wentOffline = () => setOnline(false);
    void flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", wentOffline);
    window.addEventListener(QUEUED_EVENT, flush);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener(QUEUED_EVENT, flush);
    };
  }, [router]);

  if (sent === 0) {
    return waiting > 0 && !online ? (
      <p role="status" className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-cream shadow-lg">
        {waiting} receipt {waiting === 1 ? "photo" : "photos"} on this phone, sent when you&apos;re back online
      </p>
    ) : null;
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-cream shadow-lg"
    >
      <span>
        {sent} receipt {sent === 1 ? "photo" : "photos"} taken offline {sent === 1 ? "is" : "are"} on your Submit page
      </span>
      <Link href="/submit" onClick={() => setSent(0)} className="font-medium text-gold underline">
        Open
      </Link>
      <button type="button" onClick={() => setSent(0)} aria-label="Dismiss" className="text-cream/70 hover:text-cream">
        ×
      </button>
    </div>
  );
}
