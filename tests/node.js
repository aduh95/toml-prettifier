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

// Read the output file line by line.
const expectedOutput = readLineByLine(
  readLines({
    input: createReadStream(outputFileURL),
    crlfDelay: Infinity,
  })
);

async function* readLineByLine(stream) {
  for await (const line of stream) yield line;
}

let lineNb = 0;
// Pass the input to TOMLPrettifier.
for await (const line of TOMLPrettifier(input)) {
  const { value: expected } = await expectedOutput.next();

  // Compare with expected output.
  assert.strictEqual(
    line,
    expected,
    `Doesn't match ${outputFileURL}:${++lineNb}`
  );
}
