// The files for the cars: one USB drive per car, each with a LightShow folder.

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { lineupCars } from '@/engine/vehicles';
import { fileName, showFile, type Show } from './show';
import { zip } from './zip';

async function download(show: Show) {
  const name = fileName(show.title);
  const audio = new Uint8Array(await show.audio.arrayBuffer());
  const files = show.cars.flatMap((car) => [
    { path: `${car.name}/LightShow/${name}.fseq`, data: showFile(car.frames, show.nFrames, name) },
    { path: `${car.name}/LightShow/${name}.wav`, data: audio },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip(files));
  a.download = `${name}_lightshow.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function DownloadSheet({ show }: { show: Show }) {
  const name = fileName(show.title);
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button size="lg" className="h-11 w-full rounded-full text-[0.9375rem]"><Download /> Get the files</Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DrawerHeader className="md:text-center">
              <DrawerTitle className="text-xl">Put the show on your cars</DrawerTitle>
              <DrawerDescription>One USB drive for each car.</DrawerDescription>
            </DrawerHeader>
            <ol className="list-decimal space-y-4 px-4 pl-9 text-sm leading-relaxed text-muted-foreground
              marker:text-foreground">
              <li>
                Download the ZIP. It has a folder for each car, crowd's left to right:
                <ul className="mt-2 divide-y rounded-xl border text-xs">
                  {lineupCars(show.lineup).map(([folder, v]) => (
                    <li key={folder} className="flex justify-between gap-3 px-3 py-2">
                      <code className="truncate text-foreground">{folder}</code>
                      <span className="shrink-0">{v.label}</span>
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                On each drive (exFAT or FAT32), put that car's{' '}
                <code className="text-[0.9em] text-foreground">LightShow</code> folder at the top level, not
                inside another folder. It holds the show
                (<code className="text-[0.9em] text-foreground">{name}.fseq</code>) and the song
                (<code className="text-[0.9em] text-foreground">{name}.wav</code>).
              </li>
              <li>
                Plug each drive into its car and open Toybox, then Light Show. To start the cars together,
                schedule the same start time on each in the Tesla app.
              </li>
            </ol>
          </div>
          <DrawerFooter className="pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button size="lg" className="h-11 rounded-full text-[0.9375rem]"
              onClick={() => void download(show)}>
              <Download /> Download ZIP
            </Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
