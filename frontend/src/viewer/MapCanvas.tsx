import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Annotation, Label } from '../types';
import { overlayStyle, haloColor, haloWidthOffset, vertex as vtok, zoom as ztok } from '../tokens';

type Point = [number, number];

export interface MapCanvasProps {
  rasterUrl: string;
  height: number; // tile pixel height (usually 2048)
  width: number;
  annotations: Annotation[];
  selectedId: string | null;
  selectedVertex: number | null;
  visibility: Record<Label, boolean>;
  onSelectAnnotation: (id: string | null) => void;
  onSelectVertex: (idx: number | null) => void;
  onMoveVertex: (id: string, idx: number, point: Point) => void;
  onInsertVertex: (id: string, afterIdx: number, point: Point) => void;
  onCoord: (x: number, y: number) => void;
}

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);
  const handleGroupRef = useRef<L.LayerGroup | null>(null);
  const selectedLayerRef = useRef<L.Polygon | L.Polyline | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const H = props.height || 2048;

  const p2ll = (pt: Point): L.LatLngExpression => [H - pt[1], pt[0]];
  const ll2p = (ll: L.LatLng): Point => [ll.lng, H - ll.lat];

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [H, props.width || 2048],
    ];
    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: ztok.maxZoom ?? 5,
      zoomControl: true,
      attributionControl: false,
    });
    L.imageOverlay(props.rasterUrl, bounds).addTo(map);
    map.fitBounds(bounds);

    overlayGroupRef.current = L.layerGroup().addTo(map);
    handleGroupRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const pt = ll2p(e.latlng);
      propsRef.current.onCoord(Math.round(pt[0]), Math.round(pt[1]));
    });
    map.on('click', () => {
      // click on empty map deselects
      propsRef.current.onSelectAnnotation(null);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw overlays when annotations / visibility / selection change.
  useEffect(() => {
    const group = overlayGroupRef.current;
    if (!group) return;
    group.clearLayers();
    selectedLayerRef.current = null;

    for (const ann of props.annotations) {
      if (props.visibility[ann.label] === false) continue;
      const latlngs = ann.points.map(p2ll);
      const style = overlayStyle(ann.label, ann.attributes);
      const isSel = ann.id === props.selectedId;
      const closed = ann.shape_type !== 'polyline';

      // Halo (drawn under): same geometry, wider, dark.
      const haloOpts: L.PolylineOptions = {
        color: haloColor,
        weight: style.strokeWidth + haloWidthOffset,
        opacity: 1,
        fill: false,
        interactive: false,
        dashArray: style.dashArray ?? undefined,
      };
      const halo = closed ? L.polygon(latlngs, haloOpts) : L.polyline(latlngs, haloOpts);
      group.addLayer(halo);

      // Colored stroke + fill on top.
      const mainOpts: L.PolylineOptions = {
        color: style.stroke,
        weight: isSel ? style.strokeWidth + 1 : style.strokeWidth,
        fillColor: style.stroke,
        fillOpacity: closed ? 0.18 : 0,
        fill: closed,
        dashArray: style.dashArray ?? undefined,
        opacity: 1,
      };
      const main = closed ? L.polygon(latlngs, mainOpts) : L.polyline(latlngs, mainOpts);
      main.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onSelectAnnotation(ann.id);
      });
      group.addLayer(main);

      if (isSel) selectedLayerRef.current = main;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.visibility, props.selectedId, H]);

  // Redraw vertex + midpoint handles for the selected annotation.
  useEffect(() => {
    const group = handleGroupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!props.selectedId) return;
    const ann = props.annotations.find((a) => a.id === props.selectedId);
    if (!ann || props.visibility[ann.label] === false) return;

    const closed = ann.shape_type !== 'polyline';
    const pts = ann.points;

    // Vertex handles (draggable).
    pts.forEach((pt, idx) => {
      const state = idx === props.selectedVertex ? vtok.selected : vtok.default;
      const r = state.radius;
      const icon = L.divIcon({
        className: '',
        html: `<div class="vertex-handle" style="width:${r * 2}px;height:${r * 2}px;background:${state.fill};border:${state.strokeWidth}px solid ${state.stroke};"></div>`,
        iconSize: [r * 2, r * 2],
        iconAnchor: [r, r],
      });
      const marker = L.marker(p2ll(pt), { icon, draggable: true, keyboard: false });
      marker.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onSelectVertex(idx);
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onSelectVertex(idx);
      });
      marker.on('drag', () => {
        // live-update the selected path geometry for visual feedback
        const layer = selectedLayerRef.current;
        if (!layer) return;
        const ll = marker.getLatLng();
        const current = [...pts];
        current[idx] = ll2p(ll);
        (layer as L.Polyline).setLatLngs(current.map(p2ll));
      });
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        propsRef.current.onMoveVertex(ann.id, idx, ll2p(ll));
      });
      group.addLayer(marker);
    });

    // Midpoint "ghost" add handles.
    const segCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const r = vtok.midpointAdd.radius;
      const icon = L.divIcon({
        className: '',
        html: `<div class="vertex-handle" style="width:${r * 2}px;height:${r * 2}px;background:${vtok.midpointAdd.fill};border:${vtok.midpointAdd.strokeWidth}px solid ${vtok.midpointAdd.stroke};"></div>`,
        iconSize: [r * 2, r * 2],
        iconAnchor: [r, r],
      });
      const marker = L.marker(p2ll(mid), { icon, interactive: true, keyboard: false });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onInsertVertex(ann.id, i, mid);
      });
      group.addLayer(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, props.selectedId, props.selectedVertex, props.visibility, H]);

  return <div className="map-canvas" ref={containerRef} />;
}
