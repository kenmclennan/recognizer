import { BaseStore } from "@sample/api";
import { App } from "./App";

const lazy = () => import("./lazy");

console.log(App, BaseStore, lazy);
