export function indexOfBytes(
  data: Uint8Array,
  needle: readonly number[],
  start: number,
): number {
  const last = data.length - needle.length;

  for (let i = Math.max(start, 0); i <= last; i += 1) {
    let k = 0;

    while (k < needle.length && data[i + k] === needle[k]) {
      k += 1;
    }

    if (k === needle.length) {
      return i;
    }
  }

  return -1;
}

export function latin1(data: Uint8Array): string {
  let text = "";

  for (const byte of data) {
    text += String.fromCharCode(byte);
  }

  return text;
}

function codePointBytes(codePoint: number): number[] {
  if (codePoint < 0x80) {
    return [codePoint];
  }

  if (codePoint < 0x800) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  }

  if (codePoint < 0x10000) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }

  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

function utf8Of(text: string): number[] {
  const bytes: number[] = [];

  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    const lone = codePoint >= 0xd800 && codePoint <= 0xdfff;

    bytes.push(...codePointBytes(lone ? 0xfffd : codePoint));
  }

  return bytes;
}

export function compareUtf8(left: string, right: string): number {
  const a = utf8Of(left);
  const b = utf8Of(right);
  const shared = Math.min(a.length, b.length);

  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return (a[i] as number) < (b[i] as number) ? -1 : 1;
    }
  }

  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
