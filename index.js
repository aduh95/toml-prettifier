import TOML from "@aduh95/toml";

const LINE_LENGTH_LIMIT = 80;

const NORMAL_MODE = Symbol("normal mode");
const MULTILINE_ARRAY_MODE = Symbol("array mode");
const MULTILINE_BASIC_STRING_MODE = Symbol("multiline basic string mode");
const MULTILINE_LITERAL_STRING_MODE = Symbol("multiline literal string mode");

const importantBits = /^\s*((?:"(?:\\"|[^"])*"|'[^']*'|[^#])*)(#+.*)?$/;
const keyValueDeclaration = /^((?:"(?:\\"|[^"])*"|'[^']*'|[^="']+)+)=\s*(.+)$/;

const singlelineMultilineStringDeclaration = /^""".*[^\\]"""\s*$/;
const singlelineMultilineLiteralStringDeclaration = /^'''.*'''\s*$/;

const indent = (indentationLevel) => " ".repeat(indentationLevel * 2);

const quotedToBare = /(?:(?<=\.)|^)\s*["']([A-Za-z0-9_-]+)["']/g;
const renderKey = (key) =>
  key.replace(quotedToBare, (_, unquotedKey) => unquotedKey).trim();

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

function* printPrettyArray(key, value, indentationLevel) {
  try {
    const values = TOML.parse("_key=" + value)._key.map((val) => {
      return "string" === typeof val || "number" === typeof val
        ? JSON.stringify(val)
        : Array.isArray(val)
        ? `[${val.join(", ")}]`
        : printPrettyInlineTable(val);
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
  } catch (e) {
    console.warn(e);
    yield indent(indentationLevel) + buffer;
  }
}

function prettyPrintKeyAssignment(indentationLevel, key, value, comment) {
  try {
    const prettyValue = value.startsWith("{")
      ? printPrettyInlineTable(TOML.parse("_key=" + value)._key)
      : value.trimRight();

    return (
      indent(indentationLevel) +
      renderKey(key) +
      " = " +
      prettyValue +
      printPrettyComment(comment)
    );
  } catch (e) {
    console.warn(e);
    return indent(indentationLevel) + key + " = " + value + comment;
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
          const [, key, value] = buffer.match(keyValueDeclaration);
          yield* printPrettyArray(key, value, indentationLevel);
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
        const [, key, value] = usefulTOML
          ? usefulTOML.match(keyValueDeclaration) || []
          : [];

        if (!usefulTOML) {
          if (comment)
            yield indent(indentationLevel) + printPrettyComment(comment).trim();
          else yield "";
        } else if (usefulTOML.startsWith("[")) {
          indentationLevel = usefulTOML.split(".").length;
          yield indent(indentationLevel - 1) + usefulTOML;
        } else if (value.startsWith("[")) {
          if (comment)
            yield indent(indentationLevel) + printPrettyComment(comment).trim();
          if (value.trimRight().endsWith("]")) {
            // single-line array declaration
            yield* printPrettyArray(key, value, indentationLevel);
          } else {
            mode = MULTILINE_ARRAY_MODE;
            buffer = usefulTOML;
          }
        } else if (
          value.startsWith('"""') &&
          !singlelineMultilineStringDeclaration.test(value)
        ) {
          mode = MULTILINE_BASIC_STRING_MODE;
          buffer = value.substring(3) + (comment || "") + " ";
          yield prettyPrintKeyAssignment(indentationLevel, key, '"""\\');
        } else if (
          value.startsWith("'''") &&
          !singlelineMultilineLiteralStringDeclaration.test(value)
        ) {
          mode = MULTILINE_LITERAL_STRING_MODE;
          yield prettyPrintKeyAssignment(
            indentationLevel,
            key,
            value + (comment || "")
            // comment is actually part of the literal string
          );
        } else {
          yield prettyPrintKeyAssignment(indentationLevel, key, value, comment);
        }
        break;
    }
  }
}
