// The show's audio as Tesla wants it: a 44.1 kHz, 16-bit stereo WAV.

export function encodeWav(channels: Float32Array[], sampleRate = 44100): Blob {
  const left = channels[0], right = channels[1] ?? channels[0];
  const n = left.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + n * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, n * 4, true);
  // the scale readWav reads with, so a 16-bit song comes back out unchanged
  const s16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32768)));
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, s16(left[i]), true);
    out.setInt16(46 + i * 4, s16(right[i]), true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/** The samples of a PCM or float WAV file, or null for anything else. Browsers decode 16-bit WAVs
 * differently (Chrome and Firefox divide positive samples by 32767, Safari by 32768), which moves a few
 * beats; this reads them one way, as Python's soundfile does: integers over 2^(bits - 1). */
export function readWav(buf: ArrayBuffer): { channels: Float32Array[]; sampleRate: number } | null {
  const v = new DataView(buf), tag = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: { format: number; nCh: number; sr: number; bits: number } | undefined;
  for (let at = 12; at + 8 <= buf.byteLength;) {
    const id = tag(at), size = v.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      let format = v.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);    // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, nCh: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data' && fmt) {
      const { format, nCh, sr, bits } = fmt, bytes = bits / 8;
      const pcm = format === 1 && (bits === 16 || bits === 24 || bits === 32);
      if ((!pcm && !(format === 3 && bits === 32)) || nCh < 1) return null;
      const n = Math.floor(Math.min(size, buf.byteLength - body) / (bytes * nCh));
      const channels = Array.from({ length: Math.min(2, nCh) }, () => new Float32Array(n));
      const scale = 1 / 2 ** (bits - 1);
      channels.forEach((ch, c) => {
        for (let i = 0, p = body + c * bytes; i < n; i++, p += bytes * nCh) {
          ch[i] = format === 3 ? v.getFloat32(p, true)
            : bits === 16 ? v.getInt16(p, true) * scale
            : bits === 32 ? v.getInt32(p, true) * scale
            : (v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) * scale;
        }
      });
      return { channels, sampleRate: sr };
    }
    at = body + size + (size & 1);
  }
  return null;
}
