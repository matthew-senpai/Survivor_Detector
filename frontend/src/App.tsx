import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MissionProvider } from "./lib/MissionContext";
import CommandCenter from "./pages/CommandCenter";
import Hardware from "./pages/Hardware";
import Landing from "./pages/Landing";

export default function App() {
  return (
    <MissionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/command" element={<CommandCenter />} />
          <Route path="/hardware" element={<Hardware />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </MissionProvider>
  );
}
