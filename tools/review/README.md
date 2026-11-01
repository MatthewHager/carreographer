# Show review

See and hear a show without the page: one command makes a song's show in Node with the page's own code,
then draws it, sums it up in words and, if asked, films the 3D preview with the sound. It's for whoever
works on the choreography, people and coding agents alike. It needs the listening models in `public/models`
(`npm run assets`, once).

```bash
npm run review -- song.wav --lineup YCY                  # pictures and a summary
npm run review -- song.mp3 --lineup YCY --from 60 --to 90 --video
```

| Option | What |
|---|---|
| `--lineup YCY` | the cars, crowd's left to right (default `YCY`) |
| `--colours NAME` | the cabins' colour scheme (`src/engine/schemes.ts`): `party` (the default), `halloween`, `christmas`, `july4`, `valentines` |
| `--from S --to S` | the stretch to draw and film; the show is always made for the whole song |
| `--stretch S` | seconds per timeline picture (default 30) |
| `--out DIR` | where to write (default `review-out/<song>_<lineup>/` at the top of the checkout) |
| `--video` | film the 3D preview with the sound, from `--from` to `--to` |
| `--fps N`, `--camera NAME` | the film's frame rate (30) and camera: `Stage` (the default: the crowd's view, close and low enough that the whole lineup fills the frame), or the app's `Front`, `3/4`, `Rear`, `Top` |
| `--fresh` | listen again instead of reusing the beats and notes heard last time |

`review-out/` keeps itself out of git (the tool writes a `.gitignore` into it).

## What it does

1. **Makes the show** as `src/app/show.worker.ts` does: decode (a 44.1 kHz WAV is read by `app/wav.ts`,
   anything else by ffmpeg, where the page uses the browser's decoder, so an MP3's show can differ a
   little), `monoAt22050`, `trackBeats`, `transcribe` (ONNX Runtime on WASM, one thread, about 15-20 s per
   minute of music), `analyze`, `choreograph`. The beats and notes are kept in `review-out/.listen/` by the
   samples' hash (whatever `--out` says), so a second run takes a second or two: change the choreography,
   run it again. The show files are byte for byte the page's: Hall of the Mountain King and the Addams
   Family (WAV, `YCY`) match the ZIP the built site makes in headless Chromium on the worker pool, and the
   example song (MP3, `YCY`) the ZIP the page makes in Chrome listening on WebGPU.
2. **Writes** `show/CarN_*.fseq` (as the page's download), `show.json` (sections, phrases with their level,
   gesture and move, beats, downbeats, hits, the builds and drops, the drum voices' hits, and the
   loudness and level curves at 10 a second), the pictures and `summary.txt`.
3. **Prints the summary**: the arc (every 10 s, the music's loudness and the show's level against each car's light and flashes
   a second: does the show grow with the song?), then per section each phrase's step, gesture and move,
   and per car how much of the time it's lit, how much light it gives, how many flashes a second, and how
   many of those land within 60 ms of a beat or a note; then every motor command with its time and the
   count against Tesla's limit.

The code runs through Vite's module runner (`review.mjs` imports `main.ts` with `runnerImport`), so it
uses `src/` as it is, with no build. `npx tsc -p tools/review` type-checks it.

## The pictures

`timeline_<from>-<to>.png` covers a stretch at 50 pixels a second (one pixel per 20 ms frame);
`overview.png` is the whole song in one width. Top to bottom:

| Strip | What |
|---|---|
| header | song, lineup, stretch, tempo, beat score (how much harder the music hits on the beats; 2 and up: a beat to follow) |
| section, level | the form map's sections (letters repeat for repeated material) and each one's mean level (`level.ts`) |
| move | the move each phrase got (`a \| b`: a split, side cars \| centrepiece) |
| step, gesture | the phrase's level step (`level.ts`; colour: hush and calm blue, groove green, drive amber, the peak red) and gesture |
| each car | one row per lamp the car really has, as the preview simulates it (Tesla's ramps; a 2025+ Model Y's bar sections; lamps it lacks left out), in the lamp's colour, brightness as brightness. A lamp with two sides is one row: upper half the crowd's left, lower half the crowd's right. A Cybertruck's front bar is 60 rows, one per LED, the crowd's left on top. Closures: brightness is how open (mirrors start unfolded, so bright), magenta while dancing. `interior` is the cabin's colour. Faint vertical lines are the beats, brighter on downbeats |
| loudness, level | `an.loudness` as an area coloured by the level's step (hush, calm, groove, drive, the peak in red), the level as a white line, the strongest hits as white ticks on top |
| beat confidence, kit | how clearly the beats land on accents (the beat layer backs off where it is low) and how much a drum kit plays |
| builds, drops | each build as a yellow ramp, each drop as a white tick |
| beats, downbeats | as the lights use them (after `tempo.ts` moved them onto what's played) |
| kick, snare, hats | the drum voices' hits (`an.kick`, `an.snare`, `an.hats`), brightness = strength |
| notes | a piano roll of every transcribed note (brighter = louder), the melody the moves follow as red dots, the song's stage range (`pitchLo`, `pitchHi`) in dark red |

## The film

`--video` serves `film.html` (the app's own `Viewer`, `CarRig` and `simulate`, with Tesla's car models
from `public/models/tesla-app/`) with Vite on port 5176 (`REVIEW_PORT` to change it), steps it through the
stretch one video frame at a time in Playwright's Chromium, screenshots each, and muxes the song under it
with ffmpeg into `video.mp4`. Stepping keeps every picture on its moment of the show however slowly the
machine draws: about half real time at 1280×720 on an M1 Max.

Playwright isn't one of the app's dependencies. Install it where Node finds it, or set
`REVIEW_PLAYWRIGHT` to its package folder (and `PLAYWRIGHT_BROWSERS_PATH` if its Chromium is elsewhere).
ffmpeg is found on the `PATH`, at `/opt/homebrew/bin/ffmpeg`, or at `FFMPEG`.
