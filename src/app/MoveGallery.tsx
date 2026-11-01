// See the moves: every move of the catalogue on its own, on the lineup, over a song made in code, at the level
// picked, so anyone can see what's possible before making a show. The shows come from moves.worker.ts.

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import * as CAT from '@/engine/catalog';
import { SR } from '@/engine/fixtures/songs';
import { GALLERY_LEVELS, type GalleryLevel } from '@/engine/gallery';
import { DEFAULT_SCHEME } from '@/engine/schemes';
import type { MoveReply, MoveRequest } from './moves.worker';
import type { Show } from './show';
import { encodeWav } from './wav';

/** The catalogue in the order a show reaches for it, each group with what it follows. */
const GROUPS: [string, CAT.MoveName[]][] = [
  ['Follow the melody', CAT.NOTE_MOVES],
  ['Follow the beat', CAT.BEAT_MOVES],
  ['A phrase of their own', [...new Set(Object.values(CAT.FOR_GESTURE))]],
  ['No beat to follow', [...CAT.HELD_MOVES, ...CAT.FLOW_MOVES]],
];
const LABEL: Partial<Record<CAT.MoveName, string>> = { lr_channel: 'Left, right', tug_of_war: 'Tug of war' };
const label = (m: CAT.MoveName) => LABEL[m] ?? m[0].toUpperCase() + m.slice(1);

export function MoveGallery({ lineup, onShow }: { lineup: string; onShow: (show: Show | null) => void }) {
  const [move, setMove] = useState<CAT.MoveName>('keyboard');
  const [level, setLevel] = useState<GalleryLevel>('drive');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const asked = useRef(0);
  const audio = useRef(new Map<string, Blob>());

  useEffect(() => {
    const w = new Worker(new URL('./moves.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
      onShow(null);
    };
  }, [onShow]);

  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    const id = ++asked.current;
    setBusy(true);
    w.onmessage = (e: MessageEvent<MoveReply>) => {
      const r = e.data;
      if (r.kind === 'done' && r.samples) audio.current.set(r.song, encodeWav([r.samples], SR));
      if (r.id !== asked.current) return;
      setBusy(false);
      if (r.kind === 'error') return console.warn('Move gallery:', r.message);
      onShow({
        title: label(move), lineup, scheme: DEFAULT_SCHEME, nFrames: r.nFrames,
        audio: audio.current.get(r.song)!,
        cars: r.cars.map((c, i) => ({ ...c, letter: lineup[i] })),
      });
    };
    w.postMessage({ id, move, lineup, level } satisfies MoveRequest);
  }, [move, lineup, level, onShow]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          How loud {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Preparing" />}
        </div>
        <ToggleGroup type="single" value={level} onValueChange={(v) => v && setLevel(v as GalleryLevel)}
          aria-label="How loud the music is" spacing={0} className="w-full rounded-full border p-1">
          {(Object.keys(GALLERY_LEVELS) as GalleryLevel[]).map((l) => (
            <ToggleGroupItem key={l} value={l} className="h-8 flex-1 rounded-full text-xs capitalize
              text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground">
              {l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">Every move grows with the music: a lamp at a time when it's
          calm, whole cars at the peak.</p>
      </div>
      {GROUPS.map(([group, moves]) => (
        <section key={group} className="space-y-1.5" aria-label={group}>
          <h3 className="text-xs font-medium text-muted-foreground">{group}</h3>
          <ul className="space-y-1">
            {moves.map((m) => (
              <li key={m}>
                <button type="button" aria-pressed={m === move} onClick={() => setMove(m)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors hover:bg-accent
                    focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none
                    ${m === move ? 'border-ring bg-accent' : 'border-transparent'}`}>
                  <span className="block text-sm font-medium">{label(m)}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{CAT.MOVES[m].what}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
