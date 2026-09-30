import { register } from "node:module";
import { pathToFileURL } from "node:url";

await register(new URL("./ts-resolve-hook.mjs", import.meta.url), {
  parentURL: pathToFileURL(import.meta.url).href,
});
