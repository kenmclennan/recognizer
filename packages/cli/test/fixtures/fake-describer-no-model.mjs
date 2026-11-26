const manifest = {
  kind: "describer",
  name: "bare",
  display: "Bare",
  description: "A describer that publishes no model.",
  version: "1.0.0",
  protocol: 4,
  install: "none",
  check: true,
  long_running: false,
  time_limit_seconds: 120,
  units: ["files"],
  settings: [],
  prompt_version: "1",
};

if (process.argv[2] === "manifest") {
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}
