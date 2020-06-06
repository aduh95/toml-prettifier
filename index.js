import * as TOML from "@aduh95/toml";

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

function* printPrettyArray(indentationLevel, key, value, comment) {
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
      yield oneLine + printPrettyComment(comment);
    } else {
      yield keyLine;
      for (const value of values) {
        yield indent(indentationLevel + 1) + value + ",";
      }
      yield indent(indentationLevel) + "]" + printPrettyComment(comment);
    }
  } catch (e) {
    console.warn(e);
    yield indent(indentationLevel) +
      key +
      " = " +
      value +
      printPrettyComment(comment);
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

function* prettyPrintMultilineBasicString(
  indentationLevel,
  fullString,
  comment,
  previousWork
) {
  const lastLine = yield* prettyPrintMultilineBasicStringLines(
    indentationLevel + 1,
    fullString,
    previousWork
  );
  yield indent(indentationLevel + 1) + lastLine.join(" ") + "\\";
  yield indent(indentationLevel) + '"""' + printPrettyComment(comment);
}
function* prettyPrintMultilineBasicStringLines(
  indentationLevel,
  str,
  previousWork = []
) {
  const indentation = indent(indentationLevel);
  const lineLengthLimit = LINE_LENGTH_LIMIT - indentation.length;
  // Split ignoring empty strings.
  const words = previousWork.concat(
    str.split(/(?<!\\)\\\s|\s/).filter(Boolean)
  );

  let buffer = undefined;
  let currentLineLength = 2; // counting the trailing space+backslash
  for (const word of words) {
    if (buffer === undefined) {
      buffer = [word]; // in case the first word is really big
    } else if (currentLineLength + word.length <= lineLengthLimit) {
      buffer.push(word);
    } else {
      yield indentation + buffer.join(" ") + " \\";
      currentLineLength = 2; // counting the trailing space+backslash
      buffer = [word];
    }
    currentLineLength += word.length + 1;
  }
  return buffer;
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
        if (usefulTOML.trimRight().endsWith("]")) {
          mode = NORMAL_MODE;
          const [, key, value] = buffer.match(keyValueDeclaration);
          yield* printPrettyArray(indentationLevel, key, value, comment);
        } else if (comment)
          yield indent(indentationLevel) + printPrettyComment(comment).trim();
        break;

      case MULTILINE_BASIC_STRING_MODE:
        {
          let EOS = fullLine.indexOf('"""');
          while (EOS > 0 && fullLine.charAt(EOS - 1) === "\\") {
            EOS = fullLine.indexOf('"""', EOS + 1);
          }
          if (EOS !== -1) {
            mode = NORMAL_MODE;
            yield* prettyPrintMultilineBasicString(
              indentationLevel,
              fullLine.substring(0, EOS),
              fullLine.substring(EOS + 3),
              buffer
            );
          } else {
            buffer = yield* prettyPrintMultilineBasicStringLines(
              indentationLevel + 1,
              fullLine,
              buffer
            );
          }
        }
        break;

      case MULTILINE_LITERAL_STRING_MODE:
        {
          const EOS = fullLine.indexOf("'''");
          if (EOS !== -1) {
            mode = NORMAL_MODE;
            yield fullLine.substring(0, EOS + 3) +
              printPrettyComment(fullLine.substring(EOS + 3));
          } else {
            yield fullLine;
          }
        }
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
        } else if (!value || !key) {
          // If TOML syntax is not recognized, give up for the current line
          yield fullLine;
        } else if (value.startsWith("[")) {
          if (value.trimRight().endsWith("]")) {
            // single-line array declaration
            yield* printPrettyArray(indentationLevel, key, value, comment);
          } else {
            mode = MULTILINE_ARRAY_MODE;
            buffer = usefulTOML;
            if (comment)
              yield indent(indentationLevel) +
                printPrettyComment(comment).trim();
          }
        } else if (value.startsWith('"""')) {
          yield prettyPrintKeyAssignment(indentationLevel, key, '"""\\');
          if (singlelineMultilineStringDeclaration.test(value)) {
            yield* prettyPrintMultilineBasicString(
              indentationLevel,
              value.slice(3, -3),
              comment
            );
          } else {
            mode = MULTILINE_BASIC_STRING_MODE;
            buffer = yield* prettyPrintMultilineBasicStringLines(
              indentationLevel + 1,
              value.substring(3) + (comment || "")
            );
          }
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
