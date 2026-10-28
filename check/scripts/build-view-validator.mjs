import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, "..", "src", "generated");
const schema = JSON.parse(
  readFileSync(join(here, "..", "..", "schema", "view.schema.json"), "utf8"),
);

const ajv = new Ajv2020({
  allErrors: true,
  code: { source: true, esm: true },
});
const imports = [];
const code = standaloneCode(ajv, ajv.compile(schema))
  .replace(/^"use strict";/, "")
  .replace(/const (\w+) = require\("([^"]+)"\)\.default;/g, (_, name, path) => {
    imports.push(`import * as ${name}Module from "${path}.js";`);

    return `const ${name} = ${name}Module.default.default ?? ${name}Module.default;`;
  });

mkdirSync(generated, { recursive: true });
writeFileSync(
  join(generated, "view-validator.js"),
  `${imports.join("\n")}\n${code}`,
);
writeFileSync(
  join(generated, "view-validator.d.ts"),
  `import type { ErrorObject } from "ajv";

declare const validate: {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
};

export default validate;
`,
);
