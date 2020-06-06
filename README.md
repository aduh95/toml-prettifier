# TOML Prettifier

Opinionated TOML code formatter written in JavaScript.

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

#### Web and Deno usage

The API is the same, although you must init the `@aduh95/toml` package manually
before using it. This uses a WASM module that must be initiate asynchronously
and is used to prettify arrays and inline tables.

```js
import TOMLPrettifier from "@aduh95/toml-prettifier";
import initTOMLWasm from "@aduh95/toml";

await initTOMLWasm();
```

### Rules

There are no available configuration for the formatting.

- Keys: unquote the keys when possible.
- Multiline basic strings: wrapped to 80 char, and indented one level below the
  opening and closing char sequence.
- Multiline literal strings: No transformations are made.
- Comments:
  - They respect indentation.
  - One or several `#`s represent the start of a comment, followed by one space
    unless the comment is empty.
- Arrays: If an array can fit on one line, it will be reformated to one line,
  otherwise each element will be on a new line, with a trailing comma.
- Inline tables: keys are alphabetically ordered.
- Empty lines: conserved, but any space is removed.
