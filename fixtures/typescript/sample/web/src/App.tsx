import { useState } from "react";
import "./styles.css";
import logo from "./logo.svg";
import { MemoryStore } from "@api/memory-store";
import type { Store } from "@api/types";

export function App() {
  const [store] = useState<Store>(new MemoryStore());

  return <img src={logo} alt="" data-store={String(store)} />;
}
