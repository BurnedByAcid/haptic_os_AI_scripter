import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

registerSW({ immediate: true });

// In dev mode, Vite's runtime-error overlay listens for window "error" events
// in the bubble phase. Media element errors (video/audio source failures) are
// handled gracefully by each component's onError handler and must not reach
// the overlay. Register a capture-phase listener here (before any bubble-phase
// listener) so we can stop propagation before Vite sees it.
if (import.meta.env.DEV) {
  window.addEventListener(
    "error",
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    },
    true, // capture phase — fires before Vite's bubble-phase listener
  );
}

createRoot(document.getElementById("root")!).render(<App />);
