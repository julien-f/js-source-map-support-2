const readFileSync = require("fs").readFileSync;
const resolve = require("path").resolve;
const dirname = require("path").dirname;
const SourceMapConsumer = require("source-map").SourceMapConsumer;
const stackChain = require("stack-chain");

// ===================================================================

function bind(fn, thisArg) {
  function bound() {
    return fn.apply(thisArg, arguments);
  }
  bound.raw = fn;

  return bound;
}

function clearObject(object) {
  for (const key in object) {
    delete object[key];
  }
}

function decodeBase64(base64) {
  return Buffer.from(base64, "base64").toString();
}

function memoize(fn) {
  const cache = Object.create(null);

  function memoized() {
    const key = String(arguments[0]);

    if (key in cache) {
      return cache[key];
    }

    return (cache[key] = fn.apply(this, arguments));
  }
  memoized.cache = cache;
  memoized.raw = fn;

  return memoized;
}

function matchAll(re, str) {
  const matches = [];
  let match;

  while ((match = re.exec(str)) !== null) {
    matches.push(match);
  }

  return matches;
}

function wrap(value) {
  return function() {
    return value;
  };
}

// -------------------------------------------------------------------

/* eslint-disable */
// See https://github.com/evanw/node-source-map-support/commit/3b154ff43eddcaf4efffc456641c92b87788bffb
//
// This is copied almost verbatim from the V8 source code at
// https://code.google.com/p/v8/source/browse/trunk/src/messages.js. The
// implementation of wrapCallSite() used to just forward to the actual source
// code of CallSite.prototype.toString but unfortunately a new release of V8
// did something to the prototype chain and broke the shim. The only fix I
// could find was copy/paste.
function CallSiteToString() {
  var fileName;
  var fileLocation = "";
  if (this.isNative()) {
    fileLocation = "native";
  } else {
    fileName = this.getScriptNameOrSourceURL();
    if (!fileName && this.isEval()) {
      fileLocation = this.getEvalOrigin();
      fileLocation += ", "; // Expecting source position to follow.
    }
    if (fileName) {
      fileLocation += fileName;
    } else {
      // Source code does not originate from a file and is not native, but we
      // can still get the source position inside the source string, e.g. in
      // an eval string.
      fileLocation += "<anonymous>";
    }
    var lineNumber = this.getLineNumber();
    if (lineNumber != null) {
      fileLocation += ":" + lineNumber;
      var columnNumber = this.getColumnNumber();
      if (columnNumber) {
        fileLocation += ":" + columnNumber;
      }
    }
  }
  var line = "";
  var functionName = this.getFunctionName();
  var addSuffix = true;
  var isConstructor = this.isConstructor();
  var isMethodCall = !(this.isToplevel() || isConstructor);
  if (isMethodCall) {
    var typeName = this.getTypeName();
    var methodName = this.getMethodName();
    if (functionName) {
      if (typeName && functionName.indexOf(typeName) != 0) {
        line += typeName + ".";
      }
      line += functionName;
      if (
        methodName &&
        functionName.indexOf("." + methodName) !=
          functionName.length - methodName.length - 1
      ) {
        line += " [as " + methodName + "]";
      }
    } else {
      line += typeName + "." + (methodName || "<anonymous>");
    }
  } else if (isConstructor) {
    line += "new " + (functionName || "<anonymous>");
  } else if (functionName) {
    line += functionName;
  } else {
    line += fileLocation;
    addSuffix = false;
  }
  if (addSuffix) {
    line += " (" + fileLocation + ")";
  }
  return line;
}
/* eslint-enable */

function cloneCallSite(callSite) {
  if (callSite.toString === CallSiteToString) {
    // Already cloned, nothing to do.
    return callSite;
  }

  const ownProps = Object.getOwnPropertyNames(Object.getPrototypeOf(callSite));

  const copy = Object.create(null);
  for (let i = 0, n = ownProps.length; i < n; ++i) {
    const key = ownProps[i];
    const value = callSite[key];

    copy[key] = /^(?:is|get)/.test(key) ? bind(value, callSite) : value;
  }

  copy.toString = CallSiteToString;
  return copy;
}

const getFile = memoize(function(fileName) {
  try {
    return readFileSync(fileName, "utf8");
  } catch (_) {
    return null;
  }
});

function makeSourceMapper(data, path) {
  const map = new SourceMapConsumer(data);
  const basedir = dirname(path);

  return function(line, column) {
    const position = map.originalPositionFor({ line: line, column: column });

    const origSource = position.source;
    return (
      origSource != null && {
        column: position.column,
        line: position.line,
        fileName: resolve(basedir, origSource), // source-map calls it source.
      }
    );
  };
}

// ===================================================================

// Trick to get the number of prepended characters for the first line
// in Node.
const firstLineColumnShift = (function() {
  // See https://github.com/evanw/node-source-map-support/blob/61ebf232484dbe069721bbfe36c8405ab5ac3954/source-map-support.js#L358-L361
  if (
    /^v(10\.1[6-9]|10\.[2-9][0-9]|10\.[0-9]{3,}|1[2-9]\d*|[2-9]\d|\d{3,}|11\.11)/.test(
      process.version
    )
  ) {
    return 0;
  }

  const originalPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function(_, callSites) {
    return callSites[0].getColumnNumber();
  };

  const n = require("./error-stack");

  Error.prepareStackTrace = originalPrepareStackTrace;

  return n;
})();

const RE_SOURCE_MAP_URL = new RegExp(
  [
    // Single line comment.
    "//[@#]\\s+sourceMappingURL=(\\S+)\\s*$",

    // Multi line comment.
    "/\\*[@#]\\s+sourceMappingURL=(\\S+?)\\s*\\*/",
  ].join("|"),
  "mg"
);

const RE_INLINE_SOURCE_MAP = /^data:application\/json[^,]+base64,/g;

const getSourceMapper = memoize(function(fileName) {
  let data, path;

  // Try to get lucky by trying directly `<fileName>.map`.
  path = fileName + ".map";
  data = getFile(path);
  if (data) {
    return makeSourceMapper(data, path);
  }

  // Load the file.
  const file = getFile(fileName);
  if (!file) {
    return;
  }

  // Look for a source map URL.
  const matches = matchAll(RE_SOURCE_MAP_URL, file).pop();
  if (!matches) {
    return;
  }

  path = matches[1];

  // If it is an inline source map, process it.
  if (RE_INLINE_SOURCE_MAP.test(path)) {
    data = decodeBase64(path.slice(RE_INLINE_SOURCE_MAP.lastIndex));
    path = fileName;

    return makeSourceMapper(data, path);
  }

  data = getFile(path);
  if (!data) {
    return;
  }

  return makeSourceMapper(data, path);
});

function mapPosition(fileName, line, column) {
  const mapper = getSourceMapper(fileName);
  if (mapper) {
    return mapper(line, column);
  }
}

const RE_EVAL_ORIGIN = /^eval at ([^(]+) \((.+):(\d+):(\d+)\)$/;
const RE_EVAL_ORIGIN_NESTED = /^eval at ([^(]+) \((.+)\)$/;

function mapEvalOrigin(origin) {
  let matches, position;

  matches = RE_EVAL_ORIGIN.exec(origin);
  if (matches) {
    position = mapPosition(matches[2], +matches[3], +matches[4]);

    return (
      position &&
      [
        "eval at ",
        matches[1],
        " (",
        position.fileName,
        ":",
        position.line,
        ":",
        position.column,
        ")",
      ].join("")
    );
  }

  matches = RE_EVAL_ORIGIN_NESTED.exec(origin);
  if (matches) {
    return ["eval at ", matches[1], " (", mapEvalOrigin(matches[2]), ")"].join(
      ""
    );
  }
}

function wrapCallSite(callSite) {
  const fileName = callSite.getFileName();

  let origin;
  if (
    callSite.isEval() &&
    (origin = callSite.getEvalOrigin()) &&
    (origin = mapEvalOrigin(origin))
  ) {
    callSite = cloneCallSite(callSite);
    callSite.getEvalOrigin = wrap(origin);
  }

  // Some lines do not have a source file (native code for instance).
  if (!fileName) {
    return callSite;
  }

  const line = callSite.getLineNumber();
  let column = callSite.getColumnNumber();

  if (line === 1) {
    column -= firstLineColumnShift;

    // Fix the column even if there is no source map.
    callSite = cloneCallSite(callSite);
    callSite.getColumnNumber = wrap(column);
  }

  const position = mapPosition(fileName, line, column);
  if (!position) {
    return callSite;
  }

  callSite = cloneCallSite(callSite);
  callSite.getColumnNumber = wrap(position.column);
  callSite.getFileName = wrap(position.fileName);
  callSite.getLineNumber = wrap(position.line);
  callSite.getScriptNameOrSourceURL = wrap(position.fileName);

  return callSite;
}

// -------------------------------------------------------------------

exports = module.exports = function register() {
  stackChain.extend.attach(function sourceMapModifier(_, callSites) {
    const n = callSites.length;
    const wrapped = new Array(n);

    for (let i = 0; i < n; ++i) {
      let callSite = callSites[i];
      try {
        callSite = wrapCallSite(callSite);
      } catch (_) {
        // we must never throw when decorating an stack trace
      }
      wrapped[i] = callSite;
    }

    return wrapped;
  });
};

exports.clearCache = function clearCache() {
  clearObject(getFile.cache);
  clearObject(getSourceMapper.cache);
};
