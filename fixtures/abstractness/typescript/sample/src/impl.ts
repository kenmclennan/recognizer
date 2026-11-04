export abstract class Base {
  abstract run(): void;
}

export class Impl {}

export function build(): Impl {
  return new Impl();
}

export const LIMIT = 3;

export enum Color {
  Red,
}

type Hidden = () => void;
