# How it works

How a song becomes a light show for a lineup of one to five Teslas, all in the browser. The code is in
`src/`: the listening and the choreographer in `engine/`, the page in `app/`, the 3D preview in `viewer/`.

## What it does

| # | Requirement |
|---|---|
| R1 | **Files and a 3D preview for every car.** A song plus 1–5 cars gives a Tesla-valid file per car, for every light-show car that has a Tesla app model. |
| R2 | **In time with the music**, including a performer's tempo changes and rubato. |
| R3 | **Follows the song's arc**: quiet music is sparse and soft, loud music fills every car, and the biggest look is kept for the peak. |
| R4 | **Every note and every drum** has somewhere to show. |
| R5 | **The same music reads as the same idea**: material that comes back gets the same move, bigger as it grows. |
| R6 | **Motors where they matter most**, timed to arrive on the music, within Tesla's limits. |
| R7 | **The cars work as one instrument**, for any lineup. |
| R8 | **No settings** but the cars and the colours: everything else comes from the music. |
| R9 | **The same input gives the same show.** |
| R10 | **Easy to add moves and vehicles.** |

The idea behind all of it: **the lineup is one instrument.** A row of cars blinking along with the music is
easy to make and dull to watch. Here a melody runs across the cars, the beat thumps through every
headlight, each drum has lamps of its own, a build speeds up from the middle car out, and the stage goes
black for a beat before the drop lands on every lamp at once. Four principles follow:

1. **Every light follows the music, not a clock.** Each move locks to the notes played, the beat the
   performer actually keeps, or the bar, so a chase speeds up when the music does.
2. **One level sizes everything.** How loud the music is, against the whole song, sets how much of each
   car is lit, how often the beat hits and whether the motors move; the top of it is kept for the peak.
3. **Contrast makes it readable.** Calm music is sparse and soft, the climbs hit every beat, the peak is
   every lamp; a hit decays into the next rather than snapping to black, silence is dark, and a drop gets
   the show's one beat of black first.
4. **The crowd's view is the only view.** Everything is written in the crowd's left and right, facing the
   cars' fronts.

## From song to show

```
song ─► decode ─► listen (beats, notes, loudness, drums, harmony, form) ─► phrases and passages
                                                                                  │
                                                                   the level ─► bed, moves, drums, pulse, drops
                                                                                  │
              motors (lids, windows, mirrors, port, doors) ◄──────────────────────┘ ─► FSEQ per car ─► ZIP
```

The page (`app/pipeline.ts`) decodes the song and hands it to a worker (`app/show.worker.ts`), which
listens and choreographs. The page then shows the result in 3D
and packs the download.

### Listening (`engine/listen/`)

- **Decoding.** A 44.1 kHz WAV is read by the app itself (`app/wav.ts`), since browsers scale 16-bit
  samples differently; anything else goes through the browser's decoder at 44.1 kHz. The song is mixed
  to mono and resampled to 22050 Hz with our own Kaiser-windowed sinc (`resample.ts`), as librosa does:
  every difference between browsers and Python in testing came from decoding and resampling.
- **Beats and downbeats**: [Beat This!](https://github.com/CPJKU/beat_this) (the `final0` checkpoint) on
  ONNX Runtime Web (`beats.ts`). The app computes the log-mel spectrogram itself, and the model is
  exported without it, with fp16 weights.
- **Notes**: Spotify's [basic-pitch](https://github.com/spotify/basic-pitch) (`nmp.onnx`, `notes.ts`),
  with its note decoding ported to typed arrays: identical notes in well under a second, where the npm
  package takes minutes.
- **Backends** (`infer.ts`). The models run on the best backend the browser has: WebGPU; else a pool of
  workers, each with a single-thread WASM session; else one WASM session in the show's worker. A GPU
  that fails at run time, or pool workers that can't start or die, drop to the next one and start over.
  The pool is sized by memory as well as cores, since each worker takes about 1 GB at its peak: one
  worker per 4 GB of `deviceMemory` (Chromium), two on other computers, none on phones and tablets.
  ONNX Runtime's own threads would need cross-origin isolation, which GitHub Pages can't give.
- **The analysis** (`audio.ts`, with `dsp.ts` and `cqt.ts`, the subset of librosa it needs): onsets, the
  strongest accents and the beat map; `texture.ts` turns notes into events (a key press or a chord) and
  labels each passage: melody, run, zigzag, trill, chords, arrival. `form.ts` maps the sections from
  harmony and timbre averaged beat by beat (and every half second where the beats leave a gap) and letters
  the repeats (A, B, A′).
- **What a music visualizer measures** (`visual.ts`): the whole mix's loudness in decibels (the song's loud
  end at 1, 40 dB below it at 0), four band levels, the drum kit piece by piece (kick, snare, hats, each a
  list of hits), brightness, the harmony's leading pitch class over each beat, novelty (how much the sound
  is changing), how much a kit is playing, and how clearly the beats land on accents.
- **The beat map follows the performer.** The beats are the neural tracker's, so Hall of the Mountain
  King's accelerando from 100 to 190 bpm keeps its beats; where the tracker slips into half time while the
  music still hits between its beats, those beats go back in (`audio.ts`). Where it only guesses (music
  with no beat to follow, chord changes seconds apart), `feel.ts` hears that and the show flows there. Then `tempo.ts` moves a beat that drifted onto the
  strongest attack near it, or onto the smooth local tempo through its neighbours; runs of beats locked
  onto the off-beat are shifted back. Sweeps snap to a sixteenth grid built from each beat's own length,
  then onto a note played within 40 ms.

### Choreography (`engine/choreo.ts`)

One **level** sizes everything, and the show is drawn in layers that each light lamps of their own (the
table below), so no layer has to dodge another and nothing is cleaned up after them.

1. **The level** (`level.ts`): 0–1 per frame, half the mix's loudness in dB (rising at once, falling over a
   second and a half), two fifths how loud the music is against the rest of the song, a tenth how busy it
   is. Its five steps are *hush*, *calm*, *groove*, *drive* and the *peak*, which is kept for the loudest
   twenty seconds from 45 % of the way into the song and the nearly as loud music around them.
2. **Passages and figures.** The song is cut into passages where its material changes; a long passage
   splits where its sound changes most and where the level settles on another step for 8 s. Each stretch is
   cut at phrase starts (`phrases.ts`) into **figures** of at most eight bars, a section of the form map
   always starting one. A section heard again replays the moves its figures played the first time, family
   by family, so a chorus looks like the chorus (grown, where the music has grown). Each figure
   plays **one move** ([MOVES.md](../MOVES.md)), the least used of the family the music asks for
   (`choreo.family`): where it flows (`feel.ts`: no steady beat, and none struck) a flowing move; with no
   beat to follow, a swell where a chord is held, else the melody; from drive up, or a groove with a drum
   kit, the beat; below that, the melody where there are notes to follow, the beat under sparse ones, and
   in between the melody while it's calm and the beat in a groove. Moves that light only a car or two are
   kept below the peak, bar-long sweeps out of a drum kit's groove, and trills and the motif take their own
   move. So Hall of the Mountain King's theme, eighteen times and growing, goes from a
   keyboard in its pianissimo through marches and mirrors to rings and fills at the climax.
3. **Every hit is sized by the level at its moment** (`Car.half`): a single lamp at a hush, a half car's
   signature and DRL when calm, its inner beam from a groove, its outer beam too from drive. A beat move's
   hit holds from about half the way to the next beat in a groove to most of it at the peak; below the peak
   a travelling figure's hits go dark before the next beat, at the peak they fade into it. A calm note
   plucks or swells like its sound; from a groove a note is struck and held most of the way to the next.
   Whatever the move, the melody runs along the trucks' bars.

| Lamps | Where the music beats | Where it flows |
|---|---|---|
| signatures and DRLs (a 2025+ Model Y's bar, a truck's side markers) | the moves | the breath |
| inner beams | the moves; below the peak, under a melody move, the pulse's while its hit rings | the moves |
| outer beams | the moves from drive; at the peak the pulse too | the breath |
| fogs (a truck's frunk light), turn signals, side markers | the drums; the peak's off-beat sweep on the turns | the breath |
| tails, brake, plates, rear fog, a truck's bed lights | the bed; the kick on the brake | the breath (tails) |
| a truck's bars, the cabins | the bed's glow under the moves' comets and sweeps | the same, breathing |

An accent, a drop, the peak's downbeat and the end light whole cars
for a moment (`Car.lightOver`). The pulse's hold on the inner beams is kept where lamps are written:
`Car.light` leaves them out of every other write, frame by frame, while one of its hits rings.

- **The bed** (`bed.ts`): the rear lamps from a groove up, the trucks' rear bars pumping with the bass and
  their front bars glowing, the cabins in the harmony's colour bar by bar, all brighter as the level rises.
  The colour comes from the scheme picked on the page (`schemes.ts`): Party maps the harmony round the whole
  spectrum, an occasion (Halloween, Christmas...) round its own few colours. Where the music flows it
  **breathes**: with each phrase's swell the free front lamps join one layer at a time and leave together, as many as the level allows.
- **The drums** (`drums.ts`): kicks on the fogs, snares, claps and snaps on the turn signals, hats on the
  markers at the peak, each wherever that voice keeps time (its hits on the beat or halfway, a few every
  few beats) and lit on the beat or half beat it keeps, so the Addams Family's finger snaps tick from the
  first bar while an organ's pedal lights nothing.
- **The pulse** (`pulse.ts`), where the beat is clear and the music strikes it: the middle car's inner
  beams on the downbeat when calm, 1 and 3 on the inner beams in a groove, every beat in drive, and at the
  peak every beat on every headlight, every lamp on the 1 and the off-beats sweeping the stage car by car on
  the amber turns. Below the peak a beat move (or the motif) keeps the beat itself, so there the pulse
  leaves it the headlights and its pattern reads from the front. Each hit decays on the shortest of Tesla's ramps that lasts until the next. **Drops**:
  a downbeat where the level lands a step higher and holds, from a build or onto a drum kit, at most one
  per 100 s; through the build the pulse speeds up and spreads from the middle car out, the stage goes
  black for a beat (the show's one deliberate pull-back), and every lamp hits the drop together.
- **Accents** (`moments.ts`, with the drops) **and the end**: the whole stage for what stands out most (a strike out of
  a breath that lands loud, an arrival chord where the level steps up), at most one per 40 s, 10 s apart
  (strikes out of silence 4 s, as the Toccata's opening calls are); everything on at the music's last
  strong hit, then a 2 s fade, or a slow fade where the song ends flowing.
- **Shaped as it is written** (`Car.light`): a lit lamp stays on at least 100 ms, two lightings of a lamp
  under 60 ms apart join, and silence is dark: a lamp still lit as the music stops fades on Tesla's
  shortest ramp, the bars and cabins quicker. A pull-back (`Car.dark`) takes a lighting it would cut to
  under 100 ms with it. A 2025+ Model Y writes each lamp where it has it ([below](#the-2025-model-ys-lamps)).
  After the layers, only the last three frames are cleared, so nothing is lit as the file ends.

### Output

Each car's frames become an FSEQ file (`showFile` in `app/show.ts`): version 2, uncompressed, 200 channels,
20 ms frames, Tesla's format, naming its audio file. The song is written as a 44.1 kHz 16-bit stereo WAV
(`app/wav.ts`), and every car's `LightShow` folder (the `.fseq` and the `.wav`) goes into one ZIP, stored
without compression, which show files and audio barely need (`app/zip.ts`, `app/DownloadSheet.tsx`).

### The 3D preview (`viewer/`)

The preview draws the lineup on Tesla's own models from the Tesla app, on a night parking lot after rain
(`car/lot.ts`). Each car (`rig.ts`) is built from its app model (`car/appBody.ts`): the app keeps each
kind of lamp in one mesh, so lamps are split by where each triangle sits (per side, inner and outer, the
Cybertruck's bars LED by LED), and closures play the app's own animation clips. `playback.ts` turns
the show's bytes into what each car does, frame by frame, by Tesla's rules: lamp brightness following the
ramps, the lamps each car really has, and closure positions following their travel times. Glow sprites
(`glow.ts`) light every lamp in one draw call. It's made for an iPad as much as a desktop: the pixel ratio
is capped, the cars' lamps light nothing for real (their pools on the ground are drawn), and the bloom
switches off when the device is slow.

The models and the paint table are served from `models/tesla-app/`, from the repository's `car-models`
release. Every car offers every paint in the app's table (it doesn't say which paints each model was sold
in), except the Cybertruck, which only comes in stainless. Lamps the app has no model of stay dark in the
preview: the front fogs and aux park lamps of the 2024+ Model 3 and the Model Y Standard (they may not have
them), the Model Y L's front turn signals and reverse lamps, and the Model X's rear fog.

## The stage

Each car has two **slots**, its crowd-left half and its crowd-right half. A note's pitch picks a place on
the stage (`moves.slotAt`, the same for every style): low notes on the crowd's left, high on the right, so
a scale scrubs across the lineup like a keyboard. The range spread across the stage is that of the notes
within 3 s (`moves.localRanges`), so every stretch of a phrase uses every car.

Every move lights the whole lineup. Two roles keep it working for any lineup:

- **The centrepiece**: the Cybertruck nearest the middle (`centreTruck` in `car.ts`, `null` without one). Its
  front bar is 60 separately driven LEDs, so it plays what lamps can't: the melody as a comet at each
  note's pitch under every move, fills and sweeps. It takes a wider share of the pitch range, so runs sweep
  visibly across it.
- **The side cars**: every other car. Each plays its front lamps, crowd-left to right:
  signature, DRL, outer beam, inner beam, then the mirror image.

| Lineup | Centrepiece | Side cars | What changes |
|---|---|---|---|
| `YCY` (classic) | the Cybertruck | both Ys | nothing |
| `YYCYY` | the middle Cybertruck | all four Ys | keyboards, relays and marches run across four cars |
| `YC`, `CY` | the Cybertruck | the Y | the centrepiece is at one end; low notes still sit on the crowd's left |
| `CYC`, `CCC` | the middle truck | the others, trucks included | every truck draws its bar |
| `Y`, `YY`, `SXm` | none | every car | the bar parts of a move are left out |
| `C` alone | the truck | the truck too | one car plays both parts; its bar carries the melody |

Every car but the Cybertruck speaks the Model Y's lamp vocabulary: Tesla's Model S, 3 and X take the same
channels, and the cars with a front light bar (the 2025+ Model Y and the Model Y L) write them where they
have them. The lineup letters are in `engine/vehicles.ts`.

Tesla's channels are named for the vehicle's own left (the driver's side), which is on the crowd's
*right*. `Car`'s lamp groups (`engine/car.ts`) flip every side, and the front bar's pixels are written
crowd-left to crowd-right.

## The moves

Eighteen, every one whole-stage and sized by the level; [MOVES.md](../MOVES.md) has them all. What they
lock to:

| Family | Locks to | Moves |
|---|---|---|
| melody | the notes | `keyboard` (pitch picks the place), `mirror` (pitch is the distance from the middle), `antiphony` (the halves of the stage answer bar by bar), `relay` (one light runs the stage end to end, note by note) |
| flowing | the melody's place, smoothed | `glide` (across the stage by pitch), `bloom` (out from the middle as it rises) |
| beat | the beat: every one from drive up, 1 and 3 in a groove, the downbeat when calm | `march`, `lr_channel`, `checker`, `tug_of_war`, `converge`, `shockwave` |
| bar | the downbeats | `beam` |
| their own | the phrase | `shimmer` (trills), `motif`, `swell` (chords held with no beat, swelling again at each new one) |

`march` and `beam` light only a car or two at a time, so they play below the peak.

## The motors

The motors are a second stage: slow and limited, so they're saved for the moments that earn them, planned
backwards from the travel times so a lid is fully open exactly on its peak.

| Closure | Travel (approx.) | Commands per show | Notes |
|---|---|---|---|
| liftgate (Cybertruck: frunk) | open 14 s (frunk 10 s), close 4 s | 6 | dances only once fully open |
| each window | 4 s | 6 | can dance from any position |
| each mirror | 2 s | 20 | no dance |
| charge port | 2 s | 3 | its Dance is the rainbow light; closes itself 2 min after opening |
| Model X falcon doors | open 20 s, close 8 s | 6 each | |

Only Open, Close and Dance count, and each closure dances about 30 s at most (a thermal cut-out). Tesla's
README is the only published source; the Cybertruck's frunk was timed on a 2024 truck. Some older Model Ys
open their liftgates only part way until the opening height is reset to its default.

Each family of motors takes moments of its own (`motors.ts`), and apart from the windows going down, the
lids opening onto the peak and the mirrors, they move only where the music beats in a groove or more. No
figure moves two cars at once: each car starts its motor's travel time (at most 4 s) after the one before,
closed up on a moment, to a beat at least, so the last of five cars still moves within it.

- **Lids: the opening is the crescendo.** They open to land on the song's peak a relay after their
  neighbour, dance through it (up to 20 s; where the music flows they hold open) and close in the same
  order; the biggest other loud moment (a drop, a build's landing, an arrival chord, a loud section's start
  or strike, 24 s from the peak and each other) gets a part-way wave: each lid lifts for 5 s and stops on
  its beat, 2 s apart, the centrepiece on the moment.
- **Windows stay down.** The music plays from the cabin speakers, so the crowd hears it through the open
  windows. They go down as the music starts, car by car from the crowd's left. On the peak each car's
  windows dance 10 s half a relay after its lid lands, so lid and windows take turns; on up to three other
  big moments, spread over the song, they dance in 4.5 s bursts rolling across the cars while the music
  stays loud, then go down again.
- **Mirrors** fold in patterns (a wave, outside-in, every other mirror) on each big moment where nothing
  else moves, then, past the song's first quarter, in the middle of each stretch where the music beats and
  nothing has moved for 4 s (8 s when it is calm), the longest first, until their commands run out.
- **The charge port** opens for the most exciting 30 s of the song and dances its rainbow light, the cars
  2 s apart from the crowd's left, so the rainbows arrive and leave as a relay.
- **A Model X's falcon doors** rise into the song's biggest peak, dance and close. Its windows keep still
  meanwhile: Tesla warns that moving windows can trip the doors' pinch detection and stop the show.

`Car.closure()` refuses any command past Tesla's limit, and `vehicles.test.ts` checks every car letter
against the limits.

## Rules every show keeps

- Tesla's per-show command limits for every closure, Dance only once a lid is fully open, and about 30 s
  of dancing at most for each closure.
- 200 channels, 20 ms frames, FSEQ v2 uncompressed.
- Choreography in the crowd's left and right; car 1 is the crowd's left.
- **Deterministic**: the same song and code give byte-identical files. Nothing is random.
- Lights lead the sound by one 20 ms frame (`LIGHT_LEAD_S`): the eye forgives early, not late.
- Silence is dark, and from a groove up the tail lights stay lit.

## The 2025+ Model Y's lamps

Tesla's documentation predates the 2025+ Model Y ("Juniper"). Two on-car tests in October 2026, Tesla's
light-show issue #183 and [Nghtmare7509/tesla-lightshow-juniper](https://github.com/Nghtmare7509/tesla-lightshow-juniper),
which tested every channel alone, agree on its front: headlights (channels 1/2), lower white lamps (3/4),
the light bar's outer ends (7/8, "channel 4", one per side), its whole centre (11/12, "channel 6", either
side), amber turns (13/14) and fender repeaters (21/22). Signature, channel 5, fogs, aux park and side
markers do nothing, and the bar is not separately controllable LED by LED.

The choreography still speaks the Model Y's lamps, and such a car writes each where it has it, as it is
written (`Car.out`): a signature lights its side's end of the bar and the centre, channel 5 that end alone,
the side markers and aux park the fender repeaters; it has no fogs, so the kick leaves its bar to the
moves. The moves and layers ask the car for a half, the whole car, a place across it or the breath's
layers (`Car.half`, `Car.whole`, `Car.at`, `Car.layers`), so only `car.ts` knows these lamps.

## Browsers

Checked on the built site, served statically under `/carreographer/` like GitHub Pages, with Playwright on
an M1 Max: Hall of the Mountain King (2:34, WAV) for three cars, from "Make the show" to the finished show,
and the peak memory of the busiest browser process. Every run played and downloaded a valid ZIP.

| Browser | WebGPU | Pool | One thread |
|---|---|---|---|
| Chromium 156 | 10.7 s, 1.3 GB | 20.0 s (4 workers), 6.1 GB | 38.0 s, 1.8 GB |
| Firefox 157 | no adapter | 26.7 s (2 workers), 2.6 GB | 42.8 s, 1.8 GB |
| WebKit 27.2 (Safari) | not used (below) | 24.3 s (2 workers), 3.8 GB | 40.4 s, 2.6 GB |
| WebKit as iPad Pro 11 | not used | none on tablets | 36.5 s, 2.6 GB |
| WebKit as iPhone 17 | not used | none on phones | 37.1 s, 2.5 GB |

| Forced failure | Chromium | Firefox | WebKit |
|---|---|---|---|
| WebGPU device refused: pool | 24.9 s | | |
| WebGPU device lost mid-run: pool | 22.0 s | | |
| A pool worker dies mid-run: one thread | 43.3 s | 48.1 s | 45.7 s |

Danse Macabre (6:46) takes 19 s in Chromium on WebGPU and 55 s in Firefox's pool. MP3 and FLAC were
checked in all three too.

- **Safari** (WebKit, which every browser on an iPhone or iPad is) crashed the page whenever a worker that
  had used WebGPU ended: a few seconds after the show, or on reload, even with its device destroyed. WebGPU
  was 1.5–3 times faster there, but a crash is worse than a wait, so WebKit listens on the CPU.
- **Firefox** has `navigator.gpu` but gives no adapter on macOS, so it uses the pool.
- **iPhone and iPad** were emulated with WebKit's device profiles, which can't show a real device's memory
  limit or frame rate. They listen on one thread (about 1 GB at its peak).
- **The same show everywhere.** With a 44.1 kHz WAV, Hall of the Mountain King's files are byte-identical
  in every browser and on every backend; Danse Macabre's are too, except 6 bytes of the Cybertruck's in
  Firefox (one brightness level on a light-bar pixel). An MP3's or FLAC's show can differ a little.

Tried and dropped along the way: Essentia.js (slower, and its beats disagreed), the npm basic-pitch
decoding (minutes per song), the smaller beat model (too inaccurate on organ music), ONNX Runtime's JSEP
build (wrong beat output on WebGPU), and Whisper in the browser (a download of hundreds of MB, and
unreliable).
