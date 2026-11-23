export interface Digest {
  sha1Prefix(text: string): string;
  sha256(data: Uint8Array | string): string;
}
