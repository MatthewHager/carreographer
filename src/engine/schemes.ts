// The colour scheme the cabins play in, the one thing a show's maker picks besides the cars. The cars' other
// lamps are white and amber, so the cabins are where colour shows: Party takes the whole spectrum, as a
// music visualizer does, and an occasion keeps to its own colours. Either way the music picks the colour
// bar by bar (bed.ts), and the flashes stay white.

export type Rgb = readonly [number, number, number];

export interface Scheme {
  label: string;
  /** An occasion's colours; null for the whole spectrum. */
  colours: readonly Rgb[] | null;
}

export const SCHEMES = {
  party: { label: 'Party', colours: null },
  halloween: { label: 'Halloween', colours: [[255, 90, 0], [120, 0, 220], [40, 255, 30]] },
  christmas: { label: 'Christmas', colours: [[255, 0, 0], [0, 200, 40], [255, 170, 0]] },
  july4: { label: 'Fourth of July', colours: [[255, 0, 0], [255, 255, 255], [0, 60, 255]] },
  valentines: { label: "Valentine's Day", colours: [[255, 0, 40], [255, 30, 120], [200, 0, 255]] },
} as const satisfies Record<string, Scheme>;

export type SchemeId = keyof typeof SCHEMES;
export const DEFAULT_SCHEME: SchemeId = 'party';
