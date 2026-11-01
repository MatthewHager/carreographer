// Choose the song: pick it here, or drop it anywhere on the page (App.tsx). Until then it's the example.

import { Music } from 'lucide-react';
import { EXAMPLE, SONG_EXTENSIONS, SONG_TYPES } from './pipeline';

export function SongDrop({ song, dragging, disabled, onFiles }: {
  /** null: the example song. */
  song: File | null;
  /** A file is being dragged over the page. */
  dragging: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3.5 transition-colors
        focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent
        ${dragging ? 'border-ring bg-accent' : 'border-dashed'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
        <input type="file" className="sr-only" disabled={disabled} accept={['audio/*', ...SONG_EXTENSIONS].join(',')}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';      // so choosing the same file again still counts
          }} />
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Music className="size-4" />
        </span>
        <span className="min-w-0 text-sm">
          <span className="block truncate font-medium">{song ? song.name : EXAMPLE.title}</span>
          <span className="block text-muted-foreground">
            {song ? 'Choose or drop another to replace it' : `Example song. Choose or drop your own: ${SONG_TYPES}.`}
          </span>
        </span>
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {!song && `The example is ${EXAMPLE.credit}. `}Your song stays on this device.
      </p>
    </div>
  );
}
