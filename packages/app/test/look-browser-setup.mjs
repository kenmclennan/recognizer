import { existsSync } from "node:fs";
import { webkit } from "playwright";

const ENDPOINT = "RECOGNIZER_LOOK_BROWSER_ENDPOINT";

export default async function setup() {
  if (!existsSync(webkit.executablePath())) {
    return undefined;
  }

  const server = await webkit.launchServer();

  process.env[ENDPOINT] = server.wsEndpoint();

  return async () => {
    delete process.env[ENDPOINT];

    await server.close();
  };
}
