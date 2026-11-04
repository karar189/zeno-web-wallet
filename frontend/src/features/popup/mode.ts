"use client";

// "Popup mode" = the app is running inside the browser-extension popup frame.
// PopupApp sets it; AppShell reads it to swap the dashboard chrome for a compact one.
// sessionStorage is per frame, so a normal tab never inherits it.

const KEY = "zeno.popup.v1";

export function enablePopupMode(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // storage blocked: popup chrome just won't apply
  }
}

export function isPopupMode(): boolean {
  try {
    return typeof window !== "undefined" && sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribePopupMode(): () => void {
  return () => {};
}

/** Paths that run inside the popup frame. Everything else opens the full app in a tab. */
export function staysInPopup(href: string): boolean {
  if (href.startsWith("/pay/receive") || href.startsWith("/pay/lab")) return false;
  return href === "/popup" || href.startsWith("/popup?") || /^\/pay\/(send|review|status)\b/.test(href);
}
