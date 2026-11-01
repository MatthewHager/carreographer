// The move catalogue: what every move looks like, and when the choreographer may choose it.
//
// Each entry:
//   what      one line: what the audience sees across the cars
//   grid      what it locks to:
//               note   the transcribed notes
//               beat   the tracked beats at the level's pace (every one, 1 and 3, or the downbeat)
//               bar    the tracked downbeats, a whole bar at a time
//               self   its own timing (a motif, a trill, a held chord)
//
// Every move lights the whole lineup and grows with the level (level.ts): at a hush a single lamp a hit,
// from drive up whole halves of cars with their headlights, but for those the beat plays (pulse.ts).
// Written for the classic lineup, Model Y | Cybertruck | Model Y: "the truck" is the Cybertruck nearest the
// middle, "the Ys" every other car.

export interface MoveEntry {
  readonly what: string;
  readonly grid: 'note' | 'beat' | 'bar' | 'self';
}

const mv = (what: string, grid: MoveEntry['grid']): MoveEntry => ({ what, grid });

export const MOVES = {
  keyboard: mv("notes play across the stage like a keyboard, low on the crowd's left and high on the right, "
    + "the melody along the truck's bar", 'note'),
  relay: mv('one light runs the stage note by note, through every lamp and along the bar, end to end and '
    + 'back', 'note'),
  mirror: mv('pitch is the distance from the middle: low notes light the centre, high notes both ends, so a '
    + 'rising line opens out and a falling one closes in', 'note'),
  antiphony: mv('call and response: bar by bar the melody passes between the left and the right half of the '
    + 'stage', 'note'),
  shimmer: mv('a trill flickers between the two halves of a car, and across every car when loud', 'self'),
  motif: mv('the signature motif: an ornament on the middle car, a sweep across, a hold where it lands',
    'self'),
  swell: mv('held chords with no beat to hit: the whole stage swells from the middle car out and holds while '
    + 'the chord sounds, breathing out and in again from the middle at each new chord', 'self'),
  march: mv('one light marches car to car on the beat, left, centre, right, centre', 'beat'),
  lr_channel: mv('left channel, right channel: the whole left half of the stage on one beat, the right on the '
    + 'next', 'beat'),
  checker: mv('a checkerboard: every other car on one beat, the others on the next, the bar in blocks', 'beat'),
  tug_of_war: mv('the light fills the stage slot by slot on the beat, from one end, then drains back; the next '
    + 'time from the other end', 'beat'),
  converge: mv('on the beat the light runs in from both ends, car by car, and meets in the middle on the '
    + 'next beat (on the "and" at the peak)', 'beat'),
  beam: mv('a searchlight two slots wide sweeps the stage over each bar, and back the next', 'bar'),
  shockwave: mv('on the beat a ring of light leaves the middle and runs out car by car to both ends', 'beat'),
  glide: mv("the melody glides across the inner beams by pitch, low on the crowd's left, a spot along the bar; "
    + 'a beam it rests on swells in', 'note'),
  bloom: mv('the melody glides out from the middle as it rises, on the inner beams at both ends at once, two '
    + 'spots along the bar', 'note'),
} satisfies Record<string, MoveEntry>;

/** A move's name in the catalogue: moves.ts has a function for each, and the compiler checks it. */
export type MoveName = keyof typeof MOVES;

/** A figure of a passage plays one move: one that follows the melody, or one that follows the beat (choreo.ts
 * chooses which, and the least used of the pool). */
export const NOTE_MOVES: MoveName[] = ['keyboard', 'mirror', 'antiphony', 'relay'];
export const BEAT_MOVES: MoveName[] =
  ['march', 'lr_channel', 'checker', 'beam', 'converge', 'tug_of_war', 'shockwave'];
/** The beat moves that light only a car or two at a time: below the peak, so the peak is the biggest look. */
export const SPARSE_MOVES: MoveName[] = ['march', 'beam'];
/** ... or the swell of a chord held with no beat to follow ... */
export const HELD_MOVES: MoveName[] = ['swell'];
/** ... or, where the music flows, one that glides with the melody. */
export const FLOW_MOVES: MoveName[] = ['glide', 'bloom'];

/** The move a phrase's shape asks for whatever its passage plays. */
export const FOR_GESTURE: Record<string, MoveName> = { trill: 'shimmer', motif: 'motif' };

/** MOVES.md at the repository root: the catalogue as a table to read (catalog.test.ts keeps it current). */
export function markdown(): string {
  const rows = [
    '<!-- Written from the move catalogue (catalog.ts); UPDATE_MOVES=1 npx vitest run catalog rewrites it. -->',
    '# Move catalogue',
    '',
    'What each move looks like, when the choreographer plays it, and what it locks to. Every move lights the '
      + 'whole lineup and grows with the music (see docs/HOW_IT_WORKS.md). Written for the classic Model Y | '
      + 'Cybertruck | Model Y lineup: in any lineup "the truck" is the centre Cybertruck and "the Ys" are the '
      + 'other cars.',
    '',
    '| move | what you see | plays | locks to |',
    '|---|---|---|---|',
  ];
  for (const [name, m] of Object.entries(MOVES) as [MoveName, MoveEntry][]) {
    rows.push(`| ${name} | ${m.what} | ${plays(name)} | ${m.grid} |`);
  }
  return rows.join('\n') + '\n';
}

/** When the choreographer plays a move, from the lists it chooses from. */
function plays(name: MoveName): string {
  const shapes = Object.entries(FOR_GESTURE).filter(([, m]) => m === name).map(([g]) => g);
  if (shapes.length) return `every phrase shaped as ${shapes.join(', ')}`;
  if (NOTE_MOVES.includes(name)) return 'a figure that follows its melody';
  if (SPARSE_MOVES.includes(name)) return 'a figure that follows its beat, below the peak';
  if (BEAT_MOVES.includes(name)) return 'a figure that follows its beat';
  if (HELD_MOVES.includes(name)) return 'a chord held with no beat to follow';
  if (FLOW_MOVES.includes(name)) return 'a figure where the music flows';
  return '';
}
