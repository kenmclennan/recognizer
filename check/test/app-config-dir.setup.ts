import { makeTempDir } from "../../scripts/temp-dirs.mjs";

process.env.RECOGNIZER_APP_CONFIG_DIR = makeTempDir("recognizer-app-config-");
