#!/usr/bin/env node

import assert from "assert";
import { createReadStream, readFileSync } from "fs";
import { createInterface as readLines } from "readline";

import TOMLPrettifier from "@aduh95/toml-prettifier";

const inputFileURL = new URL("./input.toml", import.meta.url);
const outputFileURL = new URL("./output.toml", import.meta.url);

// Read the input file line by line.
const input = readLines({
  input: createReadStream(inputFileURL),
  crlfDelay: Infinity,
});

const output = readFileSync(outputFileURL);
let position = 0;

// Pass the input to TOMLPrettifier.
for await (const line of TOMLPrettifier(input)) {
  // Compare with expected output.
  assert.strictEqual(
    line,
    output.slice(position, (position += line.length)).toString("utf8")
  );
  position++; // skip line return char
}
