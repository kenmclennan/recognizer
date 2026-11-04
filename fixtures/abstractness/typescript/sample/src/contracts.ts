export interface Store {
  save(id: string): void;
}

export interface Plain {
  id: string;
}

export type Handler = (e: string) => void;

export type Repo = { find(id: string): string };

export type Callback = { run: () => void };

export type Make = new () => object;
