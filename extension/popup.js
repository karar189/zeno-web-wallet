// Show a hint if the local app is not reachable. No other logic lives in the extension:
// the wallet UI is the app's /popup route, so the dashboard and popup share one codebase.
fetch("http://localhost:3000/popup", { method: "HEAD", cache: "no-store" }).catch(() => {
  document.getElementById("zeno").hidden = true;
  document.getElementById("offline").hidden = false;
});
