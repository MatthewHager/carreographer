# Notes for coding agents

Carreographer turns a song into synchronized Tesla light shows (FSEQ files) for a lineup of 1–5 cars, in
the browser. The repository is the app (Vite, React, TypeScript, shadcn/ui, three.js, ONNX Runtime Web),
hosted on GitHub Pages. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md). This file is the short version.

## Commands

```bash
npm install                           # once
npm run assets                        # once: models and the example song from the releases into public/
npm run dev                           # http://localhost:5173/carreographer/ (npm run dev -- --port N if 5173 is taken)
npm run check                         # what CI runs: tsc (app and tools/review), oxlint, vitest
npm run build                         # the site, in dist/
npm run review -- SONG --lineup YCY   # the show for a song, drawn and summed up (tools/review/README.md)
```

## Where things are

- `src/engine/`: the choreographer.
  - `vehicles.ts`: the lineup letters (`S`, `M`, `m`, `X`, `Y`, `y`, `B`, `L`, `C`), folder names and
    places.
  - `car.ts`: `Car` (one car's frames, the lamp groups and what a hit lights of a half or the whole car at
    a level, crowd-side flipping, closure command counting, and each lighting shaped as it is written: at
    least 100 ms, dark in a silence, the beat's headlights left to it).
  - `choreo.ts`: `choreograph()` (the pipeline: the layers in order), the passages, their figures and the
    move each plays, and the end.
  - `level.ts`: one level per frame from the loudness, its top kept for the peak; every layer sizes by it.
  - `bed.ts` (steady lamps, the trucks' bars, the cabins' colour in the scheme from `schemes.ts`, and the
    breath where the music flows),
    `moves.ts` (every move as `(cars, an, ph) => void`, sized by the level, and the `MOVES` table),
    `catalog.ts` (the catalogue; `MOVES.md` is generated from it), `drums.ts` (kick, snare, hats),
    `pulse.ts` (the beat, playing the builds and landing the drops), `moments.ts` (which landings are
    drops, the builds into them, and the accents), `motors.ts` (closures),
    `channels.ts` (Tesla's channel map and limits). Each layer lights lamps of
    its own: docs/HOW_IT_WORKS.md has the table.
  - `feel.ts` (flow or beat, kit), `phrases.ts`, `tempo.ts` (the beat map and its grid): reading the
    music.
- `src/engine/listen/`: decoding helpers, resampling, the librosa subset (`dsp.ts`, `cqt.ts`),
  `audio.ts` (the analysis), `texture.ts` (notes into events), `form.ts` (the sections), `visual.ts`
  (loudness, bands, the drum voices, harmony, novelty, kit, beat confidence), beat-this and basic-pitch
  (`beats.ts`, `notes.ts`) on the backend `infer.ts` picks.
- `src/app/`: the page (`App.tsx` is in `src/`), the show worker (`show.worker.ts`), the move gallery
  (`MoveGallery.tsx`, `moves.worker.ts`, over `engine/gallery.ts` and the songs in `engine/fixtures/`),
  `pipeline.ts`, the WAV and the ZIP.
- `src/viewer/`: the 3D preview (`playback.ts` plays a show file as each car would). The cars are Tesla's
  own models from the Tesla app only (`car/appBody.ts`, served from the `car-models` release). Don't add
  hand-built or approximated car models.
- `src/components/ui/`: shadcn/ui as the CLI writes it. Don't edit; theme in `src/index.css`.
- `tools/export_models.py`, `tools/export_car_models.py`: make the two releases (`uv run`).
- `tools/review/`: the show review tool (pictures, a summary with the ARC table, a film of the preview).

## Invariants (don't break these)

- **Crowd's left and right everywhere.** Car 1 is the crowd's left. Tesla's "L" channels are the
  vehicle's left, which is the crowd's right. `Car.veh()` flips them in every group method, and
  `Car.pixels` reverses the front bar. Use the group methods (`heads`, `accents`, `lamps`...); never
  write raw L/R channel numbers in a move.
- **Any lineup of 1–5 cars.** Never index `cars[1]` as the truck or assume two Model Ys. Use
  `centreTruck(cars)` from `car.ts` (may be `null`) and treat every other car alike.
- **Tesla's motor limits** (`CLOSURE_LIMITS` in `channels.ts`): liftgate 6, each window 6, each mirror
  20, charge port 3, a Model X's doors 6 each. Dance only once a lid is fully open; about 30 s of dancing
  per closure per show (each motor's own thermal limit). `Car.closure()` refuses commands past the
  limits, and `vehicles.test.ts` checks every letter.
- **Deterministic, byte-identical output.** The same input gives the same FSEQ: nothing random, no
  `Math.random()` or clock time in the engine (`choreo.test.ts` checks). Refactors must keep shows
  identical: make a song's show before and after with the review tool and compare the files.
- **Tests check rules, never a look.** Judge a look with the review tool's pictures and films.
- **Times come from the music** (`an.events`, `an.beats`, `an.downbeats`), never a fixed tempo. Lights
  lead the sound by one 20 ms frame (`LIGHT_LEAD_S` in `car.ts`).
- **Never commit:** recordings (`songs/`, or any audio), Tesla's files (`public/models/`), anything in
  `cache/`, `dist/`. `.gitignore` covers them; don't force-add.

## Adding things

- **A move:** a function in `moves.ts` sized by the level, its name in the `MOVES` table at the end of
  `moves.ts`, and an entry in `catalog.MOVES` (the compiler checks the two agree), and in `NOTE_MOVES`,
  `BEAT_MOVES`, `HELD_MOVES` or `FLOW_MOVES` (and `SPARSE_MOVES` for a beat move that lights only a car or
  two). Dispatch is by name. Details in CONTRIBUTING.md.
- **A car:** `vehicles.ts`, the `Car` lamp groups (and `Car.out` if the hardware differs), `motors.ts`
  travel times, its channels in the preview (`HARDWARE` in `viewer/playback.ts`) and app model (`viewer/car/appBody.ts`,
  `tools/export_car_models.py`). Details in CONTRIBUTING.md.

## Style

Match the code around you:
- docstrings say what the audience or user experiences;
- comments are sparse and explain why;
- lines are up to about 110 columns;
- no new npm dependencies without a good reason.

The docs use plain sentences, and tables for reference.
