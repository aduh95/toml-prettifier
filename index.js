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

const formatComment = (comment) => {
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
    const id = replacers.push(formatInlineTable(v, replacers, true));
    object[key] = "__object_to_replace__" + id;
  }
};
const formatInlineTable = (table, replacers = [], skipReplace = false) => {
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

function* formatArray(indentationLevel, key, value, comment) {
  try {
    const values = TOML.parse("_key=" + value)._key.map((val) => {
      return "string" === typeof val || "number" === typeof val
        ? JSON.stringify(val)
        : Array.isArray(val)
        ? `[${val.join(", ")}]`
        : formatInlineTable(val);
    });
    const keyLine = indent(indentationLevel) + key.trim() + " = [";
    const oneLine = keyLine + values.join(", ") + "]";
    if (oneLine.length <= LINE_LENGTH_LIMIT) {
      yield oneLine + formatComment(comment);
    } else {
      yield keyLine;
      for (const value of values) {
        yield indent(indentationLevel + 1) + value + ",";
      }
      yield indent(indentationLevel) + "]" + formatComment(comment);
    }
  } catch (e) {
    console.warn(e);
    yield indent(indentationLevel) +
      key +
      " = " +
      value +
      formatComment(comment);
  }
}

function formatKeyAssignment(indentationLevel, key, value, comment) {
  try {
    const prettyValue = value.startsWith("{")
      ? formatInlineTable(TOML.parse("_key=" + value)._key)
      : value.trimRight();

    return (
      indent(indentationLevel) +
      renderKey(key) +
      " = " +
      prettyValue +
      formatComment(comment)
    );
  } catch (e) {
    console.warn(e);
    return indent(indentationLevel) + key + " = " + value + comment;
  }
}

function* formatMultilineBasicString(
  indentationLevel,
  fullString,
  comment,
  previousWork
) {
  const lastLine = yield* formatMultilineBasicStringLines(
    indentationLevel + 1,
    fullString + "\\",
    previousWork
  );
  // Ignore last line if empty.
  if (lastLine && lastLine.words)
    yield indent(indentationLevel + 1) + lastLine.words + "\\";

  // Close string and print comment.
  yield indent(indentationLevel) + '"""' + formatComment(comment);
}

const formatMultilineBasicStringLineFirstWord = (wordOrLine) =>
  wordOrLine.replace(
    /^\s/,
    (c) => `\\u${c.charCodeAt().toString(16).padStart(4, "0")}`
  );
function* formatMultilineBasicStringLines(
  indentationLevel,
  line,
  previousWork = { previousLineEndingBackslash: false, words: "" }
) {
  const indentation = indent(indentationLevel);
  const lineLengthLimit = LINE_LENGTH_LIMIT - indentation.length;

  line = previousWork.previousLineEndingBackslash
    ? line.trimLeft()
    : formatMultilineBasicStringLineFirstWord(line);

  if (line === "\\") {
    // Skip lines that contain only a backslash
    return {
      previousLineEndingBackslash: true,
      words: previousWork.words,
    };
  }

  // Handle ending backslash
  let isEndingInBackslash = false;
  let i = line.length;
  while (line[--i] === "\\") isEndingInBackslash = !isEndingInBackslash;
  if (isEndingInBackslash) line = line.slice(0, -1);
  else line += "\\n";

  const words = line.split(" ");

  let buffer = previousWork.words
    ? [previousWork.words + words.shift()]
    : undefined;
  let currentLineLength = 2; // counting the trailing space+backslash
  for (const word of words) {
    if (word.includes("\\n")) {
      const lines = word.split("\\n");
      const [firstLine] = lines;
      const lastLineId = lines.length - 1;

      let lineId = 0;
      if (currentLineLength + firstLine.length <= lineLengthLimit) {
        // cut the part that belongs to current line if it fits
        if (buffer) buffer.push(firstLine);
        else buffer = [formatMultilineBasicStringLineFirstWord(firstLine)];

        yield indentation + buffer.join(" ") + "\\n\\";
        lineId++; // Do not treat this line again
      } else if (buffer) {
        // yield previous line if exists
        yield indentation + buffer.join(" ") + " \\";
      }

      // yield intermediate lines
      for (let i = lineId; i < lastLineId; i++)
        yield indentation +
          formatMultilineBasicStringLineFirstWord(lines[i]) +
          "\\n\\";

      currentLineLength = 2;
      // Start buffering the last line if non empty
      if (lines[lastLineId] === "") {
        buffer = undefined;
      } else {
        const firstWord = formatMultilineBasicStringLineFirstWord(
          lines[lastLineId]
        );
        currentLineLength += firstWord.length + 1;
        buffer = [firstWord];
      }
    } else if (buffer === undefined) {
      const firstWord = formatMultilineBasicStringLineFirstWord(word);
      currentLineLength += firstWord.length + 1;
      buffer = [firstWord];
    } else if (currentLineLength + word.length <= lineLengthLimit) {
      currentLineLength += word.length + 1;
      buffer.push(word);
    } else {
      yield indentation + buffer.join(" ") + " \\";

      const firstWord = formatMultilineBasicStringLineFirstWord(word);
      currentLineLength = 2 + firstWord.length + 1;
      buffer = [firstWord];
    }
  }
  return {
    previousLineEndingBackslash: isEndingInBackslash,
    words: (buffer || []).join(" "),
  };
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
          yield* formatArray(indentationLevel, key, value, comment);
        } else if (comment)
          yield indent(indentationLevel) + formatComment(comment).trim();
        break;

      case MULTILINE_BASIC_STRING_MODE:
        {
          let EOS = fullLine.indexOf('"""');
          while (EOS > 0 && fullLine.charAt(EOS - 1) === "\\") {
            EOS = fullLine.indexOf('"""', EOS + 1);
          }
          if (EOS !== -1) {
            mode = NORMAL_MODE;
            yield* formatMultilineBasicString(
              indentationLevel,
              fullLine.substring(0, EOS),
              fullLine.substring(EOS + 3),
              buffer
            );
          } else {
            buffer = yield* formatMultilineBasicStringLines(
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
              formatComment(fullLine.substring(EOS + 3));
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
            yield indent(indentationLevel) + formatComment(comment).trim();
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
            yield* formatArray(indentationLevel, key, value, comment);
          } else {
            mode = MULTILINE_ARRAY_MODE;
            buffer = usefulTOML;
            if (comment)
              yield indent(indentationLevel) + formatComment(comment).trim();
          }
        } else if (value.startsWith('"""')) {
          yield formatKeyAssignment(indentationLevel, key, '"""\\');
          if (singlelineMultilineStringDeclaration.test(value)) {
            yield* formatMultilineBasicString(
              indentationLevel,
              value.slice(3, -3),
              comment
            );
          } else {
            mode = MULTILINE_BASIC_STRING_MODE;
            buffer =
              // newline immediately following the opening delimiter is trimmed
              value.length === 3 && !comment
                ? undefined
                : yield* formatMultilineBasicStringLines(
                    indentationLevel + 1,
                    value.substring(3) + (comment || "")
                  );
          }
        } else if (
          value.startsWith("'''") &&
          !singlelineMultilineLiteralStringDeclaration.test(value)
        ) {
          mode = MULTILINE_LITERAL_STRING_MODE;
          yield formatKeyAssignment(
            indentationLevel,
            key,
            value + (comment || "")
            // comment is actually part of the literal string
          );
        } else {
          yield formatKeyAssignment(indentationLevel, key, value, comment);
        }
        break;
    }
  }
}
