// The page video.ts films: the app's own 3D stage (viewer/), stepped to one moment of the show at a time.

import { loadModel } from '@/app/models';
import { modelFor } from '@/app/show';
import { STEP_MS } from '@/engine/channels';
import { lineupCars } from '@/engine/vehicles';
import { CarRig } from '@/viewer/rig';
import { type CameraPreset, Viewer } from '@/viewer/viewer';

let rigs: CarRig[] = [];
let time = 0;
const viewer = new Viewer(document.getElementById('stage')!);
viewer.onTick = () => {
  for (const r of rigs) r.setFrame(Math.floor(time / (STEP_MS / 1000)), time);
};
const painted = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const film = {
  /** The lineup on Tesla's models, each car playing its show bytes (fetched from /__film/<i>). */
  async load(lineup: string, nFrames: number, camera: string): Promise<void> {
    const letters = [...lineup];
    const gltfs = await Promise.all(letters.map((l) => loadModel(modelFor(l))));
    if (gltfs.some((g) => !g)) throw new Error("Tesla's car models are missing: see public/models/tesla-app");
    rigs = lineupCars(lineup).map(([folder, v], i) => new CarRig(folder, { id: v.body, gltf: gltfs[i]! }));
    viewer.setCars(rigs);
    // 'Stage': the crowd's view, close and low enough that the whole lineup fills the frame and the lot's
    // lamps stay out of it, so the cars read as one instrument (the review's own camera, not the app's)
    const stage: CameraPreset = { name: 'Stage', position: [4 + 2 * letters.length, 1.6, 0], target: [0, 1.5, 0] };
    viewer.flyTo(camera === 'Stage' ? stage : camera, true);
    await Promise.all(rigs.map(async (rig, i) => {
      const data = new Uint8Array(await (await fetch(`/__film/${i}`)).arrayBuffer());
      rig.setShow(data, nFrames);
    }));
    await painted();
  },
  /** Shows the moment t seconds into the song, once it has been drawn. */
  async seek(t: number): Promise<void> {
    time = t;
    await painted();
  },
};

(window as unknown as { film: typeof film }).film = film;
