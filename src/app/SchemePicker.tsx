// The cabins' colours: the whole spectrum for a party, or an occasion's own (engine/schemes.ts).

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SCHEMES, type SchemeId } from '@/engine/schemes';

const rgb = ([r, g, b]: readonly number[]) => `rgb(${r} ${g} ${b})`;
const SPECTRUM = 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';

/** A scheme's colours as one round swatch. */
function Swatch({ id }: { id: SchemeId }) {
  const own = SCHEMES[id].colours;
  const background = own
    ? `conic-gradient(${own.map((c, i) => `${rgb(c)} ${(i / own.length) * 360}deg ${((i + 1) / own.length) * 360}deg`).join(', ')})`
    : SPECTRUM;
  return <span aria-hidden className="size-4 shrink-0 rounded-full border" style={{ background }} />;
}

export function SchemePicker({ scheme, disabled, onChange }: {
  scheme: SchemeId;
  disabled?: boolean;
  onChange: (scheme: SchemeId) => void;
}) {
  return (
    <Select value={scheme} onValueChange={(v) => onChange(v as SchemeId)} disabled={disabled}>
      <SelectTrigger aria-label="Colours" className="h-11 w-full rounded-2xl px-4 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {(Object.keys(SCHEMES) as SchemeId[]).map((id) => (
          <SelectItem key={id} value={id}>
            <span className="flex items-center gap-2.5"><Swatch id={id} />{SCHEMES[id].label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
