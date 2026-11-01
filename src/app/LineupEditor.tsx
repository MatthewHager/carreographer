// The cars, crowd's left to right: 1 to 5 of them, each with its paint.

import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_CARS, PLACES, VEHICLES } from '@/engine/vehicles';
import { paintColor, type Paint } from '@/viewer/paints';
import { loadPaints, paintLabel } from './models';
import { modelFor } from './show';

export const DEFAULT_PAINT = 'PearlWhite';

const STAINLESS = 'oklch(0.72 0.005 250)';
const swatchColor = (paint: Paint) => `#${paintColor(paint).getHexString()}`;

export function LineupEditor({ lineup, paints, onChange, disabled }: {
  lineup: string;
  /** The app's paint name per car (paints.json). */
  paints: string[];
  onChange: (lineup: string, paints: string[]) => void;
  disabled?: boolean;
}) {
  const letters = [...lineup];
  const places = PLACES[letters.length];
  const [table, setTable] = useState<Paint[]>([]);
  const [picking, setPicking] = useState<number | null>(null);    // the car whose paints are open
  useEffect(() => void loadPaints().then(setTable), []);
  const cars = letters.map((l, i): [string, string] => [l, paints[i] ?? DEFAULT_PAINT]);
  const change = (next: [string, string][]) => onChange(next.map(([l]) => l).join(''), next.map(([, p]) => p));
  const set = (i: number, car: [string, string]) => change(cars.map((c, k) => (k === i ? car : c)));

  return (
    <div className="space-y-2">
      <ol className="divide-y rounded-2xl border">
        {cars.map(([l, paint], i) => {
          const name = `Car ${i + 1}`;
          const stainless = modelFor(l) === 'cybertruck' || !table.length;
          const current = table.find((p) => p.name === paint) ?? table.find((p) => p.name === DEFAULT_PAINT);
          const open = picking === i && !stainless;
          return (
            <li key={i} className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs
                  tabular-nums" aria-hidden>{i + 1}</span>
                <Select value={l} onValueChange={(v) => set(i, [v, paint])} disabled={disabled}>
                  <SelectTrigger aria-label={`${name}, ${spaced(places[i])}`}
                    className="h-9 min-w-0 flex-1 rounded-full border-transparent bg-transparent px-3 text-[0.9375rem]
                      font-medium dark:bg-transparent dark:hover:bg-accent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {Object.values(VEHICLES).map((v) => (
                      <SelectItem key={v.letter} value={v.letter}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon-sm" variant="ghost" className="rounded-full text-muted-foreground"
                  disabled={disabled || letters.length === 1} aria-label={`Remove ${name.toLowerCase()}`}
                  onClick={() => {
                    setPicking(null);
                    change(cars.filter((_, k) => k !== i));
                  }}>
                  <X />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-8 text-sm text-muted-foreground">
                <span>{spaced(places[i])}</span>
                <span aria-hidden>·</span>
                {stainless ? (
                  <span className="flex items-center gap-2">
                    <span className="size-3.5 rounded-full border" style={{ background: STAINLESS }} />
                    {table.length ? 'Stainless' : 'Its own paint'}
                  </span>
                ) : (
                  <button type="button" disabled={disabled} aria-expanded={open}
                    aria-label={`${name} paint: ${current ? paintLabel(current.name) : 'none'}`}
                    className="-mx-2 flex items-center gap-2 rounded-full px-2 py-0.5 outline-none hover:text-foreground
                      focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    onClick={() => setPicking(open ? null : i)}>
                    <span className="size-3.5 rounded-full border"
                      style={{ background: current && swatchColor(current) }} />
                    {current ? paintLabel(current.name) : 'Paint'}
                    <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {open && current && (
                <Swatches table={table} value={current.name} label={`${name} paint`} disabled={disabled}
                  onChange={(p) => set(i, [l, p])} />
              )}
            </li>
          );
        })}
      </ol>
      {letters.length < MAX_CARS && (
        <Button variant="ghost" className="rounded-full text-muted-foreground" disabled={disabled}
          onClick={() => change([...cars, ['Y', DEFAULT_PAINT]])}>
          <Plus /> Add a car
        </Button>
      )}
    </div>
  );
}

/** The app's paints as round swatches, like its paint picker: radio buttons, so the arrow keys move
 * between them. */
function Swatches({ table, value, label, disabled, onChange }: {
  table: Paint[];
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (paint: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2 pt-1 pl-8">
      {table.map((p) => (
        <label key={p.name} title={paintLabel(p.name)} className="cursor-pointer">
          <input type="radio" name={label} value={p.name} checked={p.name === value} disabled={disabled}
            onChange={() => onChange(p.name)} className="peer sr-only" aria-label={paintLabel(p.name)} />
          <span className="block size-7 rounded-full border border-white/15 ring-offset-2 ring-offset-card
            transition-shadow peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2
            peer-focus-visible:ring-ring" style={{ background: swatchColor(p) }} />
        </label>
      ))}
    </div>
  );
}

const spaced = (place: string) => place.replace(/([a-z])([A-Z])/g, '$1 $2');
