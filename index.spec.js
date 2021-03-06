// Test suite taken from https://github.com/evanw/node-source-map-support

require("./register");
const clearCache = require("./").clearCache;

// ===================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const SourceMapGenerator = require("source-map").SourceMapGenerator;
let test = require("tape");

// ===================================================================

// Clear the cache after each test.
test = (function(test) {
  return function(name, listener) {
    test(name, function(assert) {
      assert.on("end", clearCache);
      listener(assert);
    });
  };
})(test);

// ===================================================================

function compareLines(actual, expected) {
  assert(
    actual.length >= expected.length,
    "got " +
      actual.length +
      " lines but expected at least " +
      expected.length +
      " lines"
  );
  for (let i = 0; i < expected.length; i++) {
    // Some tests are regular expressions because the output format changed slightly between node v0.9.2 and v0.9.3
    if (expected[i] instanceof RegExp) {
      assert(
        expected[i].test(actual[i]),
        JSON.stringify(actual[i]) + " does not match " + expected[i]
      );
    } else {
      assert.equal(actual[i], expected[i]);
    }
  }
}

function createEmptySourceMap() {
  return new SourceMapGenerator({
    file: GENERATED_PATH,
    sourceRoot: ".",
  });
}

function createSourceMapWithGap() {
  const sourceMap = createEmptySourceMap();
  sourceMap.addMapping({
    generated: { line: 100, column: 0 },
    original: { line: 100, column: 0 },
    source: ".original.js",
  });
  return sourceMap;
}

function createMultiLineSourceMap() {
  const sourceMap = createEmptySourceMap();
  for (let i = 1; i <= 100; i++) {
    sourceMap.addMapping({
      generated: { line: i, column: 0 },
      original: { line: 1000 + i, column: 100 + i },
      source: "line" + i + ".js",
    });
  }
  return sourceMap;
}

function createMultiLineSourceMapWithSourcesContent() {
  const sourceMap = createEmptySourceMap();
  let original = new Array(1001).join("\n");
  for (let i = 1; i <= 100; i++) {
    sourceMap.addMapping({
      generated: { line: i, column: 0 },
      original: { line: 1000 + i, column: 5 },
      source: "original.js",
    });
    original += "    line " + i + "\n";
  }
  sourceMap.setSourceContent("original.js", original);
  return sourceMap;
}

const GENERATED_PATH = path.resolve("./.generated.js");

function compareStackTrace(sourceMap, source, expected) {
  // Check once with a separate source map
  fs.writeFileSync(GENERATED_PATH + ".map", sourceMap);
  fs.writeFileSync(
    GENERATED_PATH,
    "exports.test = function() {" +
      source.join("\n") +
      "};//@ sourceMappingURL=.generated.js.map"
  );
  try {
    delete require.cache[GENERATED_PATH];
    require(GENERATED_PATH).test();
  } catch (e) {
    compareLines(e.stack.split("\n"), expected);
  }
  fs.unlinkSync(GENERATED_PATH);
  fs.unlinkSync(GENERATED_PATH + ".map");

  // Check again with an inline source map (in a data URL)
  fs.writeFileSync(
    GENERATED_PATH,
    "exports.test = function() {" +
      source.join("\n") +
      "};//@ sourceMappingURL=data:application/json;base64," +
      Buffer.from(sourceMap.toString()).toString("base64")
  );
  try {
    delete require.cache[GENERATED_PATH];
    require(GENERATED_PATH).test();
  } catch (e) {
    compareLines(e.stack.split("\n"), expected);
  }
  fs.unlinkSync(GENERATED_PATH);
}

// ===================================================================

/* eslint-disable no-regex-spaces */

test("normal throw", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ['throw new Error("test");'],
    ["Error: test", /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/]
  );

  t.end();
});

test("throw inside function", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ["function foo() {", '  throw new Error("test");', "}", "foo();"],
    [
      "Error: test",
      /^    at foo \(.*\/line2\.js:1002:102\)$/,
      /^    at Object\.exports\.test \(.*\/line4\.js:1004:104\)$/,
    ]
  );

  t.end();
});

test("throw inside function inside function", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    [
      "function foo() {",
      "  function bar() {",
      '    throw new Error("test");',
      "  }",
      "  bar();",
      "}",
      "foo();",
    ],
    [
      "Error: test",
      /^    at bar \(.*\/line3\.js:1003:103\)$/,
      /^    at foo \(.*\/line5\.js:1005:105\)$/,
      /^    at Object\.exports\.test \(.*\/line7\.js:1007:107\)$/,
    ]
  );

  t.end();
});

test("eval", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ["eval(\"throw new Error('test')\");"],
    [
      "Error: test",
      /^    at (?:Object\.)?eval \(eval at (?:<anonymous>|exports\.test) \(.*\/line1\.js:1001:101\)/,
      /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
    ]
  );

  t.end();
});

test("eval inside eval", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ['eval("eval(\'throw new Error(\\"test\\")\')");'],
    [
      "Error: test",
      /^    at (?:Object\.)?eval \(eval at <anonymous> \(eval at (?:<anonymous>|exports\.test) \(.*\/line1\.js:1001:101\)/,
      /^    at (?:Object\.)?eval \(eval at (?:<anonymous>|exports\.test) \(.*\/line1\.js:1001:101\)/,
      /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
    ]
  );

  t.end();
});

test("eval inside function", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ["function foo() {", "  eval(\"throw new Error('test')\");", "}", "foo();"],
    [
      "Error: test",
      /^    at eval \(eval at foo \(.*\/line2\.js:1002:102\)/,
      /^    at foo \(.*\/line2\.js:1002:102\)/,
      /^    at Object\.exports\.test \(.*\/line4\.js:1004:104\)$/,
    ]
  );

  t.end();
});

test("eval with sourceURL", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ["eval(\"throw new Error('test')//@ sourceURL=sourceURL.js\");"],
    [
      "Error: test",
      /^    at (?:Object\.)?eval \(sourceURL.js:1:7\)$/,
      /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
    ]
  );

  t.end();
});

test("eval with sourceURL inside eval", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    [
      'eval("eval(\'throw new Error(\\"test\\")//@ sourceURL=sourceURL.js\')");',
    ],
    [
      "Error: test",
      /^    at (?:Object\.)?eval \(sourceURL.js:1:7\)$/,
      /^    at (?:Object\.)?eval \(eval at (?:<anonymous>|exports\.test) \(.*\/line1\.js:1001:101\)/,
      /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
    ]
  );

  t.end();
});

test("function varructor", function(t) {
  compareStackTrace(
    createMultiLineSourceMap(),
    ['throw new Function(")");'],
    [
      /^SyntaxError: Unexpected token (?:'\)'|\))/,
      /^    at (?:Object\.|new )?Function \((?:unknown source|<anonymous>|native)\)$/,
      /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
    ]
  );

  t.end();
});

test("throw with empty source map", function(t) {
  compareStackTrace(
    createEmptySourceMap(),
    ['throw new Error("test");'],
    ["Error: test", /^    at Object\.exports\.test \(.*\/.generated.js:1:34\)$/]
  );

  t.end();
});

test("throw with source map with gap", function(t) {
  compareStackTrace(
    createSourceMapWithGap(),
    ['throw new Error("test");'],
    ["Error: test", /^    at Object\.exports\.test \(.*\/.generated.js:1:34\)$/]
  );

  t.end();
});

test("sourcesContent with data URL", function(t) {
  compareStackTrace(
    createMultiLineSourceMapWithSourcesContent(),
    ['throw new Error("test");'],
    ["Error: test", /^    at Object\.exports\.test \(.*\/original.js:1001:5\)$/]
  );

  t.end();
});

test("finds the last sourceMappingURL", function(t) {
  compareStackTrace(
    createMultiLineSourceMapWithSourcesContent(),
    [
      "//# sourceMappingURL=missing.map.js", // NB: compareStackTrace adds another source mapping.
      'throw new Error("test");',
    ],
    ["Error: test", /^    at Object\.exports\.test \(.*\/original.js:1002:5\)$/]
  );

  t.end();
});

/* The following test duplicates some of the code in
 * `compareStackTrace` but appends a charset to the
 * source mapping url.
 */
test("finds source maps with charset specified", function(t) {
  const sourceMap = createMultiLineSourceMap();
  const source = ['throw new Error("test");'];
  const expected = [
    "Error: test",
    /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
  ];

  fs.writeFileSync(
    GENERATED_PATH,
    "exports.test = function() {" +
      source.join("\n") +
      "};//@ sourceMappingURL=data:application/json;charset=utf8;base64," +
      Buffer.from(sourceMap.toString()).toString("base64")
  );
  try {
    delete require.cache[GENERATED_PATH];
    require(GENERATED_PATH).test();
  } catch (e) {
    compareLines(e.stack.split("\n"), expected);
  }
  fs.unlinkSync(GENERATED_PATH);

  t.end();
});

/* The following test duplicates some of the code in
 * `compareStackTrace` but appends some code and a
 * comment to the source mapping url.
 */
test("allows code/comments after sourceMappingURL", function(t) {
  const sourceMap = createMultiLineSourceMap();
  const source = ['throw new Error("test");'];
  const expected = [
    "Error: test",
    /^    at Object\.exports\.test \(.*\/line1\.js:1001:101\)$/,
  ];

  fs.writeFileSync(
    GENERATED_PATH,
    "exports.test = function() {" +
      source.join("\n") +
      "};//# sourceMappingURL=data:application/json;base64," +
      Buffer.from(sourceMap.toString()).toString("base64") +
      "\n// Some comment below the sourceMappingURL\nvar foo = 0;"
  );
  try {
    delete require.cache[GENERATED_PATH];
    require(GENERATED_PATH).test();
  } catch (e) {
    compareLines(e.stack.split("\n"), expected);
  }
  fs.unlinkSync(GENERATED_PATH);

  t.end();
});
