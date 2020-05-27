import TOML from "@aduh95/toml";

const LINE_LENGTH_LIMIT = 80;

const NORMAL_MODE = Symbol("normal mode");
const MULTILINE_ARRAY_MODE = Symbol("array mode");
const MULTILINE_BASIC_STRING_MODE = Symbol("multiline basic string mode");
const MULTILINE_LITERAL_STRING_MODE = Symbol("multiline literal string mode");

const importantBits = /^\s*((?:"(?:\\"|[^"])*"|'[^']*'|[^#])*)(#+.*)?$/;

const arrayOpening = /^(?:"(?:\\"|[^"])*"|'[^']*'|[^="']+)=\s*\[/;
const basicStringOpening = /^(?:"(?:\\"|[^"])*"|'[^']*'|[^="']+)=\s*"""(.*)$/;
const literalStringOpening = /^(?:"(?:\\"|[^"])*"|'[^']*'|[^="']+)=\s*'''(.*)$/;

const singlelineMultilineStringDeclaration = /=\s*""".*[^\\]"""\s*$/;
const singlelineMultilineLiteralStringDeclaration = /=\s*'''.*'''\s*$/;

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

const stringifyNestedTables = (object, key, replacers) => {
  const v = object[key];
  if (Array.isArray(v)) {
    v.map((_, i) => stringifyNestedTables(object[key], i, replacers));
  } else if ("object" === typeof v) {
    const id = replacers.push(printPrettyInlineTable(v, replacers, true));
    object[key] = "__object_to_replace__" + id;
  }
};
const printPrettyInlineTable = (table, replacers = [], skipReplace = false) => {
  for (const key of Object.keys(table)) {
    stringifyNestedTables(table, key, replacers);
  }

  let result = `{ ${TOML.stringify(table).trim().split("\n").join(", ")} }`;

  if (!skipReplace) {
    for (let i = replacers.length; i; i--) {
      result = result.replace(`"__object_to_replace__${i}"`, replacers[i - 1]);
    }
  }

  return result;
};

function* printPrettyArray(buffer, indentationLevel) {
  try {
    const key = buffer.substring(0, buffer.indexOf("="));
    const values = TOML.parse(buffer.replace(key, "values")).values.map(
      (val) => {
        return "string" === typeof val || "number" === typeof val
          ? JSON.stringify(val)
          : Array.isArray(val)
          ? `[${val.join(", ")}]`
          : printPrettyInlineTable(val);
      }
    );
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
  } catch (e) {
    console.warn(e);
    yield indent(indentationLevel) + buffer;
  }
}

function prettyPrintKeyAssignment(indentationLevel, actualLine, comment) {
  try {
    const [key, ...value] = actualLine.split("=");

    const prettyValue =
      value[0].trimLeft()[0] === "{"
        ? printPrettyInlineTable(
            TOML.parse(actualLine.replace(key, "table")).table
          )
        : value.join("=").trim();

    return (
      indent(indentationLevel) +
      renderKey(key) +
      " = " +
      prettyValue +
      printPrettyComment(comment)
    );
  } catch (e) {
    console.warn(e);
    return indent(indentationLevel) + actualLine + comment;
  }
}

/**
 * Prettifies TOML code.
 * @param {AsyncIterable<string>} input TOML lines
 * @returns {AsyncGenerator<string>} Formatted TOML lines
 */
export default async function* prettify(input) {
  let mode = NORMAL_MODE;
  let indentationLevel = 0;

  let buffer;

  for await (const fullLine of input) {
    const [, usefulTOML, comment] = fullLine.match(importantBits) || [];

    switch (mode) {
      case MULTILINE_ARRAY_MODE:
        buffer += usefulTOML;
        if (comment)
          yield indent(indentationLevel) + printPrettyComment(comment).trim();
        if (usefulTOML.endsWith("]")) {
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
          const words = buffer
            .slice(0, -4)
            .split(/(?<!\\)\\\s+|\s/)
            .filter((word) => word.length !== 0); // Ignore empty words
          buffer = words.shift();
          const indentation = indent(indentationLevel + 1);
          for (const word of words) {
            if (
              buffer.length + word.length + 3 <=
              LINE_LENGTH_LIMIT - indentation.length
            ) {
              buffer += " " + word;
            } else {
              yield indentation + buffer + " \\";
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
        if (!usefulTOML) {
          if (comment)
            yield indent(indentationLevel) + printPrettyComment(comment).trim();
          else yield "";
        } else if (usefulTOML.startsWith("[")) {
          indentationLevel = usefulTOML.split(".").length;
          yield indent(indentationLevel - 1) + usefulTOML;
        } else if (arrayOpening.test(usefulTOML)) {
          if (comment)
            yield indent(indentationLevel) + printPrettyComment(comment).trim();
          if (usefulTOML.endsWith("]")) {
            yield* printPrettyArray(usefulTOML, indentationLevel);
          } else {
            mode = MULTILINE_ARRAY_MODE;
            buffer = usefulTOML;
          }
        } else if (
          basicStringOpening.test(usefulTOML) &&
          !singlelineMultilineStringDeclaration.test(usefulTOML)
        ) {
          mode = MULTILINE_BASIC_STRING_MODE;
          buffer = fullLine.match(basicStringOpening)[1] + " ";
          yield prettyPrintKeyAssignment(
            indentationLevel,
            fullLine.substring(0, fullLine.length - buffer.length + 1) + "\\"
          );
        } else if (
          literalStringOpening.test(usefulTOML) &&
          !singlelineMultilineLiteralStringDeclaration.test(usefulTOML)
        ) {
          mode = MULTILINE_LITERAL_STRING_MODE;
          yield prettyPrintKeyAssignment(indentationLevel, fullLine);
        } else {
          yield prettyPrintKeyAssignment(indentationLevel, usefulTOML, comment);
        }
        break;
    }
  }
}
