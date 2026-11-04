export type Row = { id: string };

export type Mode = "a" | "b";

export type Id = string;

export type Maybe = Partial<Row>;

export type Counts = { [K in keyof Row]: number };

export type Mixed = Row & { run(): void };
