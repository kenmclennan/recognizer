export interface WindowState {
  id: string;
  folder: string;
  modules: string[];
  folded: string[];
  focus: string | null;
}

export interface Windows {
  stateOf(id: string): WindowState;
}
