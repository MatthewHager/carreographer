// The 3D view: the lineup on Tesla's own models, playing the show in time with the player.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Progress } from '@/components/ui/progress';
import { CarRig } from '@/viewer/rig';
import { Viewer } from '@/viewer/viewer';
import { loadModel, modelsArrived, onModelProgress, paintsFor } from './models';
import type { Player } from './player';
import { lineupCars } from '@/engine/vehicles';
import { modelFor, STEP_S, type Show } from './show';

interface Props {
  lineup: string;
  /** The app's paint name per car (paints.json); a car keeps its model's own paint without one. */
  paints: string[];
  show: Show | null;
  player: Player;
  camera: string;
  /** The part of the page the panels leave uncovered: the cars are framed in it. */
  clear: RefObject<HTMLElement | null>;
  /** Called when a model this lineup needs couldn't be loaded. */
  onMissing: () => void;
}

export function Stage({ lineup, paints, show, player, camera, clear, onMissing }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const rigs = useRef<CarRig[]>([]);
  const showRef = useRef(show);
  showRef.current = show;
  const paintsRef = useRef(paints);
  paintsRef.current = paints;
  const [noGl, setNoGl] = useState(false);
  // the cars on their way: how much of their models has arrived (null once they're on the lot), and where
  // on the canvas the panels leave clear, to say so there
  const [loading, setLoading] = useState<number | null>(0);
  const [area, setArea] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current!;
    let v: Viewer;
    try {
      v = new Viewer(el);
    } catch (err) {
      console.warn('No 3D view:', err);
      setNoGl(true);
      return;
    }
    v.onTick = () => {
      const t = player.now();
      for (const r of rigs.current) r.setFrame(Math.floor(t / STEP_S), t);
    };
    // once the show plays, a device that can't keep up loses the bloom rather than the frame rate
    const unsubscribe = player.subscribe(() => player.playing && v.armPerfCheck());
    const fit = () => {
      if (!clear.current) return;
      const r = clear.current.getBoundingClientRect(), b = el.getBoundingClientRect();
      const rect = { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
      v.setClear(rect);
      setArea(rect);
    };
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    if (clear.current) watch.observe(clear.current);
    fit();
    viewer.current = v;
    return () => {
      watch.disconnect();
      unsubscribe();
      v.dispose();
      el.replaceChildren();
      viewer.current = null;
    };
  }, [player, clear]);

  useEffect(() => {
    let live = true;
    const letters = [...lineup];
    const ids = [...new Set(letters.map(modelFor))];
    const progress = () => live && setLoading((l) => (l === null ? null : modelsArrived(ids)));
    const stop = onModelProgress(progress);
    // a lineup whose models are already here (a car swapped back) shows at once, with no bar
    setLoading(modelsArrived(ids) < 1 ? modelsArrived(ids) : null);
    void Promise.all(ids.map(loadModel)).then((gltfs) => {
      stop();
      if (!live) return;
      setLoading(null);
      if (!viewer.current) return;
      if (gltfs.some((g) => !g)) {
        onMissing();
        viewer.current.setCars([]);
        rigs.current = [];
        return;
      }
      const byId = new Map(ids.map((id, i) => [id, gltfs[i]!]));
      const resized = letters.length !== viewer.current.carCount;
      const first = !viewer.current.hasCars;
      rigs.current = lineupCars(lineup).map(([folder, v]) => new CarRig(folder, { id: v.body, gltf: byId.get(v.body)! }));
      viewer.current.setCars(rigs.current);
      if (resized) viewer.current.flyTo(camera, first);
      applyShow(rigs.current, showRef.current);
      applyPaints(rigs.current, letters, paintsRef.current);
    });
    return () => {
      live = false;
      stop();
    };
    // the camera is applied by its own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, onMissing]);

  useEffect(() => applyShow(rigs.current, show), [show]);

  useEffect(() => {
    if (rigs.current.length === lineup.length) applyPaints(rigs.current, [...lineup], paints);
  }, [lineup, paints]);

  useEffect(() => {
    viewer.current?.flyTo(camera);
  }, [camera]);

  if (noGl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-xs">This browser can't show the 3D preview: WebGL is turned off or unavailable. The light
          show files still work.</p>
      </div>
    );
  }
  return (
    <>
      <div ref={box} className="absolute inset-0 touch-none [&>canvas]:block [&>canvas]:size-full" />
      {loading !== null && area && (
        <div role="status" className="pointer-events-none absolute flex items-center justify-center p-6"
          style={{ left: area.x, top: area.y, width: area.w, height: area.h }}>
          <div className="w-56 space-y-2 rounded-2xl bg-background/70 px-4 py-3 text-center text-sm backdrop-blur">
            <p>{loading < 1 ? 'Loading the cars' : 'Parking the cars'}…</p>
            <Progress value={loading * 100} />
            <p className="text-xs text-muted-foreground">Tesla's own 3D models</p>
          </div>
        </div>
      )}
    </>
  );
}

function applyShow(rigs: CarRig[], show: Show | null) {
  rigs.forEach((rig, i) => {
    const car = show?.cars[i];
    rig.setShow(car?.frames, show?.nFrames);
  });
}

function applyPaints(rigs: CarRig[], letters: string[], paints: string[]) {
  rigs.forEach((rig, i) => {
    void paintsFor(modelFor(letters[i]!)).then((table) => rig.setPaint(table.find((p) => p.name === paints[i]) ?? null));
  });
}
