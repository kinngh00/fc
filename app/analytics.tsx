"use client";

import { useEffect } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "https://fc-support.kr";
const visitorStorageKey = "fc_support_visitor_id";
export const analyticsEventName = "fc-support:analytics";

function visitorId() {
  let value = localStorage.getItem(visitorStorageKey) || "";
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(value)) {
    value = crypto.randomUUID();
    localStorage.setItem(visitorStorageKey, value);
  }
  return value;
}

function clientInfo() {
  return {
    path: `${location.pathname}${location.search}${location.hash}`.slice(0, 1000),
    referrer: document.referrer.slice(0, 1000),
    userAgent: navigator.userAgent.slice(0, 1000),
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    deviceType: matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop",
  };
}

function send(type: string, extra: Record<string, unknown> = {}, beacon = false) {
  const body = JSON.stringify({ visitorId: visitorId(), type, path: `${location.pathname}${location.search}${location.hash}`, pageTitle: document.title, client: clientInfo(), ...extra });
  const url = `${apiBase}/api/analytics/events`;
  if (beacon && navigator.sendBeacon) return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  void fetch(url, { method: "POST", credentials: "include", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {});
  return true;
}

export function trackAnalytics(type: "search" | "community_view", details: Record<string, unknown>, searchType = "") {
  window.dispatchEvent(new CustomEvent(analyticsEventName, { detail: { type, details, searchType } }));
}

export default function Analytics() {
  useEffect(() => {
    if (document.querySelector('script[data-fc-adsense="true"]')) return;
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.fcAdsense = "true";
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1436343908093854";
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const id = visitorId();
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      try {
        const target = new URL(raw, location.href);
        const apiOrigin = new URL(apiBase, location.href).origin;
        if (target.origin === apiOrigin && target.pathname.startsWith("/api/") && !target.pathname.startsWith("/api/analytics/")) {
          const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
          headers.set("x-fc-visitor-id", id);
          init = { ...init, headers };
        }
      } catch {}
      return originalFetch(input, init);
    };

    const custom = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      send(detail.type || "click", { details: detail.details || {}, searchType: detail.searchType || "", target: detail.target || "" });
    };
    const click = (event: MouseEvent) => {
      const element = (event.target as Element | null)?.closest("a,button,[role='button']") as HTMLElement | null;
      if (!element || element.closest("ins.adsbygoogle,[data-ad-client],[id*='google_ads'],iframe")) return;
      const label = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("href") || element.tagName).trim().replace(/\s+/g, " ").slice(0, 200);
      send("click", { target: label, details: { tag: element.tagName.toLowerCase(), id: element.id, className: String(element.className || "").slice(0, 200) } });
    };
    const visibility = () => send("visibility", { details: { state: document.visibilityState } });
    const heartbeat = window.setInterval(() => send("heartbeat", { details: { visible: document.visibilityState === "visible" } }), 60_000);
    window.addEventListener(analyticsEventName, custom);
    document.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", visibility);
    send("page_view");
    return () => {
      window.fetch = originalFetch;
      clearInterval(heartbeat);
      window.removeEventListener(analyticsEventName, custom);
      document.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
      send("page_exit", { details: { durationMs: Math.round(performance.now()) } }, true);
    };
  }, []);
  return null;
}
