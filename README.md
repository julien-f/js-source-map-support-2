# julien-f-source-map-support [![Build Status](https://travis-ci.org/julien-f/js-source-map-support-2.png?branch=master)](https://travis-ci.org/julien-f/js-source-map-support-2)

> Source maps for Node (using stack-chain)

Differences with [source-map-support](https://www.npmjs.com/package/source-map-support):

- support only Node (no browsers)
- simpler:
    - do not handle uncaught exceptions
    - cannot specify a custom resolution
- based on [stack-chain](https://www.npmjs.com/package/stack-chain)

> Note: the name of this package is temporary, maybe it will be
> renamed to something better or it will be integrated with
> [source-map-support](https://www.npmjs.com/package/source-map-support).

## Install

Installation of the [npm package](https://npmjs.org/package/julien-f-source-map-support):

```
> npm install --save julien-f-source-map-support
```

## Usage

```js
import 'julien-f-source-map-support/register'
```

The perfect setup:

```js
Error.stackTraceLimit = 100

// Async traces.
//
// Does not work with Node < 4.
try { require('trace') } catch (_) {}

// Hide core modules from traces.
require('clarify')

// Support source maps.
require('julien-f-source-map-support')
```

## Development

### Installing dependencies

```
> npm install
```

### Compilation

The sources files are watched and automatically recompiled on changes.

```
> npm run dev
```

### Tests

```
> npm run test-dev
```

## Contributions

Contributions are *very* welcomed, either on the documentation or on
the code.

You may:

- report any [issue](https://github.com/julien-f/js-source-map-support-2/issues)
  you've encountered;
- fork and create a pull request.

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
