import { ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DownloadSheet } from '@/app/DownloadSheet';
import { MoveGallery } from '@/app/MoveGallery';
import { unsupported } from '@/app/errors';
import { DEFAULT_PAINT, LineupEditor } from '@/app/LineupEditor';
import { exampleSong, showFromFile, SONG_EXTENSIONS, SONG_TYPES } from '@/app/pipeline';
import { Player } from '@/app/player';
import { PlayerBar } from '@/app/PlayerBar';
import { STEP_S, type Show } from '@/app/show';
import { SchemePicker } from '@/app/SchemePicker';
import { SongDrop } from '@/app/SongDrop';
import { Stage } from '@/app/Stage';
import { DEFAULT_SCHEME, type SchemeId } from '@/engine/schemes';
import { parseLineup } from '@/engine/vehicles';

const SAVED = 'carreographer.cars';
const FEEDBACK = 'https://github.com/MatthewHager/carreographer/issues/new/choose';

/** The cars from last time (this browser keeps them), with the link's ?lineup= first when it has one. */
function savedCars(): { lineup: string; paints: string[] } {
  let saved: { lineup?: unknown; paints?: unknown } = {};
  try {
    saved = JSON.parse(localStorage.getItem(SAVED) ?? '{}') ?? {};
  } catch {
    // storage turned off, or not ours: start fresh
  }
  const paints = Array.isArray(saved.paints)
    ? saved.paints.map((p) => (typeof p === 'string' ? p : DEFAULT_PAINT)) : [];
  for (const text of [new URLSearchParams(location.search).get('lineup'), saved.lineup]) {
    try {
      if (typeof text === 'string') return { lineup: parseLineup(text), paints };
    } catch {
      // a car we don't know: try the next
    }
  }
  return { lineup: 'YCY', paints };
}

export default function App() {
  const player = useMemo(() => new Player(), []);
  const [cars, setCars] = useState(savedCars);
  const { lineup } = cars;
  const [song, setSong] = useState<File | null>(null);   // null: the example song
  const [scheme, setScheme] = useState<SchemeId>(DEFAULT_SCHEME);
  const [show, setShow] = useState<Show | null>(null);
  // 'moves': the move gallery, each move on its own (MoveGallery), instead of making a show
  const [mode, setMode] = useState<'make' | 'moves'>('make');
  const [moveShow, setMoveShow] = useState<Show | null>(null);
  const [busy, setBusy] = useState<{ step: string; fraction?: number } | null>(null);
  const [camera, setCamera] = useState('3/4');
  const [open, setOpen] = useState(true);              // the sheet, on a phone
  const [dragging, setDragging] = useState(false);
  const clear = useRef<HTMLDivElement>(null);

  const onMissing = useCallback(() => toast.error("The 3D cars couldn't load. The show files still work."), []);
  const made = show !== null && show.lineup === lineup && show.scheme === scheme ? show : null;
  const playing = mode === 'moves' ? (moveShow?.lineup === lineup ? moveShow : null) : made;
  const paints = useMemo(() => [...lineup].map((_, i) => cars.paints[i] ?? DEFAULT_PAINT), [lineup, cars.paints]);

  useEffect(() => {
    player.load(playing?.audio, playing ? playing.nFrames * STEP_S : 0, mode === 'moves');
    if (mode === 'moves' && playing) void player.play();      // a move plays as soon as it's picked
  }, [player, playing, mode]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ lineup, paints }));
    } catch {
      // not kept: the cars start as YCY next time
    }
  }, [lineup, paints]);

  useEffect(() => {
    // the link's cars are kept now (above), so later changes aren't undone by a reload
    if (location.search) history.replaceState(null, '', location.pathname);
    const why = unsupported();
    if (why) toast.error(why, { duration: Infinity });
  }, []);

  const choose = (files: FileList | null) => {
    const f = files?.[0];
    if (!f || busy) return;
    if (!SONG_EXTENSIONS.some((x) => f.name.toLowerCase().endsWith(x))) {
      toast.error(`${f.name} isn't a song file. Choose an ${SONG_TYPES}.`);
      return;
    }
    setSong(f);
    setShow(null);
  };

  const make = async () => {
    setBusy({ step: song ? 'Starting' : 'Fetching the example song' });
    try {
      const file = song ?? await exampleSong();
      setShow(await showFromFile(file, lineup, scheme, (step, fraction) => setBusy({ step, fraction })));
      setOpen(false);                                  // on a phone, make room for the cars
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background md:flex-row"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        choose(e.dataTransfer.files);
      }}>
      <Stage lineup={lineup} paints={paints} show={playing} player={player} camera={camera} clear={clear}
        onMissing={onMissing} />

      {/* first for the keyboard and screen readers, last on screen */}
      <aside aria-label="Make a light show" className="relative order-last flex max-h-[62dvh] shrink-0 flex-col
        rounded-t-3xl border-t bg-card pb-[env(safe-area-inset-bottom)] md:h-full md:max-h-none md:w-[400px] md:rounded-none md:border-t-0
        md:border-l md:pb-0">
        <button type="button" className="relative flex items-center gap-3 rounded-t-3xl px-5 pt-5 pb-3 text-left
          outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
          aria-expanded={open} aria-controls="steps" onClick={() => setOpen((o) => !o)}>
          <span aria-hidden
            className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold tracking-tight">Carreographer</span>
            <span className="block truncate text-sm text-muted-foreground">
              {made ? made.title : 'A light show for your Teslas, from your song'}
            </span>
          </span>
          <ChevronDown
            className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? '' : 'rotate-180'}`} />
        </button>
        <h1 className="sr-only md:hidden">Carreographer</h1>
        <header className="hidden px-8 pt-10 pb-2 md:block">
          <h1 className="text-2xl font-semibold tracking-tight">Carreographer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A light show for your Teslas, choreographed from your song.
          </p>
        </header>

        <div id="steps" className={`min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 md:block md:px-8 md:py-6
          ${open ? '' : 'hidden'}`}>
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as 'make' | 'moves')}
            aria-label="What to do" spacing={0} className="w-full rounded-full border p-1">
            <ToggleGroupItem value="make" disabled={!!busy} className="h-9 flex-1 rounded-full text-sm
              text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground">
              Make a show
            </ToggleGroupItem>
            <ToggleGroupItem value="moves" disabled={!!busy} className="h-9 flex-1 rounded-full text-sm
              text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground">
              See the moves
            </ToggleGroupItem>
          </ToggleGroup>
          {mode === 'make' && (
            <section className="space-y-3" aria-labelledby="song-heading">
              <h2 id="song-heading" className="text-sm font-medium">Song</h2>
              <SongDrop song={song} dragging={dragging} disabled={!!busy} onFiles={choose} />
            </section>
          )}
          {mode === 'make' && (
            <section className="space-y-3" aria-labelledby="colours-heading">
              <h2 id="colours-heading" className="text-sm font-medium">
                Colours <span className="font-normal text-muted-foreground">· the cabin lights</span>
              </h2>
              <SchemePicker scheme={scheme} disabled={!!busy} onChange={setScheme} />
            </section>
          )}
          <Separator />
          <section className="space-y-3" aria-labelledby="cars-heading">
            <h2 id="cars-heading" className="text-sm font-medium">
              Cars <span className="font-normal text-muted-foreground">· crowd's left to right</span>
            </h2>
            <LineupEditor lineup={lineup} paints={paints} disabled={!!busy}
              onChange={(l, p) => setCars({ lineup: l, paints: p })} />
          </section>
          {mode === 'moves' && (
            <>
              <Separator />
              <section className="space-y-3" aria-labelledby="moves-heading">
                <h2 id="moves-heading" className="text-sm font-medium">
                  Moves <span className="font-normal text-muted-foreground">· pick one to play it</span>
                </h2>
                <MoveGallery lineup={lineup} onShow={setMoveShow} />
              </section>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            <a href={FEEDBACK} target="_blank" rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground">Send feedback or report a bug</a>.
            Not affiliated with Tesla.{' '}
            <a href="https://github.com/MatthewHager/carreographer" target="_blank" rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground">Source code</a> (MIT).
          </p>
        </div>

        <footer className={`space-y-3 border-t px-5 pt-4 pb-5 md:px-8 md:pb-8
          ${mode === 'moves' ? 'hidden' : ''}`}>
          {busy ? (
            <div className="space-y-2.5" role="status">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-muted-foreground" /> {busy.step}…
              </div>
              <Progress value={(busy.fraction ?? 0) * 100} className={busy.fraction === undefined ? 'invisible' : ''} />
            </div>
          ) : made ? (
            <DownloadSheet show={made} />
          ) : (
            <Button size="lg" className="h-11 w-full rounded-full text-[0.9375rem]" onClick={() => void make()}>
              Make the show
            </Button>
          )}
        </footer>
      </aside>

      <main className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <div ref={clear} className="min-h-0 flex-1" />
        <div className="pointer-events-auto px-3 pb-3 md:px-6 md:pb-6">
          <PlayerBar player={player} camera={camera} onCamera={setCamera} />
        </div>
      </main>
      <Toaster theme="dark" position="top-center" />
    </div>
  );
}
