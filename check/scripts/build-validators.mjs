import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, "..", "src", "generated");

mkdirSync(generated, { recursive: true });

for (const name of ["view", "responsibilities", "config"]) {
  const schema = JSON.parse(
    readFileSync(
      join(here, "..", "..", "schema", `${name}.schema.json`),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({
    allErrors: true,
    code: { source: true, esm: true },
  });
  const imports = [];
  const code = standaloneCode(ajv, ajv.compile(schema))
    .replace(/^"use strict";/, "")
    .replace(
      /const (\w+) = require\("([^"]+)"\)\.default;/g,
      (_, binding, path) => {
        imports.push(`import * as ${binding}Module from "${path}.js";`);

        return `const ${binding} = ${binding}Module.default.default ?? ${binding}Module.default;`;
      },
    );

  writeFileSync(
    join(generated, `${name}-validator.js`),
    `${imports.join("\n")}\n${code}`,
  );
  writeFileSync(
    join(generated, `${name}-validator.d.ts`),
    `import type { ErrorObject } from "ajv";

declare const validate: {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
};

export default validate;
`,
  );
}
