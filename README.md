# TOML Prettifier

Opinionated TOML code formatter.

### Usage

Reading a TOML file using Node.js and overwrite it with the prettified version:

```js
import { createReadStream, createWriteStream, promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createInterface as readLines } from "readline";

import TOMLPrettifier from "@aduh95/toml-prettifier";

/**
 * Prettifies a TOML file.
 * @param {string | URL | Buffer} inputFilePath
 */
export async function prettifyTOMLFile(inputFilePath) {
  // Read the input file line by line.
  const reader = readLines({
    input: createReadStream(inputFilePath),
    crlfDelay: Infinity,
  });
  // Create a temporary file to write the prettified TOML.
  const { handle, path: tmpFile } = await fs.mkstemp(join(tmpdir(), "pretty-"));
  const writer = createWriteStream(tmpFile, { fd: handle.fd });

  // Pass the input to TOMLPrettifier.
  for await (const line of TOMLPrettifier(reader)) {
    // Write the output to the temp file.
    writer.write(line + "\n");
  }
  // Close the temp file once filled up.
  await handle.close();

  // Replace the input file by the temp file.
  await fs.rename(tmpFile, inputFilePath);
}
```
