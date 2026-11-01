import { describe, expect, it } from 'vitest';
import { encodeWav, readWav } from './wav';

/** A WAV file by hand: a fmt chunk, an odd-sized chunk to skip (with its pad byte), then the data. */
function wav(format: number, nCh: number, bits: number, samples: number[], extensible = false): ArrayBuffer {
  const fmtSize = extensible ? 40 : 16, data = (samples.length * bits) / 8;
  const size = 12 + 8 + fmtSize + 8 + 3 + 1 + 8 + data;
  const v = new DataView(new ArrayBuffer(size));
  let at = 0;
  const text = (s: string) => [...s].forEach((c) => v.setUint8(at++, c.charCodeAt(0)));
  const u16 = (x: number) => {
    v.setUint16(at, x, true);
    at += 2;
  };
  const u32 = (x: number) => {
    v.setUint32(at, x, true);
    at += 4;
  };
  text('RIFF');
  u32(size - 8);
  text('WAVE');
  text('fmt ');
  u32(fmtSize);
  [extensible ? 0xfffe : format, nCh].forEach(u16);
  [44100, (44100 * nCh * bits) / 8].forEach(u32);
  [(nCh * bits) / 8, bits].forEach(u16);
  if (extensible) {
    [22, bits].forEach(u16);
    u32(3);
    u16(format);
    at += 14;                     // the rest of the subformat GUID
  }
  text('junk');
  u32(3);
  at += 4;
  text('data');
  u32(data);
  for (const s of samples) {
    if (format === 3) v.setFloat32(at, s, true);
    else if (bits === 8) v.setUint8(at, s);
    else if (bits === 16) v.setInt16(at, s, true);
    else if (bits === 32) v.setInt32(at, s, true);
    else [0, 8, 16].forEach((sh) => v.setUint8(at + sh / 8, (s >> sh) & 0xff));
    at += bits / 8;
  }
  return v.buffer;
}

describe('readWav', () => {
  it('reads 16-bit samples over 32768, as soundfile does', () => {
    const r = readWav(wav(1, 2, 16, [32767, -32768, 1, -1]))!;
    expect(r.sampleRate).toBe(44100);
    expect(Array.from(r.channels[0])).toEqual([32767 / 32768, 1 / 32768]);
    expect(Array.from(r.channels[1])).toEqual([-1, -1 / 32768]);
  });

  it('reads 24-bit, 32-bit, float and extensible files', () => {
    expect(Array.from(readWav(wav(1, 1, 24, [-8388608, 4194304]))!.channels[0])).toEqual([-1, 0.5]);
    expect(Array.from(readWav(wav(1, 1, 32, [-2147483648, 1073741824]))!.channels[0])).toEqual([-1, 0.5]);
    expect(Array.from(readWav(wav(3, 1, 32, [0.25, -0.5]))!.channels[0])).toEqual([0.25, -0.5]);
    expect(Array.from(readWav(wav(1, 2, 16, [16384, -16384], true))!.channels[1])).toEqual([-0.5]);
  });

  it('keeps the first two channels of more', () => {
    expect(readWav(wav(1, 6, 16, [1, 2, 3, 4, 5, 6]))!.channels.map((c) => c[0] * 32768)).toEqual([1, 2]);
  });

  it('leaves anything else to the browser', () => {
    expect(readWav(wav(1, 1, 8, [1, 2, 3, 4]))).toBeNull();
    expect(readWav(new TextEncoder().encode('ID3 an MP3, not a WAV at all, really not').buffer)).toBeNull();
  });

  it('writes a 16-bit song back out unchanged', async () => {
    const samples = [0, 1, -1, 32767, -32768, 12345, -12346, 7];
    const src = wav(1, 2, 16, samples);
    const out = await encodeWav(readWav(src)!.channels).arrayBuffer();
    expect(Array.from(new Int16Array(out, 44))).toEqual(samples);
  });
});
