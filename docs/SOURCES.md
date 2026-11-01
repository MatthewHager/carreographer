# Sources and credits

## What the app is built on

| What | Used for | Licence |
|---|---|---|
| [Beat This!](https://github.com/CPJKU/beat_this) (Foscarin, Schlüter and Widmer, ISMIR 2024), the `final0` checkpoint | beats and downbeats | MIT |
| [basic-pitch](https://github.com/spotify/basic-pitch) (Spotify), its `nmp.onnx` | note transcription | Apache-2.0 |
| [ONNX Runtime Web](https://onnxruntime.ai/) | running both models in the browser | MIT |
| [librosa](https://librosa.org/) | the analysis is a TypeScript port of the parts it uses | ISC |
| [numpy](https://numpy.org/) | its rounding, quantiles and random generator, ported where they decide a frame | BSD-3-Clause |
| [three.js](https://threejs.org/) | the 3D preview | MIT |
| [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) | the page | MIT |
| [shadcn/ui](https://ui.shadcn.com/) with [Radix](https://www.radix-ui.com/), [vaul](https://github.com/emilkowalski/vaul), [sonner](https://github.com/emilkowalski/sonner) | the controls | MIT |
| [Lucide](https://lucide.dev/) | icons | ISC |
| [Geist](https://vercel.com/font) | the typeface | OFL-1.1 |

The models are exported for the browser by `tools/export_models.py`.

## Tesla

- **Tesla's light show documentation**, [teslamotors/light-show](https://github.com/teslamotors/light-show):
  the FSEQ format, the 200-channel map, which lamps each car has, the motor commands and their per-show
  limits. Its multi-car examples ("The Arrival", five cars; "Cyber Symphony", four) were studied for the
  move vocabulary.
- **Tesla's car models and paint table**, from the Tesla Android app, extracted with
  [tesla-model-extractor](https://github.com/koenhendriks/tesla-model-extractor) by Koen Hendriks (MIT)
  by `tools/export_car_models.py`. They're Tesla's property, not covered by this project's licence. They
  never enter the git history; the site hosts them for the preview, from a release.
- **The 2025+ Model Y's lamps**, which Tesla hasn't documented: on-car tests in teslamotors/light-show
  issue #183 and [Nghtmare7509/tesla-lightshow-juniper](https://github.com/Nghtmare7509/tesla-lightshow-juniper).

Carreographer is not affiliated with Tesla.

## Recordings

The example song the page starts with is Grieg's In the Hall of the Mountain King, played by the Czech
National Symphony Orchestra (credited as the Musopen Symphony Orchestra) for
[Musopen](https://musopen.org)'s Kickstarter project, which released its recordings into the public
domain. It's served from the repository's `examples` release, not the git history.

The shows were tuned on a dozen recordings: organ and orchestral pieces, film and TV themes, and pop
songs. None of them is in the repository or its releases, and no song gets settings of its own: every show
comes from the music alone.

## Study material

The move vocabulary and timing rules drew on other people's shows, studied locally and not redistributed
(none declare a licence): Tesla's examples (above); community shows from
[TeslaLightShare](https://teslalightshare.io); and on GitHub c0lt/also-sprach-zarathustra,
codykingllamas/halloween-kills, codykingllamas/haunted-mansion-stretch-room,
codykingllamas/sugar-plum-fairy, quaternionmedia/toccata-fugue-xlights and rutgersmike/tom-devil.
Visualizers and editors looked at while building the preview: GigaJunky/TeslaLightShowPlayer,
HLVM04/Tesla-Beat-Mapper, Martelinok/TeslaShowSimulator, ak463010/fseq-visualizer,
guillaumebdx/tesla-lightshow-mobile, jreznik/tesla-lightshow-visualizer, recallfx/tesla-light-show-editor,
tbatch-ohanafy/tesla-lightshow-creator and wmorrill3/lightcue.
