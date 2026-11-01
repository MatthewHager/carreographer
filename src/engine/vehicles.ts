// The lineup: which cars, in which order, as the crowd sees them (crowd's left to right).
//
// A lineup is a string of 1 to 5 letters, one per car (capitals for the current car, lower case for
// the one before it):
//   S   Model S, 2021 and later
//   M   Model 3, 2024 and later
//   m   Model 3, 2017-2023
//   X   Model X, 2021 and later (falcon doors)
//   Y   Model Y, 2025 and later, Premium / Performance (a light bar across the nose)
//   y   Model Y, 2020-2024
//   B   Model Y, 2025 and later, Standard (no light bar)
//   L   Model Y L (the six-seater, with the light bar)
//   C   Cybertruck
// e.g. "YCY" is Model Y | Cybertruck | Model Y. Every car gets its own show file, named after its
// place in the line (Car2_Cybertruck_Center).
//
// Every car but the Cybertruck is choreographed in the Model Y's lamp vocabulary: Tesla's Model S, 3
// and X take the same channels (its README, "Light Channel Locations"), and the cars with a front
// light bar write them where they have them (car.ts).

/** The car models the Tesla app ships (tools/export_car_models.py), one per body the preview draws. */
export type AppModelId =
  | 's_palladium' | 'model3_high' | 'poppyseed' | 'x_palladium'
  | 'y_high' | 'bayberry' | 'bayberry_e41' | 'bayberry_e80' | 'cybertruck';

export const MAX_CARS = 5;

export interface Vehicle {
  letter: string;
  kind: 'modely' | 'cybertruck'; // the choreographer's body type
  model: string;                 // used in folder names
  label: string;                 // for people
  juniper: boolean;              // the 2025+ Model Y's front light bar lamp map (car.ts)
  body: AppModelId;              // the 3D viewer's model from the Tesla app (viewer/car/appBody.ts)
  falcon?: boolean;              // Model X falcon doors (motors.ts)
}

/** In menu order. */
export const VEHICLES: Record<string, Vehicle> = {
  S: { letter: 'S', kind: 'modely', model: 'ModelS', label: 'Model S (2021+)', juniper: false, body: 's_palladium' },
  M: { letter: 'M', kind: 'modely', model: 'Model3', label: 'Model 3 (2024+)', juniper: false, body: 'poppyseed' },
  m: { letter: 'm', kind: 'modely', model: 'Model3', label: 'Model 3 (2017-2023)', juniper: false, body: 'model3_high' },
  X: { letter: 'X', kind: 'modely', model: 'ModelX', label: 'Model X (2021+)', juniper: false, body: 'x_palladium', falcon: true },
  Y: { letter: 'Y', kind: 'modely', model: 'ModelY', label: 'Model Y (2025+)', juniper: true, body: 'bayberry' },
  B: { letter: 'B', kind: 'modely', model: 'ModelY', label: 'Model Y Standard (2025+)', juniper: false, body: 'bayberry_e41' },
  L: { letter: 'L', kind: 'modely', model: 'ModelYL', label: 'Model Y L', juniper: true, body: 'bayberry_e80' },
  y: { letter: 'y', kind: 'modely', model: 'ModelY', label: 'Model Y (2020-2024)', juniper: false, body: 'y_high' },
  C: { letter: 'C', kind: 'cybertruck', model: 'Cybertruck', label: 'Cybertruck', juniper: false, body: 'cybertruck' },
};

/** Place names by lineup length, crowd's left to right. */
export const PLACES: Record<number, string[]> = {
  1: ['Solo'],
  2: ['Left', 'Right'],
  3: ['Left', 'Center', 'Right'],
  4: ['Left', 'CenterLeft', 'CenterRight', 'Right'],
  5: ['Left', 'CenterLeft', 'Center', 'CenterRight', 'Right'],
};

/** The lineup string, checked; throws an Error with a message for people. */
export function parseLineup(text: string): string {
  const s = (text || '').trim();
  if (s.length < 1 || s.length > MAX_CARS) throw new Error(`a lineup is 1 to ${MAX_CARS} cars, e.g. YCY (got ${JSON.stringify(text)})`);
  const bad = [...new Set(s)].filter((ch) => !VEHICLES[ch]).sort();
  if (bad.length) {
    const known = Object.values(VEHICLES).map((v) => `${v.letter} = ${v.label}`).join(', ');
    throw new Error(`unknown car letter(s) ${bad.join(', ')}: use ${known}`);
  }
  return s;
}

/** [folder name, vehicle, place] crowd's left to right, e.g. ["Car1_ModelY_Left", Y, "Left"]. */
export function lineupCars(lineup: string): [string, Vehicle, string][] {
  const s = parseLineup(lineup);
  const places = PLACES[s.length];
  return [...s].map((ch, i) => [`Car${i + 1}_${VEHICLES[ch].model}_${places[i]}`, VEHICLES[ch], places[i]]);
}
