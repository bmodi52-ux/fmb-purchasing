"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, sendTestPush } from "../actions";

/** The VAPID public key, base64url, as the Uint8Array PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function describeDevice(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

type Support = "checking" | "unsupported" | "needs-home-screen" | "denied" | "ready" | "on";

/**
 * Turning push on for this device (#28).
 *
 * A browser only asks for permission in answer to a tap, so this is a button
 * rather than something that happens on page load. On an iPhone, push only
 * exists for a web app added to the home screen (iOS 16.4 or later); in plain
 * Safari the button explains that instead of failing silently.
 */
export function PushDevices({ publicKey }: { publicKey: string | null }) {
  const [support, setSupport] = useState<Support>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Reading browser capabilities is an external system; there is nothing to
    // derive this from during render, which also runs on the server.
    /* eslint-disable react-hooks/set-state-in-effect */
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupport(ios && !standalone ? "needs-home-screen" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setSupport("denied");
      return;
    }
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setSupport(sub ? "on" : "ready"))
      .catch(() => setSupport("ready"));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(permission === "denied" ? "denied" : "ready");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const saved = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys, deviceLabel: describeDevice() });
      if (!saved.ok) {
        setMessage("This device couldn't be saved. Try again.");
        return;
      }
      setSupport("on");
      setMessage("Push notifications are on for this device.");
    } catch (err) {
      setMessage(`Push couldn't be turned on: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const result = await sendTestPush();
    setBusy(false);
    setMessage(result.ok ? "Sent — it should appear in a moment." : "Push isn't set up on the server yet.");
  }

  if (!publicKey) {
    return <p className="text-sm text-ink/60">Push notifications aren&apos;t set up for this site yet. An admin needs to add the push keys.</p>;
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {support === "checking" && <p className="text-ink/50">Checking this device…</p>}
      {support === "unsupported" && <p className="text-ink/60">This browser can&apos;t receive push notifications.</p>}
      {support === "needs-home-screen" && (
        <p className="text-ink/70">
          On an iPhone, push works once FMB Purchasing is on your home screen: tap Share, then <strong>Add to Home Screen</strong>, open
          it from there, and come back to this page. Needs iOS 16.4 or later.
        </p>
      )}
      {support === "denied" && (
        <p className="text-ink/70">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</p>
      )}
      {(support === "ready" || support === "on") && (
        <div className="flex flex-wrap items-center gap-3">
          {support === "ready" ? (
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-md bg-gold px-3.5 py-2 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
            >
              {busy ? "Turning on…" : "Turn on push for this device"}
            </button>
          ) : (
            <>
              <span className="rounded-full bg-palm/15 px-2.5 py-0.5 text-xs font-medium text-palm">On for this device</span>
              <button type="button" onClick={test} disabled={busy} className="text-ink/60 underline hover:text-ink disabled:opacity-60">
                Send a test
              </button>
            </>
          )}
        </div>
      )}
      {message && <p className="text-xs text-ink/60">{message}</p>}
    </div>
  );
}
