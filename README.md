# Carreographer

**Synchronized Tesla light shows for one to five cars, from any song, made in your browser.**

**[Make a show → matthewhager.github.io/carreographer](https://matthewhager.github.io/carreographer/)**

[![ci](https://github.com/MatthewHager/carreographer/actions/workflows/ci.yml/badge.svg)](https://github.com/MatthewHager/carreographer/actions/workflows/ci.yml)
[![pages](https://github.com/MatthewHager/carreographer/actions/workflows/pages.yml/badge.svg)](https://matthewhager.github.io/carreographer/)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

![Two Model Ys and a Cybertruck mid-show in the 3D preview](docs/images/preview.jpg)

Line up your cars as the crowd will see them, drop in a song, and Carreographer listens to it (the beat,
the notes, the loudness, the drums, the harmony and the shape of the song) and choreographs every car's
lights and motors to the music. The lineup plays as one instrument that grows with the song: a quiet
passage is a lamp at a time, the melody runs across the cars, the beat thumps through the headlights, each
drum has lamps of its own, a build speeds up into a beat of black before the drop hits every lamp at once,
and the liftgates, frunks, windows, mirrors and charge ports move on the big moments, within Tesla's limits.
You watch it on Tesla's own 3D models before it goes anywhere near a car.

No account, no settings, nothing to install. The song never leaves your device.

## Make a show

1. **Pick the cars**, from the crowd's left to right, and a paint for each.
2. **Drop in a song**: MP3, WAV, FLAC or M4A. Or keep the example, Hall of the Mountain King.
3. **Pick the colours** for the cabin lights: Party, the whole spectrum as a music visualizer has it, or an
   occasion's own (Halloween, Christmas, the Fourth of July, Valentine's Day). The music picks the colour
   bar by bar either way.
4. **Make the show.** It takes from about ten seconds to a minute, depending on the song and the device.
   Then watch it in 3D.
5. **Download the ZIP.** It has a folder for each car, named after its place (`Car1_ModelY_Left`), with
   that car's `LightShow` folder inside. The files differ from car to car.
6. **Put each car's `LightShow` folder on its own USB drive**, at the top level of a drive formatted
   exFAT or FAT32.
7. **Plug the drive into the car** and open **Toybox → Light Show**. To play several cars together,
   schedule the same start time on each of them in the Tesla app.

To see what's possible first, switch the panel to **See the moves**: every move of the choreographer on
its own, on your lineup, at any level from calm to the peak, with what it does.

**Keep people clear of the cars**: liftgates, frunks, mirrors, windows and a Model X's doors move during
the show. The music plays from the cabin speakers, so the windows go down and stay down; close them
afterwards.

## Cars

Every car Tesla supports for light shows that has a model in the Tesla app:

| Car | |
|---|---|
| Model S | 2021 and later |
| Model 3 | 2017–2023, and 2024 and later |
| Model X | 2021 and later (its falcon doors dance on the biggest peak) |
| Model Y | 2020–2024; 2025 and later, Premium / Performance and Standard; Model Y L |
| Cybertruck | |

Tesla hasn't documented the 2025+ Model Y's lamps; its light bar follows what owners found by testing on
their cars ([how it works](docs/HOW_IT_WORKS.md#the-2025-model-ys-lamps)). If a show plays differently on
your car than in the preview, a [car report](https://github.com/MatthewHager/carreographer/issues/new/choose)
helps everyone.

## Browsers

A recent Chrome, Edge, Firefox or Safari makes shows, on a computer, an iPad or an iPhone, in about
10–40 s for a 2½-minute song. The listening runs on the GPU where it can and falls back by itself. The
first visit downloads the listening models and the cars' 3D models (about 80 MB for two Model Ys and a
Cybertruck); the browser keeps them. Details in [How it works](docs/HOW_IT_WORKS.md#browsers).

## Privacy

Everything happens in the page: the listening, the choreography and the preview. The song and anything
about it stay on your device; the site has no server and no analytics.

## How it works

Two neural networks running in the browser hear the music: [Beat This!](https://github.com/CPJKU/beat_this)
finds the beats and downbeats, Spotify's [basic-pitch](https://github.com/spotify/basic-pitch) the notes.
A choreographer then reads the song's level, sections, phrases, drums and harmony and draws the show in
layers, each lighting lamps of its own: a steady bed, a move per phrase from a catalogue of 16, the drums,
the beat, the big moments and the motors. The same song and lineup always give the same files, byte for
byte.

- [How it works](docs/HOW_IT_WORKS.md): how a song becomes a show, step by step.
- [The moves](MOVES.md): every move, what it looks like and when it's used.
- [Sources and credits](docs/SOURCES.md).

## Contributing

Issues and pull requests are welcome: a new move, a car that behaves differently from the preview, a
browser that struggles. [CONTRIBUTING.md](CONTRIBUTING.md) has the setup (`npm install`, `npm run assets`,
`npm run dev`) and how to add a move or a car; [AGENTS.md](AGENTS.md) is the short version for coding
agents.

## Licence

[MIT](LICENSE). The show files you make are yours; use recordings you have the right to use.

Not affiliated with or endorsed by Tesla. Tesla, Model S, Model 3, Model X, Model Y and Cybertruck are
trademarks of Tesla, Inc.; the 3D car models are Tesla's, from the Tesla app, and are not covered by this
project's licence. Light shows move real parts of real cars: watch the space around them.
