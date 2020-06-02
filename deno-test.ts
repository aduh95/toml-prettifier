import { assertEquals } from "std:testing";

import TOMLPrettifier from "@aduh95/toml-prettifier";
import initTOML from "@aduh95/toml";

await initTOML();

const PROJECT_ROOT = ".";

Deno.test({
  name: "Simple prettify",
  async fn() {
    const [input, output] = (
      await Promise.all(
        ["input", "output"]
          .map((name: string) => `${PROJECT_ROOT}/${name}.toml`)
          .map(Deno.readTextFile)
      )
    ).map((str: string) => str.split(/\r|\n/g));

    for await (const line of TOMLPrettifier(input)) {
      assertEquals(line, output.shift());
    }
  },
});
