import { Routes, Route, Link } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { CollabProvider } from './collab';
import { TileNavigator } from './pages/TileNavigator';
import { TileViewer } from './pages/TileViewer';
import { ExportPanel } from './pages/ExportPanel';
import { MapView } from './pages/MapView';
import { BurgerMenu } from './components/BurgerMenu';

export default function App() {
  return (
    <ToastProvider>
      <CollabProvider>
        <BurgerMenu />
        <Routes>
          <Route path="/" element={<TileNavigator />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/tile/:name" element={<TileViewer />} />
          <Route path="/export" element={<ExportPanel />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </CollabProvider>
    </ToastProvider>
  );
}

function NotFound() {
  return (
    <div className="empty-state">
      <p>Not found.</p>
      <Link to="/">Back to navigator</Link>
    </div>
  );
}
