// Tesla light show channel map: 0-based indexes into a 200-channel FSEQ frame, from
// teslamotors/light-show's xLights layout (where channels are 1-based). Values are 0-255.

export const N_CHANNELS = 200;
export const STEP_MS = 20;

// --- Lights ---
export const L_OUTER_MAIN = 0, R_OUTER_MAIN = 1;
export const L_INNER_MAIN = 2, R_INNER_MAIN = 3;
export const L_SIGNATURE = 4, R_SIGNATURE = 5;
export const L_CH4 = 6, R_CH4 = 7;
export const L_CH5 = 8, R_CH5 = 9;
export const L_CH6 = 10, R_CH6 = 11;
export const L_FRONT_TURN = 12, R_FRONT_TURN = 13;
export const L_FRONT_FOG = 14, R_FRONT_FOG = 15;
export const L_AUX_PARK = 16, R_AUX_PARK = 17;           // Cybertruck: frunk light
export const L_SIDE_MARKER = 18, R_SIDE_MARKER = 19;
export const L_SIDE_REPEATER = 20, R_SIDE_REPEATER = 21; // Cybertruck: rear side markers
export const L_REAR_TURN = 22, R_REAR_TURN = 23;         // disabled on Cybertruck
export const BRAKE = 24;
export const L_TAIL = 25, R_TAIL = 26;                   // Cybertruck: reverse lights
export const REVERSE = 27;                               // Cybertruck: bed lights (always a 500 ms ramp)
export const REAR_FOG = 28;
export const LICENSE_PLATE = 29;

// --- Closures ---
export const L_FALCON = 30, R_FALCON = 31;
export const L_FRONT_DOOR = 32, R_FRONT_DOOR = 33;
export const L_MIRROR = 34, R_MIRROR = 35;
export const L_FRONT_WINDOW = 36, L_REAR_WINDOW = 37;
export const R_FRONT_WINDOW = 38, R_REAR_WINDOW = 39;
export const LIFTGATE = 40;                              // Cybertruck: powered frunk
export const CHARGE_PORT = 45;

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

// --- Cybertruck light bars (full brightness control, one channel per LED) ---
export const FRONT_BAR = range(46, 106);   // 60 LEDs, numbered from the vehicle's left
export const REAR_BAR = range(110, 162);   // 52 LEDs on the tailgate
export const OFFROAD_BAR = range(166, 172);

// --- Interior RGB (3 channels each: R, G, B) ---
export const CENTER_DISPLAY = 175;
export const RIGHT_REAR_RGB = 178;
export const RIGHT_FRONT_RGB = 181;
export const CENTER_FRONT_RGB = 184;
export const LEFT_FRONT_RGB = 187;
export const LEFT_REAR_RGB = 190;
export const ALL_RGB = [CENTER_DISPLAY, RIGHT_REAR_RGB, RIGHT_FRONT_RGB, CENTER_FRONT_RGB, LEFT_FRONT_RGB, LEFT_REAR_RGB];

export const WINDOWS = [L_FRONT_WINDOW, L_REAR_WINDOW, R_FRONT_WINDOW, R_REAR_WINDOW];
export const MIRRORS = [L_MIRROR, R_MIRROR];

// --- Light values (xLights effect brightness -> byte) ---
export const OFF_500 = 25, OFF_1000 = 51, OFF_2000 = 76;
export const ON_500 = 178, ON_1000 = 204, ON_2000 = 229;
export const ON = 255;

// --- Closure commands ---
export const CLOSURE_OPEN = 63;
export const CLOSURE_DANCE = 127;
export const CLOSURE_CLOSE = 191;
export const CLOSURE_STOP = 255;

/** Tesla's per-show command limits per closure (Open, Close and Dance count). */
export const CLOSURE_LIMITS: Record<number, number> = {
  [LIFTGATE]: 6, [L_MIRROR]: 20, [R_MIRROR]: 20, [CHARGE_PORT]: 3,
  [L_FRONT_WINDOW]: 6, [L_REAR_WINDOW]: 6, [R_FRONT_WINDOW]: 6, [R_REAR_WINDOW]: 6,
  [L_FALCON]: 6, [R_FALCON]: 6, [L_FRONT_DOOR]: 6, [R_FRONT_DOOR]: 6,      // Model X
};
