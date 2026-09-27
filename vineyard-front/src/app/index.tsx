import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing the #root element.");

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

(import.meta.hot.data.root ??= createRoot(rootElement)).render(app);
