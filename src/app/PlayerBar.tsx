// Play, pause and scrub the show; pick a camera.

import { Pause, Play } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CAMERA_PRESETS } from '@/viewer/viewer';
import type { Player } from './player';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The player's position, refreshed a few times a second while it plays. */
function usePosition(player: Player): number {
  const [t, setT] = useState(() => player.now());
  useEffect(() => {
    const tick = () => setT(player.now());
    const off = player.subscribe(tick);
    const id = setInterval(() => player.playing && tick(), 100);
    return () => {
      off();
      clearInterval(id);
    };
  }, [player]);
  return t;
}

// Keys that belong to what has focus (a button's Space, a slider's arrows), not to the player.
const OWNS_KEYS =
  'button, a, input, textarea, select, [role="slider"], [role="radio"], [role="combobox"], [role="option"]';

export function PlayerBar({ player, camera, onCamera }: {
  player: Player;
  camera: string;
  onCamera: (c: string) => void;
}) {
  const playing = useSyncExternalStore((fn) => player.subscribe(fn), () => player.playing);
  const duration = useSyncExternalStore((fn) => player.subscribe(fn), () => player.duration);
  const t = usePosition(player);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!player.duration || (e.target instanceof Element && e.target.closest(OWNS_KEYS))) return;
      if (e.code === 'Space') {
        e.preventDefault();
        player.toggle();
      } else if (e.code === 'ArrowLeft') player.seek(player.now() - (e.shiftKey ? 1 : 5));
      else if (e.code === 'ArrowRight') player.seek(player.now() + (e.shiftKey ? 1 : 5));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      {duration > 0 && (
        <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-3 rounded-full border bg-card/80 py-1.5 pr-5
          pl-1.5 backdrop-blur-xl">
          <Button size="icon-lg" className="rounded-full" onClick={() => player.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{fmt(t)}</span>
          <Slider className="min-w-16 flex-1" min={0} max={duration} step={0.02} value={[Math.min(t, duration)]}
            onValueChange={([v]) => player.seek(v)} aria-label="Position in the show" />
          <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">{fmt(duration)}</span>
        </div>
      )}
      <ToggleGroup type="single" value={camera} onValueChange={(v) => v && onCamera(v)} aria-label="Camera"
        spacing={0} className="rounded-full border bg-card/80 p-1 backdrop-blur-xl">
        {CAMERA_PRESETS.map((p) => (
          <ToggleGroupItem key={p.name} value={p.name} className="h-8 rounded-full px-3.5 text-xs text-muted-foreground
            data-[state=on]:bg-secondary data-[state=on]:text-foreground">
            {p.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
