// Whether the visitor agreed to load maps from OpenStreetMap. One choice covers every map on
// the site; it lives only in this browser and is removed with the garage's "Clear saved data".
export const MAP_CONSENT_KEY = 'osm-map-consent';

export function hasMapConsent() {
  try {
    return localStorage.getItem(MAP_CONSENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function giveMapConsent() {
  try {
    localStorage.setItem(MAP_CONSENT_KEY, 'yes');
  } catch {
    // Storage blocked: the map still loads for this visit, and asks again next time.
  }
}
