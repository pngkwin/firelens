import ReactDOM from "react-dom/client";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-500.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/source-sans-3/latin-700.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App";
import { StudyProvider } from "./state/StudyContext";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StudyProvider>
    <App />
  </StudyProvider>,
);
