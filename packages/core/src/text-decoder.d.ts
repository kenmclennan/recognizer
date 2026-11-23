declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  decode(input?: Uint8Array): string;
}
