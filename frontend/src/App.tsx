import { Routes, Route, Link } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { TileNavigator } from './pages/TileNavigator';
import { TileViewer } from './pages/TileViewer';
import { ExportPanel } from './pages/ExportPanel';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<TileNavigator />} />
        <Route path="/tile/:name" element={<TileViewer />} />
        <Route path="/export" element={<ExportPanel />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
