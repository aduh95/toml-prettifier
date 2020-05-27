#!/usr/bin/env node

import assert from "assert";
import { constants, createReadStream, openSync, readSync, closeSync } from "fs";
import { createInterface as readLines } from "readline";

import TOMLPrettifier from "@aduh95/toml-prettifier";

const inputFileURL = new URL("./input.toml", import.meta.url);
const outputFileURL = new URL("./output.toml", import.meta.url);

// Read the input file line by line.
const input = readLines({
  input: createReadStream(inputFileURL),
  crlfDelay: Infinity,
});

const output = openSync(outputFileURL, constants.R_OK);

// Pass the input to TOMLPrettifier.
for await (const line of TOMLPrettifier(input)) {
  const expected = Buffer.allocUnsafe(line.length);
  readSync(output, expected, { length: line.length });
  // Compare with expected output.
  assert.strictEqual(line, expected.toString("utf8"));

  // skip line return char(s)
  for (
    const buf = Buffer.allocUnsafe(1);
    buf[0] !== 10; // 10 is ASCII for \n
    readSync(output, buf, { length: 1 })
  );
}

closeSync(output);
