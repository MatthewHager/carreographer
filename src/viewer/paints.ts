// The Tesla app's paints, as the preview shows them on a car and the page shows them as swatches.

import * as THREE from 'three';

/** A paint from the Tesla app's paint table (paints.json): its colour as the app stores it. */
export interface Paint {
  name: string;
  albedo: string;
  metallic: number;
  roughness: number;
}

/** The app keeps its paint colours very dark and brightens them with its studio lighting; this is the
 * factor tesla-model-extractor measured for its GLB export (`--paint-brightness`). */
const PAINT_BRIGHTNESS = 8;

/** A paint's colour: the app's colour brightened as the extractor does (in gamma space, keeping the hue). */
export function paintColor(paint: Paint): THREE.Color {
  const { r, g, b } = new THREE.Color(paint.albedo).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const k = Math.min(PAINT_BRIGHTNESS, 1 / Math.max(r, g, b, 1e-6));
  return new THREE.Color().setRGB(r * k, g * k, b * k, THREE.SRGBColorSpace);
}
