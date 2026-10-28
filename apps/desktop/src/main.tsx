import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Modo demonstração (http://localhost:1420/?demo): só em desenvolvimento; não entra no instalador.
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");
const DemoPreview = import.meta.env.DEV ? lazy(() => import("./demo/DemoPreview").then((m) => ({ default: m.DemoPreview }))) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {demo && DemoPreview ? (
      <Suspense fallback={null}>
        <DemoPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
