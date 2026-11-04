import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from './osm-area';

// A map to pick a sprint on: the first tap is the start, the second the finish.
const GUERICKESTRASSE: [number, number] = [48.1757, 11.5972];
const MIN_ZOOM = 15;

export function createPicker(
  el: HTMLElement,
  onPick: (state: { start: LatLng | null; end: LatLng | null; hint?: string }) => void,
) {
  const map = L.map(el, { zoomControl: true }).setView(GUERICKESTRASSE, 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const style = (fill: string) => ({ radius: 9, color: '#0f1720', weight: 3, fillColor: fill, fillOpacity: 1 });
  let start: L.CircleMarker | null = null;
  let end: L.CircleMarker | null = null;
  // The found route, along the roads: a dark casing under a lane-yellow line.
  let line: L.LayerGroup | null = null;
  const point = (m: L.CircleMarker | null) => (m ? { lat: m.getLatLng().lat, lng: m.getLatLng().lng } : null);

  function reset() {
    for (const layer of [start, end, line]) layer?.remove();
    start = end = null;
    line = null;
  }

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (map.getZoom() < MIN_ZOOM) {
      onPick({ start: point(start), end: point(end), hint: 'Zoom in to street level to pick a road.' });
      return;
    }
    if (!start || end) {
      reset();
      start = L.circleMarker(e.latlng, style('#ffcf33')).addTo(map);
    } else {
      end = L.circleMarker(e.latlng, style('#f05a28')).addTo(map);
    }
    onPick({ start: point(start), end: point(end) });
  });

  return {
    refresh: () => map.invalidateSize(),
    showRoute(latlngs: [number, number][]) {
      line?.remove();
      line = L.layerGroup([
        L.polyline(latlngs, { color: '#0f1720', weight: 9, opacity: 0.85 }),
        L.polyline(latlngs, { color: '#ffcf33', weight: 5 }),
      ]).addTo(map);
      start?.bringToFront();
      end?.bringToFront();
      map.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48], maxZoom: 18 });
    },
    reset: () => {
      reset();
      onPick({ start: null, end: null });
    },
  };
}
