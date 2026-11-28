import { ioFilesContract } from "./adapter-contract/io-files-contract.js";
import { FakeIo } from "./support/index.js";

ioFilesContract("Io files contract (fake)", () => {
  const io = new FakeIo();

  io.files.makeDirectory("/work");

  return { io, directory: "/work", modeOf: io.files.modeOf };
});
