import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startThemeSync } from "../../lib/theme";
import "../../styles/globals.css";
import { Options } from "./options";

startThemeSync();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
