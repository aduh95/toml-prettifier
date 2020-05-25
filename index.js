import TOML from "@aduh95/toml";

const LINE_LENGTH_LIMIT = 80;

const NORMAL_MODE = Symbol("normal mode");
const MULTILINE_ARRAY_MODE = Symbol("array mode");
const MULTILINE_BASIC_STRING_MODE = Symbol("multiline basic string mode");
const MULTILINE_LITERAL_STRING_MODE = Symbol("multiline literal string mode");

const importantBits = /^\s*((?:"(?:\\"|[^"])+"|'[^']+'|[^#])*)\s*(#+.*)?$/;
const arrayDeclaration = /^(?:"(?:\\"|[^"])+"|'[^']+'|[^="']+)=\s*\[/;

const basicStringOpening = /=\s*"""(.*)$/;
const literalStringOpening = /=\s*'''(.*)$/;
const singlelineMultilineStringDeclaration = /=\s*""".*[^\\]"""$/;
const singlelineMultilineLiteralStringDeclaration = /=\s*'''.*'''$/;

const indent = (indentationLevel) => " ".repeat(indentationLevel * 2);

const unquoteKey = /^["'](\w+)["']\s*$/;
const renderKey = (key) => {
  const [, actualKey] = key.match(unquoteKey) || [, key.trim()];
  return actualKey;
};

const printPrettyComment = (comment) => {
  if (!comment) return "";
  let i = 0;
  while (comment[i] === "#") i++;
  return ` ${comment.substring(0, i)} ${comment.substring(i).trim()}`;
};

const printPrettySingleLineTable = (table) =>
  `{ ${TOML.stringify(table).trim().split("\n").join(", ")} }`;

function* printPrettyArray(buffer, indentationLevel) {
  const key = buffer.substring(0, buffer.indexOf("="));
  const values = TOML.parse(buffer.replace(key, "values")).values.map((val) => {
    return "string" === typeof val || "number" === typeof val
      ? JSON.stringify(val)
      : Array.isArray(val)
      ? `[${val.join(", ")}]`
      : printPrettySingleLineTable(val);
  });
  const keyLine = indent(indentationLevel) + key.trim() + " = [";
  const oneLine = keyLine + values.join(", ") + "]";
  if (oneLine.length <= LINE_LENGTH_LIMIT) {
    yield oneLine;
  } else {
    yield keyLine;
    for (const value of values) {
      yield indent(indentationLevel + 1) + value + ",";
    }
    yield indent(indentationLevel) + "]";
  }
}

/**
 * Prettifies TOML code.
 * @param {AsyncIterator<string>} input TOML lines
 * @returns {AsyncIterator<string>} Formatted TOML lines
 */
export async function* prettify(input) {
  let mode = NORMAL_MODE;
  let indentationLevel = 0;

  let buffer;

  for await (const fullLine of input) {
    const [, actualLine, comment] = fullLine.match(importantBits) || [];
    if (!actualLine) {
      if (comment)
        yield indent(indentationLevel) + printPrettyComment(comment).trim();
      else yield "";

      continue; // skip parsing empty lines
    }

    switch (mode) {
      case MULTILINE_ARRAY_MODE:
        buffer += actualLine;
        if (comment)
          yield indent(indentationLevel) + printPrettyComment(comment).trim();
        if (actualLine.endsWith("]")) {
          mode = NORMAL_MODE;
          yield* printPrettyArray(buffer, indentationLevel);
        }
        break;

      case MULTILINE_BASIC_STRING_MODE:
        buffer += fullLine + " ";
        if (
          fullLine.endsWith('"""') &&
          fullLine.charAt(fullLine.length - 4) !== "\\"
        ) {
          mode = NORMAL_MODE;
          const words = buffer.slice(0, -4).split(/\\\s+|\s/);
          buffer = words.shift();
          const indentation = indent(indentationLevel + 1);
          for (const word of words) {
            if (word.length === 0) continue;
            if (
              buffer.length + word.length + 1 <=
              LINE_LENGTH_LIMIT - indentation.length
            ) {
              buffer += " " + word;
            } else {
              yield indentation + buffer + "\\";
              buffer = word;
            }
          }
          yield indentation + buffer + "\\";
          yield indent(indentationLevel) + '"""';
        }
        break;

      case MULTILINE_LITERAL_STRING_MODE:
        if (fullLine.endsWith("'''")) mode = NORMAL_MODE;
        yield fullLine;
        break;

      case NORMAL_MODE:
        if (actualLine.startsWith("[")) {
          indentationLevel = actualLine.split(".").length;
          yield indent(indentationLevel - 1) + actualLine;
          continue;
        } else if (arrayDeclaration.test(actualLine)) {
          if (comment)
            yield indent(indentationLevel) + printPrettyComment(comment).trim();
          if (actualLine.endsWith("]")) {
            yield* printPrettyArray(actualLine, indentationLevel);
          } else {
            mode = MULTILINE_ARRAY_MODE;
            buffer = actualLine;
          }
          continue;
        } else if (
          basicStringOpening.test(actualLine) &&
          !singlelineMultilineStringDeclaration.test(actualLine)
        ) {
          mode = MULTILINE_BASIC_STRING_MODE;
          buffer = fullLine.match(basicStringOpening)[1];
        } else if (
          literalStringOpening.test(actualLine) &&
          !singlelineMultilineLiteralStringDeclaration.test(actualLine)
        ) {
          mode = MULTILINE_LITERAL_STRING_MODE;
        }
        const [key, ...value] = actualLine.split("=");

        const prettyValue =
          value[0].trimLeft()[0] === "{"
            ? printPrettySingleLineTable(
                TOML.parse(actualLine.replace(key, "table")).table
              )
            : value.join("=").trim();

        yield indent(indentationLevel) +
          renderKey(key) +
          " = " +
          prettyValue +
          printPrettyComment(comment);
        break;
    }
  }
}
