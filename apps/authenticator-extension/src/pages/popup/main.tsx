import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { watchColorScheme } from "../../lib/theme";
import "../../styles/globals.css";
import { Popup } from "./popup";

watchColorScheme();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
