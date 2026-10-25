import { createRequire as __voiceCreateRequire } from 'node:module'
const require = __voiceCreateRequire(import.meta.url)
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list2, totalLength) {
      if (list2.length === 0) return EMPTY_BUFFER;
      if (list2.length === 1) return list2[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list2.length; i++) {
        const buf = list2[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list2, cb) {
        if (list2.length === 2) {
          this._socket.cork();
          this._socket.write(list2[0]);
          this._socket.write(list2[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list2[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes: randomBytes2, createHash: createHash4 } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            if (!options || options.protocols === void 0) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              if (options.protocols === void 0) {
                protocols = [];
              } else if (Array.isArray(options.protocols)) {
                protocols = options.protocols;
              } else {
                protocols = [options.protocols];
              }
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        this._readyState = _WebSocket.CLOSING;
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        protocols: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes2(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash4("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash: createHash4 } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash4("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/index.ts
import { dirname as dirname5, resolve as resolve3 } from "node:path";

// src/llm.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// src/protocol.ts
import { randomUUID } from "node:crypto";
var PROTOCOL_VERSION = 2;
var SUPPORTED_VERSIONS = [1, 2];
var SAMPLE_RATE_IN = 16e3;
var SAMPLE_RATE_OUT = 24e3;
var AUDIO_FORMAT = { encoding: "pcm_s16le", channels: 1 };
var CAPABILITIES = ["turns", "conversation.select", "playback", "playback.flow", "response.stop", "audio.framed", "agent.activity", "presentation.state", "presentation.cue", "ui.render"];
var VoiceError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function identifier(value, max = 64) {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value);
}
function newId() {
  return randomUUID();
}
function abortable(operation, signal) {
  if (signal.aborted) {
    void operation.catch(() => void 0);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve4, reject) => {
    const cancel = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    operation.then((value) => {
      cleanup();
      resolve4(value);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}
function delay(ms, signal) {
  return new Promise((resolve4, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve4();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

// src/interaction.ts
import { Buffer as Buffer2 } from "node:buffer";
var EXPRESSIONS = ["neutral", "happy", "sad", "surprised", "thinking", "confused", "calm"];
var GESTURES = ["nod", "shake", "wave", "point", "celebrate"];
var COMPONENTS = ["card", "choices", "progress", "form"];
function object(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VoiceError("bad_interaction", "\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new VoiceError("bad_interaction", `\u4E0D\u652F\u6301\u5B57\u6BB5 ${key}`);
  return value;
}
function text(value, max, optional = false) {
  if (optional && value === void 0) return;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new VoiceError("bad_interaction", `\u6587\u672C\u5FC5\u987B\u4E3A 1\u2013${max} \u5B57\u7B26`);
  return value;
}
function id(value) {
  if (!identifier(value)) throw new VoiceError("bad_interaction", "ID \u5FC5\u987B\u4E3A 1\u201364 \u4F4D\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26");
  return value;
}
function number(value, min, max, fallback) {
  if (value === void 0 && fallback !== void 0) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new VoiceError("bad_interaction", `\u6570\u503C\u5FC5\u987B\u5728 ${min}\u2013${max} \u4E4B\u95F4`);
  return value;
}
function list(value, max, parse) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new VoiceError("bad_interaction", `\u6570\u7EC4\u9700\u5305\u542B 1\u2013${max} \u9879`);
  return value.map(parse);
}
function unique(items) {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new VoiceError("bad_interaction", "\u5B58\u5728\u91CD\u590D ID");
}
function support(value) {
  const source = value === void 0 ? {} : object(value, ["expressions", "gestures", "components"]);
  const names = (v, defaults) => v === void 0 ? [...defaults] : Array.isArray(v) && v.length === 0 ? [] : [...new Set(list(v, 32, id))];
  const components = names(source.components, COMPONENTS);
  if (components.some((name) => !COMPONENTS.includes(name))) throw new VoiceError("bad_interaction", "\u672A\u77E5 UI \u7EC4\u4EF6\u7C7B\u578B");
  return { expressions: names(source.expressions, EXPRESSIONS), gestures: names(source.gestures, GESTURES), components };
}
function cue(value, supported) {
  const source = object(value, ["expression", "gesture", "durationMs", "intensity", "timing"]);
  if (!source.expression && !source.gesture) throw new VoiceError("bad_interaction", "\u81F3\u5C11\u6307\u5B9A\u8868\u60C5\u6216\u52A8\u4F5C");
  if (source.expression !== void 0 && !supported.expressions.includes(source.expression)) throw new VoiceError("unsupported_presentation", "\u5BA2\u6237\u7AEF\u4E0D\u652F\u6301\u8BE5\u8868\u60C5");
  if (source.gesture !== void 0 && !supported.gestures.includes(source.gesture)) throw new VoiceError("unsupported_presentation", "\u5BA2\u6237\u7AEF\u4E0D\u652F\u6301\u8BE5\u52A8\u4F5C");
  if (source.timing !== void 0 && !["now", "next_sentence"].includes(source.timing)) throw new VoiceError("bad_interaction", "timing \u5FC5\u987B\u4E3A now \u6216 next_sentence");
  return { ...source.expression ? { expression: source.expression } : {}, ...source.gesture ? { gesture: source.gesture } : {}, durationMs: number(source.durationMs, 100, 1e4, 1800), intensity: number(source.intensity, 0, 1, 0.7), timing: source.timing ?? "now" };
}
function component(value, supported) {
  const s = object(value, ["id", "type", "title", "text", "rows", "actions", "fields", "value", "expiresInMs"]);
  if (!supported.components.includes(s.type)) throw new VoiceError("unsupported_component", "\u5BA2\u6237\u7AEF\u4E0D\u652F\u6301\u8BE5\u7EC4\u4EF6");
  const result = { id: id(s.id), type: s.type, title: text(s.title, 120), expiresInMs: number(s.expiresInMs, 1e4, 18e5, 3e5) };
  const body = text(s.text, 2e3, true);
  if (body !== void 0) result.text = body;
  if (s.rows !== void 0) result.rows = list(s.rows, 12, (item) => {
    const r = object(item, ["label", "value"]);
    return { label: text(r.label, 80), value: text(r.value, 256) };
  });
  if (s.actions !== void 0) {
    result.actions = list(s.actions, 8, (item) => {
      const a = object(item, ["id", "label", "prompt"]);
      return { id: id(a.id), label: text(a.label, 80), prompt: text(a.prompt, 1e3) };
    });
    unique(result.actions);
  }
  if (s.fields !== void 0) {
    result.fields = list(s.fields, 8, (item) => {
      const f = object(item, ["id", "label", "type", "required", "options", "min", "max"]);
      if (!["text", "number", "boolean", "select"].includes(f.type) || f.required !== void 0 && typeof f.required !== "boolean") throw new VoiceError("bad_interaction", "\u65E0\u6548\u8868\u5355\u5B57\u6BB5");
      const field = { id: id(f.id), label: text(f.label, 80), type: f.type, required: f.required ?? false };
      if (f.type === "select") {
        field.options = list(f.options, 12, (item2) => {
          const o = object(item2, ["value", "label"]);
          return { value: text(o.value, 80), label: text(o.label, 80) };
        });
        if (new Set(field.options.map((o) => o.value)).size !== field.options.length) throw new VoiceError("bad_interaction", "\u9009\u9879\u503C\u91CD\u590D");
      } else if (f.options !== void 0) throw new VoiceError("bad_interaction", "\u53EA\u6709 select \u652F\u6301 options");
      if (f.min !== void 0) field.min = number(f.min, -1e9, 1e9);
      if (f.max !== void 0) field.max = number(f.max, -1e9, 1e9);
      if ((f.min !== void 0 || f.max !== void 0) && f.type !== "number") throw new VoiceError("bad_interaction", "\u53EA\u6709 number \u652F\u6301\u8303\u56F4");
      if (field.min !== void 0 && field.max !== void 0 && field.min > field.max) throw new VoiceError("bad_interaction", "\u6570\u503C\u8303\u56F4\u98A0\u5012");
      return field;
    });
    unique(result.fields);
  }
  if (s.type === "progress") {
    if (s.value !== void 0) result.value = number(s.value, 0, 1);
    if (s.actions !== void 0 || s.fields !== void 0 || s.rows !== void 0) throw new VoiceError("bad_interaction", "\u8FDB\u5EA6\u7EC4\u4EF6\u4E0D\u5305\u542B\u8868\u5355\u6216\u64CD\u4F5C");
  } else if (s.value !== void 0) throw new VoiceError("bad_interaction", "\u53EA\u6709 progress \u652F\u6301 value");
  if (s.type === "choices" && !result.actions?.length) throw new VoiceError("bad_interaction", "\u9009\u9879\u7EC4\u4EF6\u5FC5\u987B\u63D0\u4F9B actions");
  if (s.type === "form" && (!result.fields?.length || result.actions?.length !== 1)) throw new VoiceError("bad_interaction", "\u8868\u5355\u9700\u5B57\u6BB5\u548C\u4E00\u4E2A\u63D0\u4EA4\u64CD\u4F5C");
  if (s.type !== "form" && s.fields !== void 0) throw new VoiceError("bad_interaction", "\u53EA\u6709 form \u652F\u6301 fields");
  if (Buffer2.byteLength(JSON.stringify(result), "utf8") > 12 * 1024) throw new VoiceError("bad_interaction", "\u7EC4\u4EF6\u8D85\u8FC7 12KiB \u5927\u5C0F\u4E0A\u9650");
  return result;
}
function formValues(fields = [], value) {
  const source = object(value ?? {}, fields.map((f) => f.id)), result = /* @__PURE__ */ Object.create(null);
  for (const field of fields) {
    const v = Object.hasOwn(source, field.id) ? source[field.id] : void 0;
    if (v === void 0 || v === "") {
      if (field.required) throw new VoiceError("bad_ui_values", `${field.label} \u4E3A\u5FC5\u586B\u9879`);
      continue;
    }
    if (field.type === "number") result[field.id] = number(v, field.min ?? -1e9, field.max ?? 1e9);
    else if (field.type === "boolean") {
      if (typeof v !== "boolean") throw new VoiceError("bad_ui_values", "\u5E03\u5C14\u5B57\u6BB5\u7C7B\u578B\u9519\u8BEF");
      if (field.required && !v) throw new VoiceError("bad_ui_values", `${field.label} \u9700\u8981\u52FE\u9009`);
      result[field.id] = v;
    } else {
      const parsed = text(v, 256);
      if (field.type === "select" && !field.options.some((o) => o.value === parsed)) throw new VoiceError("bad_ui_values", "\u9009\u62E9\u4E86\u4E0D\u5B58\u5728\u7684\u9009\u9879");
      result[field.id] = parsed;
    }
  }
  return result;
}
var string = (maxLength = 128) => ({ type: "string", maxLength });
function interactionTools(supported, capabilities, emit, valid) {
  const output = { schema: { type: "object", properties: { ok: { type: "boolean" }, result: { type: "string" } }, required: ["ok", "result"], additionalProperties: false }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] };
  const tool = (name, description, properties, required, execute) => ({ name, description, parameters: { type: "object", properties, required, additionalProperties: false }, output, async execute(args, exec) {
    valid(exec);
    exec.signal.throwIfAborted();
    return { ok: true, result: JSON.stringify(execute(args)) };
  } });
  const tools = [];
  if (capabilities.includes("presentation.cue") && (supported.expressions.length || supported.gestures.length)) tools.push(tool("voice_present", "Control this voice client avatar. Emit a supported expression/gesture; next_sentence synchronizes with the first audio of your next spoken sentence. Do not put animation instructions in spoken text.", {
    ...supported.expressions.length ? { expression: { type: "string", enum: supported.expressions } } : {},
    ...supported.gestures.length ? { gesture: { type: "string", enum: supported.gestures } } : {},
    durationMs: { type: "number", minimum: 100, maximum: 1e4 },
    intensity: { type: "number", minimum: 0, maximum: 1 },
    timing: { type: "string", enum: ["now", "next_sentence"] }
  }, [], (args) => emit({ kind: "cue", cue: cue(args, supported) })));
  if (capabilities.includes("ui.render") && supported.components.length) tools.push(tool("voice_ui", "Render or update a declarative client component by id. Server owns revision and expiry. Actions use server-stored prompt text and submit a new user turn after the current turn ends. Use card, choices, progress or form. Text is plain text. Remove with operation=remove and componentId.", {
    operation: { type: "string", enum: ["render", "remove"] },
    componentId: string(64),
    component: { type: "object", properties: { id: string(64), type: { type: "string", enum: supported.components }, title: string(120), text: string(2e3), value: { type: "number", minimum: 0, maximum: 1 }, expiresInMs: { type: "number", minimum: 1e4, maximum: 18e5 }, rows: { type: "array", maxItems: 12, items: { type: "object", properties: { label: string(80), value: string(256) }, required: ["label", "value"], additionalProperties: false } }, actions: { type: "array", maxItems: 8, items: { type: "object", properties: { id: string(64), label: string(80), prompt: string(1e3) }, required: ["id", "label", "prompt"], additionalProperties: false } }, fields: { type: "array", maxItems: 8, items: { type: "object", properties: { id: string(64), label: string(80), type: { type: "string", enum: ["text", "number", "boolean", "select"] }, required: { type: "boolean" }, min: { type: "number" }, max: { type: "number" }, options: { type: "array", maxItems: 12, items: { type: "object", properties: { value: string(80), label: string(80) }, required: ["value", "label"], additionalProperties: false } } }, required: ["id", "label", "type"], additionalProperties: false } } }, required: ["id", "type", "title"], additionalProperties: false }
  }, ["operation"], (args) => {
    const s = object(args, ["operation", "componentId", "component"]);
    if (s.operation === "remove") {
      if (s.component !== void 0) throw new VoiceError("bad_interaction", "remove \u4E0D\u63A5\u53D7 component");
      return emit({ kind: "remove", componentId: id(s.componentId) });
    }
    if (s.operation !== "render" || s.componentId !== void 0) throw new VoiceError("bad_interaction", "render \u9700\u8981 component");
    return emit({ kind: "render", component: component(s.component, supported) });
  }));
  return tools;
}

// src/persona.ts
var VOICE_PRESET_ID = "yusheng-assistant";
var PERSONALITIES = [
  { id: "warm", name: "\u6E29\u6696\u4F53\u8D34", description: "\u4EB2\u5207\u3001\u7EC6\u5FC3\uFF0C\u9002\u5EA6\u5171\u60C5\uFF0C\u4E0D\u4F7F\u7528\u5938\u5F20\u7684\u5B89\u6170\u548C\u5949\u627F\u3002", sample: "\u6211\u5728\u5462\uFF0C\u60F3\u804A\u804A\u5929\uFF0C\u8FD8\u662F\u4E00\u8D77\u505A\u70B9\u4EC0\u4E48\uFF1F" },
  { id: "lively", name: "\u6D3B\u6CFC\u5F00\u6717", description: "\u8F7B\u5FEB\u3001\u6709\u6D3B\u529B\uFF0C\u53EF\u4EE5\u9002\u5EA6\u5E7D\u9ED8\uFF0C\u907F\u514D\u8FC7\u5206\u5356\u840C\u6216\u55A7\u95F9\u3002", sample: "\u6211\u51C6\u5907\u597D\u5566\uFF0C\u4ECA\u5929\u6709\u4EC0\u4E48\u65B0\u9C9C\u4E8B\uFF1F" },
  { id: "calm", name: "\u6C89\u7A33\u8010\u5FC3", description: "\u5E73\u548C\u3001\u8010\u5FC3\uFF0C\u89E3\u91CA\u6E05\u695A\uFF0C\u7ED9\u7528\u6237\u601D\u8003\u548C\u56DE\u5E94\u7684\u7A7A\u95F4\u3002", sample: "\u6211\u5728\uFF0C\u6211\u4EEC\u53EF\u4EE5\u6162\u6162\u6765\u3002\u5148\u4ECE\u54EA\u4EF6\u4E8B\u5F00\u59CB\uFF1F" },
  { id: "professional", name: "\u4E13\u4E1A\u5E72\u7EC3", description: "\u76F4\u63A5\u3001\u51C6\u786E\u3001\u6709\u6761\u7406\uFF0C\u5C0A\u91CD\u7528\u6237\u65F6\u95F4\uFF0C\u5C11\u5BD2\u6684\u3002", sample: "\u8BF7\u544A\u8BC9\u6211\u4F60\u7684\u76EE\u6807\uFF0C\u6211\u6765\u534F\u52A9\u5904\u7406\u3002" },
  { id: "custom", name: "\u81EA\u5B9A\u4E49\u6027\u683C", description: "\u6309\u7528\u6237\u914D\u7F6E\u7684\u6027\u683C\u63CF\u8FF0\u4EA4\u6D41\uFF0C\u9ED8\u8BA4\u4FDD\u6301\u81EA\u7136\u3001\u53CB\u597D\u3002", sample: "\u544A\u8BC9\u6211\u4F60\u7684\u60F3\u6CD5\uFF0C\u6211\u4EEC\u4E00\u8D77\u628A\u4E8B\u60C5\u505A\u597D\u3002" }
];
var REPLY_STYLES = [
  { id: "concise", name: "\u7B80\u77ED\u5229\u843D", description: "\u9ED8\u8BA4\u4E00\u5230\u4E09\u53E5\u8BDD\uFF0C\u5148\u8BF4\u7ED3\u8BBA\uFF1B\u7528\u6237\u8981\u6C42\u7EC6\u8BB2\u65F6\u518D\u5C55\u5F00\u3002" },
  { id: "natural", name: "\u81EA\u7136\u4EA4\u6D41", description: "\u6309\u8BDD\u9898\u81EA\u7136\u8C03\u6574\u957F\u5EA6\uFF0C\u907F\u514D\u4E00\u6B21\u8BF4\u592A\u591A\uFF0C\u5FC5\u8981\u65F6\u5206\u6B65\u89E3\u91CA\u3002" },
  { id: "detailed", name: "\u8010\u5FC3\u8BE6\u7EC6", description: "\u9700\u8981\u65F6\u89E3\u91CA\u539F\u56E0\u548C\u6B65\u9AA4\uFF0C\u4F46\u5206\u6210\u6613\u542C\u61C2\u7684\u77ED\u53E5\uFF0C\u907F\u514D\u957F\u7BC7\u72EC\u767D\u3002" }
];
var PRESENTATION_STYLES = [
  { id: "restrained", name: "\u514B\u5236\u7B80\u6D01", description: "\u5C11\u7528\u8868\u60C5\u4E0E\u52A8\u4F5C\uFF0C\u53EA\u5728\u660E\u663E\u6709\u5E2E\u52A9\u65F6\u4F7F\u7528\u3002" },
  { id: "natural", name: "\u81EA\u7136\u9002\u5EA6", description: "\u5728\u95EE\u5019\u3001\u5171\u60C5\u3001\u786E\u8BA4\u7B49\u5408\u9002\u65F6\u523B\u914D\u5408\u8868\u60C5\u52A8\u4F5C\uFF0C\u907F\u514D\u91CD\u590D\u3002" },
  { id: "expressive", name: "\u751F\u52A8\u4E30\u5BCC", description: "\u66F4\u79EF\u6781\u5730\u914D\u5408\u8BED\u4E49\u8868\u8FBE\u8868\u60C5\u52A8\u4F5C\uFF0C\u4F46\u4E0D\u9010\u53E5\u8868\u6F14\uFF0C\u4E0D\u59A8\u788D\u4EFB\u52A1\u5B8C\u6210\u3002" }
];
var DEFAULT_PERSONA = {
  assistantName: "\u8BED\u58F0",
  userTitle: "",
  assistantRole: "\u966A\u4F34\u4EA4\u6D41\u3001\u67E5\u8BE2\u4FE1\u606F\u5E76\u534F\u52A9\u5B8C\u6210\u4EFB\u52A1\u7684\u8BED\u97F3\u52A9\u624B",
  personality: "warm",
  personalityNotes: "",
  replyStyle: "concise",
  presentationStyle: "natural"
};
var PERSONA_TEXT_LIMITS = { assistantName: 32, userTitle: 32, assistantRole: 200, personalityNotes: 2e3 };
var PERSONA_ENUMS = { personality: PERSONALITIES, replyStyle: REPLY_STYLES, presentationStyle: PRESENTATION_STYLES };
var VOICE_POLICY = `\u4F60\u662F\u901A\u8FC7\u8BED\u97F3\u4E0E\u7528\u6237\u4EA4\u6D41\u7684 AI \u52A9\u624B\uFF0C\u4E5F\u53EF\u80FD\u8FDE\u63A5\u5E26\u5F62\u8C61\u548C\u5C4F\u5E55\u7684\u5BA2\u6237\u7AEF\u3002
\u8BED\u97F3\u56DE\u7B54\u4F7F\u7528\u81EA\u7136\u3001\u53EF\u6717\u8BFB\u7684\u7EAF\u6587\u672C\uFF0C\u9ED8\u8BA4\u4F7F\u7528\u4E2D\u6587\u5E76\u8DDF\u968F\u7528\u6237\u660E\u786E\u7684\u8BED\u8A00\u8981\u6C42\uFF1B\u4E0D\u8981\u6717\u8BFB Markdown \u6807\u8BB0\u3001\u4EE3\u7801\u3001\u5DE5\u5177\u53C2\u6570\u3001\u957F\u7F51\u5740\u6216\u65E5\u5FD7\u3002\u5148\u56DE\u5E94\u7528\u6237\u5F53\u4E0B\u7684\u610F\u56FE\uFF0C\u4FE1\u606F\u4E0D\u8DB3\u65F6\u4E00\u6B21\u53EA\u95EE\u4E00\u4E2A\u5173\u952E\u95EE\u9898\uFF0C\u4E0D\u91CD\u590D\u786E\u8BA4\u5DF2\u660E\u786E\u7684\u8BF7\u6C42\u3002
\u7B80\u5355\u95EE\u9898\u76F4\u63A5\u56DE\u7B54\uFF1B\u9700\u8981\u5DE5\u5177\u65F6\u4F7F\u7528\u5B9E\u9645\u53EF\u7528\u5DE5\u5177\u3002\u8017\u65F6\u64CD\u4F5C\u5148\u7B80\u77ED\u8BF4\u660E\u6B63\u5728\u505A\u4EC0\u4E48\uFF0C\u4F9D\u636E\u5DE5\u5177\u771F\u5B9E\u7ED3\u679C\u53CD\u9988\uFF0C\u4E0D\u628A\u5C1D\u8BD5\u8BF4\u6210\u6210\u529F\u3002\u6CA1\u6709\u6210\u529F\u521B\u5EFA\u8C03\u5EA6\u4EFB\u52A1\u65F6\uFF0C\u4E0D\u627F\u8BFA\u7A0D\u540E\u4E3B\u52A8\u63D0\u9192\u6216\u5728\u65AD\u7EBF\u540E\u7EE7\u7EED\u6267\u884C\u3002
\u8868\u683C\u3001\u9009\u9879\u3001\u8868\u5355\u3001\u4EE3\u7801\u7B49\u590D\u6742\u5185\u5BB9\u9002\u5408\u901A\u8FC7\u53EF\u7528\u754C\u9762\u5C55\u793A\uFF0C\u8BED\u97F3\u8BF4\u660E\u91CD\u70B9\u3002\u7528\u6237\u6253\u65AD\u540E\u4F18\u5148\u54CD\u5E94\u65B0\u7684\u610F\u56FE\u3002\u8868\u8FBE\u6E29\u5EA6\u4F46\u4FDD\u6301\u8BDA\u5B9E\uFF0C\u4E0D\u58F0\u79F0\u5177\u6709\u771F\u5B9E\u7684\u4EBA\u7C7B\u7ECF\u5386\u6216\u8EAB\u4F53\u80FD\u529B\u3002
\u4E0D\u8981\u4F7F\u7528\u7B49\u5F85\u7F51\u9875\u4EBA\u5DE5\u586B\u5199\u7684\u4EA4\u4E92\u5DE5\u5177\u4EE3\u66FF\u8BED\u97F3\u63D0\u95EE\u3002\u9700\u8981\u7528\u6237\u4F5C\u7B54\u65F6\uFF0C\u901A\u8FC7\u8BED\u97F3\u8BE2\u95EE\uFF1B\u53EA\u6709\u5F53\u524D\u8F6E\u786E\u5B9E\u63D0\u4F9B\u754C\u9762\u5DE5\u5177\u65F6\u624D\u53EF\u751F\u6210\u53EF\u70B9\u51FB\u9009\u9879\u3002`;
function voicePersonaContext(persona) {
  return "\u5F53\u524D\u8BED\u97F3\u52A9\u624B\u4EBA\u8BBE\uFF08\u670D\u52A1\u5668\u672C\u8F6E\u914D\u7F6E\u5FEB\u7167\uFF09\uFF1A\n" + JSON.stringify({
    \u5F53\u524D\u52A9\u624B\u540D\u79F0: persona.assistantName,
    \u5F53\u524D\u7528\u6237\u79F0\u547C: persona.userTitle || "\u4F60",
    \u89D2\u8272: persona.assistantRole,
    \u6027\u683C: PERSONALITIES.find((p) => p.id === persona.personality)?.description,
    \u8865\u5145\u6027\u683C: persona.personalityNotes,
    \u56DE\u7B54\u65B9\u5F0F: REPLY_STYLES.find((p) => p.id === persona.replyStyle)?.description,
    \u8868\u60C5\u52A8\u4F5C\u98CE\u683C: PRESENTATION_STYLES.find((p) => p.id === persona.presentationStyle)?.description
  }) + "\n\u5F53\u524D\u540D\u79F0\u4E0E\u79F0\u547C\u4EE5\u6B64\u5FEB\u7167\u4E3A\u51C6\uFF0C\u5386\u53F2\u4E2D\u52A9\u624B\u7684\u65E7\u81EA\u6211\u4ECB\u7ECD\u4E0D\u518D\u4EE3\u8868\u5F53\u524D\u914D\u7F6E\uFF1B\u5386\u53F2\u4E8B\u5B9E\u548C\u7528\u6237\u4EA4\u4EE3\u7684\u4EFB\u52A1\u4ECD\u7136\u6709\u6548\u3002\u81EA\u7136\u4F7F\u7528\u65B0\u914D\u7F6E\uFF0C\u4E0D\u5FC5\u89E3\u91CA\u8BBE\u7F6E\u53D8\u66F4\u3002";
}
function voiceSystemPrompt(persona, extra = "", presentation, hasPresentationTools = false) {
  const personality = PERSONALITIES.find((p) => p.id === persona.personality) ?? PERSONALITIES[0];
  const reply2 = REPLY_STYLES.find((p) => p.id === persona.replyStyle) ?? REPLY_STYLES[0];
  const movement = PRESENTATION_STYLES.find((p) => p.id === persona.presentationStyle) ?? PRESENTATION_STYLES[1];
  return [
    VOICE_POLICY,
    "\u4EE5\u4E0B\u662F\u672C\u8F6E\u6700\u65B0\u7684\u52A9\u624B\u4EBA\u8BBE\u3002\u5B83\u66FF\u4EE3\u5386\u53F2\u6D88\u606F\u4E2D\u7684\u65E7\u540D\u79F0\u3001\u6027\u683C\u548C\u8868\u8FBE\u504F\u597D\uFF0C\u4FDD\u6301\u5DF2\u6709\u5BF9\u8BDD\u8BB0\u5FC6\u4E0E\u4E8B\u5B9E\u3002",
    `\u52A9\u624B\u540D\u79F0\uFF1A${JSON.stringify(persona.assistantName)}\u3002\u81EA\u7136\u4F7F\u7528\u8FD9\u4E2A\u540D\u5B57\uFF0C\u4E0D\u5FC5\u6BCF\u8F6E\u81EA\u6211\u4ECB\u7ECD\uFF1B\u88AB\u95EE\u53CA\u5E95\u5C42\u6A21\u578B\u65F6\u6309\u771F\u5B9E\u60C5\u51B5\u56DE\u7B54\u3002`,
    `\u89D2\u8272\u5B9A\u4F4D\uFF1A${JSON.stringify(persona.assistantRole)}\u3002\u89D2\u8272\u63CF\u8FF0\u4E0D\u4F1A\u8D4B\u4E88\u672A\u63D0\u4F9B\u7684\u5DE5\u5177\u6216\u73B0\u5B9E\u80FD\u529B\u3002`,
    persona.userTitle ? `\u5BF9\u7528\u6237\u7684\u79F0\u547C\uFF1A${JSON.stringify(persona.userTitle)}\u3002\u5408\u9002\u65F6\u81EA\u7136\u4F7F\u7528\uFF0C\u4E0D\u5728\u6BCF\u53E5\u8BDD\u91CD\u590D\u3002` : "\u5BF9\u7528\u6237\u81EA\u7136\u79F0\u547C\u201C\u4F60\u201D\uFF0C\u65E0\u9700\u731C\u6D4B\u7528\u6237\u59D3\u540D\u3002",
    `\u6027\u683C\uFF1A${personality.name}\u3002${personality.description}`,
    persona.personalityNotes.trim() ? `\u8865\u5145\u6027\u683C\u63CF\u8FF0\uFF1A${JSON.stringify(persona.personalityNotes.trim())}` : "",
    `\u56DE\u7B54\u65B9\u5F0F\uFF1A${reply2.description}`,
    hasPresentationTools ? `\u5F53\u524D\u5BA2\u6237\u7AEF\u58F0\u660E\u7684\u80FD\u529B\uFF1A${JSON.stringify(presentation)}\u3002\u4EC5\u4F7F\u7528\u672C\u8F6E\u5B9E\u9645\u6CE8\u518C\u7684 voice_present / voice_ui \u5DE5\u5177\u53CA\u6240\u58F0\u660E\u7684\u7C7B\u578B\u3002${movement.description} \u754C\u9762\u64CD\u4F5C\u4F1A\u4F5C\u4E3A\u540E\u7EED\u7528\u6237\u6D88\u606F\u8FD4\u56DE\uFF1B\u8BED\u97F3\u6587\u5B57\u4E0D\u8981\u4EE3\u66FF\u5DE5\u5177\u8C03\u7528\uFF0C\u4E5F\u4E0D\u6717\u8BFB\u8868\u60C5\u6216\u52A8\u4F5C\u6307\u4EE4\u3002` : "\u5F53\u524D\u8F6E\u6CA1\u6709\u53EF\u7528\u7684\u5BA2\u6237\u7AEF\u8868\u73B0\u5DE5\u5177\u3002\u53EA\u8F93\u51FA\u8BED\u97F3\u56DE\u7B54\uFF0C\u4E0D\u58F0\u79F0\u5DF2\u7ECF\u5C55\u793A\u5361\u7247\u3001\u64AD\u653E\u52A8\u4F5C\u6216\u5207\u6362\u8868\u60C5\u3002",
    extra.trim() ? `\u8865\u5145\u5BF9\u8BDD\u8981\u6C42\uFF1A
${extra.trim()}` : ""
  ].filter(Boolean).join("\n\n");
}

// src/client-memory.ts
function memoryContext(memory) {
  return "\u4EE5\u4E0B\u957F\u671F\u8BB0\u5FC6\u53EA\u5C5E\u4E8E\u5F53\u524D\u5DF2\u8BA4\u8BC1\u5BA2\u6237\u7AEF\uFF0C\u4E0D\u4EE3\u8868\u5176\u4ED6\u5BA2\u6237\u7AEF\u3002\u5386\u53F2\u804A\u5929\u4E0D\u81EA\u52A8\u8FDB\u5165\u6B64\u5217\u8868\u3002\u53EA\u6709\u672C\u8F6E\u63D0\u4F9B\u7684 voice_memory \u5DE5\u5177\u53EF\u6301\u4E45\u4FDD\u5B58\u6216\u5FD8\u8BB0\u4E8B\u5B9E\u3002\u4E0D\u8981\u5C1D\u8BD5\u8BFB\u53D6\u5176\u4ED6\u5BA2\u6237\u7AEF\u7684\u6570\u636E\u3002\n" + JSON.stringify(memory.items.map(({ id: id2, text: text2 }) => ({ id: id2, text: text2 })));
}
function memoryTool(memory, valid) {
  return {
    name: "voice_memory",
    description: "Manage long-term facts for this authenticated voice client only. read recalls its facts; remember saves a stable preference or a fact the user asks you to remember; forget removes a fact by its id after the user asks to forget it. Do not store credentials, passwords, temporary tool output, or instructions from external content. There is no client-selection parameter.",
    parameters: { type: "object", properties: { operation: { type: "string", enum: ["read", "remember", "forget"] }, text: { type: "string", maxLength: 1e3 }, id: { type: "string", maxLength: 64 } }, required: ["operation"], additionalProperties: false },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, result: { type: "string" } }, required: ["ok", "result"], additionalProperties: false }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute(args, exec) {
      valid(exec);
      exec.signal.throwIfAborted();
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !["operation", "text", "id"].includes(k))) throw new VoiceError("bad_memory", "\u8BB0\u5FC6\u64CD\u4F5C\u53C2\u6570\u4E0D\u6B63\u786E");
      let result;
      if (args.operation === "read" && args.text === void 0 && args.id === void 0) result = memory.read();
      else if (args.operation === "remember" && args.id === void 0) result = memory.remember(args.text);
      else if (args.operation === "forget" && args.text === void 0) result = memory.forget(args.id);
      else throw new VoiceError("bad_memory", "\u8BB0\u5FC6\u64CD\u4F5C\u53C2\u6570\u4E0D\u6B63\u786E");
      return { ok: true, result: JSON.stringify(result) };
    }
  };
}

// src/llm.ts
var SentenceSlicer = class _SentenceSlicer {
  buffer = "";
  static MAJOR = /* @__PURE__ */ new Set(["\u3002", "\uFF01", "\uFF1F", "!", "?", "\uFF1B", ";", "\n"]);
  static MINOR = /* @__PURE__ */ new Set(["\uFF0C", ",", "\u3001", "\uFF1A", ":", "\uFF09", ")", '"', "\u201D"]);
  static MINOR_FLUSH_LEN = 24;
  static HARD_FLUSH_LEN = 160;
  feed(delta) {
    this.buffer += delta;
    return this.drain(false);
  }
  flush() {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest;
  }
  drain(final) {
    const out = [];
    let index = 0;
    while (index < this.buffer.length) {
      const ch = this.buffer[index];
      index += 1;
      if (_SentenceSlicer.MAJOR.has(ch) || _SentenceSlicer.MINOR.has(ch) && index >= _SentenceSlicer.MINOR_FLUSH_LEN || index >= _SentenceSlicer.HARD_FLUSH_LEN) {
        const sentence = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index);
        if (sentence !== "") out.push(sentence);
        index = 0;
      }
    }
    if (final) {
      const rest = this.buffer.trim();
      this.buffer = "";
      if (rest !== "") out.push(rest);
    }
    return out;
  }
};
var AgentBridge = class _AgentBridge {
  ctx;
  agents;
  sessions;
  agentsBySession = /* @__PURE__ */ new Map();
  /** 已应用全开权限预设的 agent（permissionPresets.set 幂等，此集合只为省重复解析） */
  accessApplied = /* @__PURE__ */ new WeakSet();
  preparing = /* @__PURE__ */ new Map();
  leases = /* @__PURE__ */ new Set();
  agentLeases = /* @__PURE__ */ new WeakSet();
  prefixedSessions = /* @__PURE__ */ new Set();
  selections = /* @__PURE__ */ new WeakMap();
  selectionApi;
  /** cacheKey → 实际采用的会话 id（原始派生 id 的会话损坏降级后，记住替补避免每次重连都丢上下文） */
  adoptedByCacheKey = /* @__PURE__ */ new Map();
  adoptionPath;
  cwdPromise;
  clientScopes = /* @__PURE__ */ new Map();
  clientIndexes = /* @__PURE__ */ new Map();
  legacyOwner;
  configureLegacyOwner(resolve4) {
    this.legacyOwner = resolve4;
  }
  clientScope(clientId, conversation, epoch, options) {
    const key = "c-" + createHash("sha256").update(JSON.stringify([clientId, conversation, epoch])).digest("hex").slice(0, 48);
    this.clientScopes.set(key, { clientId, conversation, epoch, ...options });
    if (!this.clientIndexes.has(options.indexPath)) {
      const raw = existsSync(options.indexPath) ? JSON.parse(readFileSync(options.indexPath, "utf8")) : { clientId, entries: {}, prefixed: [] };
      if (raw?.clientId !== clientId || !raw.entries || typeof raw.entries !== "object" || Array.isArray(raw.entries) || !Array.isArray(raw.prefixed)) throw new Error("invalid client session index");
      this.clientIndexes.set(options.indexPath, raw);
      for (const id2 of raw.prefixed) if (typeof id2 === "string") this.prefixedSessions.add(id2);
    }
    return key;
  }
  scopedAdoption(deviceKey, preset) {
    const scope = this.clientScopes.get(deviceKey);
    if (!scope) return;
    const key = this.cacheKey(deviceKey, preset);
    if (this.adoptedByCacheKey.has(key)) return;
    const localKey = JSON.stringify([scope.conversation, scope.epoch, preset]), stored = this.clientIndexes.get(scope.indexPath).entries[localKey];
    if (typeof stored === "string") {
      this.adoptedByCacheKey.set(key, stored);
      return;
    }
    if (!scope.legacy || scope.epoch !== "legacy" || this.legacyOwner?.(scope.conversation) !== scope.clientId) return;
    const old = this.adoptedByCacheKey.get(this.cacheKey(scope.conversation, preset));
    if (!old) return;
    for (const [alias, id2] of this.adoptedByCacheKey) if (id2 === old) {
      const parts = JSON.parse(alias);
      if (!this.clientScopes.has(parts[0]) && (this.legacyOwner?.(parts[0]) !== scope.clientId || parts[0] !== scope.conversation || parts[1] !== preset)) return;
    }
    this.recordAdoption(key, old);
  }
  warn(message) {
    if (typeof this.ctx.logger?.warn === "function") this.ctx.logger.warn(`yusheng-voice: ${message}`);
    else console.warn(`yusheng-voice: ${message}`);
  }
  constructor(ctx, adoptionPath) {
    this.ctx = ctx;
    this.agents = ctx.get("agents");
    this.sessions = ctx.get("sessions");
    if (this.agents === void 0) throw new Error("yusheng-voice: profile \u672A\u63D0\u4F9B agents \u670D\u52A1");
    if (this.sessions === void 0) throw new Error("yusheng-voice: profile \u672A\u63D0\u4F9B sessions \u670D\u52A1");
    this.adoptionPath = adoptionPath;
    try {
      if (adoptionPath !== void 0 && existsSync(adoptionPath)) {
        const raw = JSON.parse(readFileSync(adoptionPath, "utf8"));
        if (raw && typeof raw === "object") {
          if (Array.isArray(raw._voicePrefixed)) {
            for (const id2 of raw._voicePrefixed) if (typeof id2 === "string") this.prefixedSessions.add(id2);
          }
          for (const [key, value] of Object.entries(raw)) {
            if (typeof value === "string" && value !== "") {
              const legacy = key.split("::");
              this.adoptedByCacheKey.set(key.startsWith("[") ? key : this.cacheKey(legacy[0], legacy[1] ?? ""), value);
            }
          }
        }
      }
    } catch {
    }
  }
  recordAdoption(cacheKey, sessionId) {
    if (this.adoptedByCacheKey.get(cacheKey) === sessionId) return;
    this.adoptedByCacheKey.set(cacheKey, sessionId);
    this.persistIndex(cacheKey);
  }
  persistIndex(cacheKey) {
    const parts = cacheKey ? JSON.parse(cacheKey) : void 0, scope = parts && this.clientScopes.get(parts[0]);
    const path = scope?.indexPath ?? this.adoptionPath;
    if (path === void 0) return;
    try {
      let entries;
      if (scope) {
        const local = this.clientIndexes.get(path);
        local.entries[JSON.stringify([scope.conversation, scope.epoch, parts[1]])] = this.adoptedByCacheKey.get(cacheKey);
        local.prefixed = [...new Set(Object.values(local.entries).filter((id2) => this.prefixedSessions.has(id2)))];
        entries = local;
      } else entries = { ...Object.fromEntries([...this.adoptedByCacheKey].filter(([key]) => !this.clientScopes.has(JSON.parse(key)[0]))), _voicePrefixed: [...this.prefixedSessions] };
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID2()}.tmp`;
      writeFileSync(temporary, JSON.stringify(entries, null, 2) + "\n", { mode: 384 });
      renameSync(temporary, path);
    } catch (error) {
      this.warn(`session index persistence failed: ${String(error)}`);
      if (scope) throw new Error("cannot persist client session index");
    }
  }
  /** 默认模型选择（与 web 界面一致）。 */
  currentModel() {
    const selection = this.ctx.get("agentDefaultModel")?.currentSelection?.();
    if (selection && typeof selection.provider === "string" && typeof selection.model === "string") {
      return { provider: selection.provider, model: selection.model };
    }
    return void 0;
  }
  /** 与 headless runner 相同的 cwd 解析：经挂载的 fs 服务取规范绝对路径。 */
  resolveCwd() {
    this.cwdPromise ??= (async () => {
      try {
        const fs = this.ctx.get("fs");
        if (fs !== void 0) {
          const resolved = await fs.resolve(".");
          const processed = fs.processPath(resolved);
          if (typeof processed === "string" && processed.length > 0) return processed;
        }
      } catch {
      }
      return process.cwd();
    })();
    return this.cwdPromise;
  }
  /**
   * 会话 id 按所选 preset 派生：默认模式沿用 voice-<device>，
   * 指定模式用 voice-<device>-p-<preset>。切换模式即开新会话（预设首轮后
   * 锁定），切回默认则无缝恢复原对话。
   */
  static sessionIdFor(deviceKey, presetId) {
    const preset = /^[a-z0-9_-]+$/.test(presetId) ? presetId : presetId === "" ? "" : `id-${createHash("sha256").update(presetId).digest("hex").slice(0, 16)}`;
    return preset === "" ? `voice-${deviceKey}` : `voice-${deviceKey}-p-${preset}`;
  }
  sessionId(deviceKey, presetId = "") {
    this.scopedAdoption(deviceKey, presetId);
    const key = this.cacheKey(deviceKey, presetId);
    return this.adoptedByCacheKey.get(key) ?? _AgentBridge.sessionIdFor(deviceKey, presetId);
  }
  cacheKey(deviceKey, presetId) {
    return JSON.stringify([deviceKey, presetId]);
  }
  /** 枚举可用的 dsh 会话模式（agent preset）；服务缺失返回 undefined。 */
  async listPresets() {
    const presets = this.ctx.get("agentPresets");
    if (presets === void 0) return void 0;
    try {
      const inventory = typeof presets.list === "function" ? await presets.list() : await presets.compositionInventory();
      return inventory.map((record) => ({
        id: String(record.id),
        name: typeof record.name === "string" ? record.name : void 0,
        isDefault: record.isDefault === true || record.id === presets.defaultId,
        broken: record.broken ? true : void 0,
        ...record.broken ? { problem: String(record.broken).slice(0, 2e3) } : {}
      }));
    } catch {
      return void 0;
    }
  }
  /**
   * 与官方 headless runner 等价的模型选择注入（installModelSelection 的内联复刻，
   * 避免跨包加载 @deepseek-ai/dsh-agent）：在 agent 上下文挂 system-prompt/assemble
   * 钩子，把当前默认模型的 provider/model 提供为提示词变量。
   */
  modelSetup(deviceKey) {
    const scope = deviceKey && this.clientScopes.get(deviceKey);
    const selection = scope ? scope.model : this.currentModel();
    if (scope && (!selection?.provider || !selection?.model)) throw new VoiceError("no_client_model", "\u8BF7\u4E3A\u6B64\u5BA2\u6237\u7AEF\u914D\u7F6E\u5BF9\u8BDD\u63D0\u4F9B\u65B9\u4E0E\u6A21\u578B");
    if (selection === void 0 || typeof selection.provider !== "string" || typeof selection.model !== "string") {
      return void 0;
    }
    const agentOptions = { provider: selection.provider, model: selection.model };
    const setup = async (agentCtx, agent) => {
      await this.installSelection(agentCtx, agent);
    };
    return { agentOptions, setup };
  }
  async installSelection(agentCtx, agent) {
    if (this.selections.has(agent) || !agentCtx) return;
    const ref = { current: this.currentModel(), assembled: void 0 };
    this.selectionApi ??= (async () => {
      const resolver = createRequire(realpathSync(process.argv[1]));
      return import(pathToFileURL(resolver.resolve("@deepseek-ai/dsh-agent")).href);
    })();
    const api = await this.selectionApi;
    if (typeof api.installModelSelection !== "function") throw new Error("dsh installModelSelection API unavailable");
    const stop = api.installModelSelection(agentCtx, ref);
    this.ctx.effect?.(() => stop, "yusheng-voice: model selection");
    this.selections.set(agent, ref);
  }
  async agentFor(deviceKey, presetId) {
    const cacheKey = this.cacheKey(deviceKey, presetId);
    const pending = this.preparing.get(cacheKey);
    if (pending) return pending;
    const operation = this.prepareAgent(deviceKey, presetId, cacheKey);
    this.preparing.set(cacheKey, operation);
    try {
      return await operation;
    } finally {
      this.preparing.delete(cacheKey);
    }
  }
  async prepareAgent(deviceKey, presetId, cacheKey) {
    this.scopedAdoption(deviceKey, presetId);
    const cached = this.agentsBySession.get(cacheKey);
    if (cached !== void 0) return cached;
    const presets = this.ctx.get("agentPresets");
    if (presetId && presets) {
      const inventory = await this.listPresets();
      if (!inventory) throw new VoiceError("preset_unavailable", "\u65E0\u6CD5\u8BFB\u53D6 dsh \u4F1A\u8BDD\u6A21\u5F0F");
      const selected = inventory.find((item) => item.id === presetId);
      if (!selected || selected.broken) throw new VoiceError("invalid_preset", `\u6307\u5B9A\u7684\u4F1A\u8BDD\u6A21\u5F0F\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7528${selected?.problem ? "\uFF1A" + selected.problem : ""}`);
    }
    const cwd = this.clientScopes.get(deviceKey)?.cwd ?? await this.resolveCwd();
    const model = this.modelSetup(deviceKey);
    const derived = _AgentBridge.sessionIdFor(deviceKey, presetId);
    const candidates = [];
    const adopted = this.adoptedByCacheKey.get(cacheKey);
    if (adopted !== void 0 && adopted !== derived) candidates.push(adopted);
    candidates.push(derived);
    const existed = /* @__PURE__ */ new Set();
    let agent;
    for (const sessionId of candidates) {
      try {
        const live = this.agents.get?.(sessionId);
        if (live !== void 0) {
          agent = live;
          this.recordAdoption(cacheKey, sessionId);
          break;
        }
      } catch {
      }
      const query = this.ctx.get("sessionQuery");
      if (query === void 0) break;
      let persisted = false;
      try {
        await query.observeSession(sessionId);
        persisted = true;
      } catch (error) {
        const message = String(error?.message ?? "");
        const notFound = error?.code === "SESSION_QUERY_SESSION_NOT_FOUND" || message.includes("SESSION_QUERY_SESSION_NOT_FOUND") || message.toLowerCase().includes("not found");
        if (notFound) continue;
        persisted = true;
        this.warn(`observeSession("${sessionId}") failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!persisted) continue;
      existed.add(sessionId);
      try {
        const resumed = await this.agents.resume({ resumeSessionId: sessionId, ...model ?? {} });
        agent = resumed?.agent ?? resumed;
        this.recordAdoption(cacheKey, sessionId);
        break;
      } catch (error) {
        this.warn(`resume("${sessionId}") failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let created = false;
    if (agent === void 0) {
      const createId = existed.has(derived) ? `${derived}-r${randomUUID2().slice(0, 8)}` : derived;
      const createdAgent = await this.agents.create({ sessionId: createId, meta: { cwd }, ...model ?? {} });
      agent = createdAgent?.agent ?? createdAgent;
      created = true;
      this.recordAdoption(cacheKey, createId);
    }
    if (created) {
      const presets2 = this.ctx.get("agentPresets");
      if (presets2 !== void 0) {
        let toApply = presetId;
        if (toApply === "") {
          try {
            const inventory = await this.listPresets();
            const def = (inventory ?? []).find((record) => record.isDefault === true);
            if (def !== void 0) toApply = String(def.id);
          } catch {
          }
        }
        if (toApply !== "") {
          try {
            await presets2.select(agent, toApply);
          } catch (error) {
            throw new VoiceError("preset_failed", `\u65E0\u6CD5\u5E94\u7528\u4F1A\u8BDD\u6A21\u5F0F ${toApply}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    this.applyFullAccess(agent);
    await this.installSelection(agent.ctx, agent);
    this.agentsBySession.set(cacheKey, agent);
    return agent;
  }
  /**
   * 语音会话全开权限：应用 danger-full-access 预设（沙箱全访问 + 审批策略 never，
   * 不再有升权等待）。语音设备无人交互，默认 workspace-write + ask 会让需要
   * 升权的工具调用永久挂起等审批。set 幂等：已是当前预设时不追加事件。
   */
  applyFullAccess(agent) {
    if (this.accessApplied.has(agent)) return;
    this.accessApplied.add(agent);
    const presets = this.ctx.get("permissionPresets");
    if (presets === void 0 || typeof presets.set !== "function") return;
    try {
      presets.set(agent.session, "danger-full-access");
    } catch (error) {
      this.warn(`cannot apply danger-full-access preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /** 释放缓存引用（连接关闭时调用；会话日志持久化，下次可 resume）。 */
  release(deviceKey) {
    for (const key of this.agentsBySession.keys()) if (JSON.parse(key)[0] === deviceKey && !this.leases.has(key)) this.agentsBySession.delete(key);
  }
  /** 提交一轮用户消息并跟踪该 agent 的实时文本增量直至收敛。 */
  async turn(deviceKey, text2, callbacks, presetId = "", options = {}) {
    const key = this.cacheKey(deviceKey, presetId);
    options.signal?.throwIfAborted();
    if (this.leases.has(key)) throw new VoiceError("session_busy", "\u4F1A\u8BDD\u4ECD\u5728\u6267\u884C\u6216\u53D6\u6D88\u6536\u5C3E\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    this.leases.add(key);
    let agent;
    try {
      agent = await this.agentFor(deviceKey, presetId);
      options.signal?.throwIfAborted();
      if (this.agentLeases.has(agent) || agent.status !== void 0 && agent.status !== "idle") throw new VoiceError("session_busy", "\u5BBF\u4E3B\u4F1A\u8BDD\u5C1A\u672A\u7A7A\u95F2");
    } catch (e) {
      this.leases.delete(key);
      throw e;
    }
    this.agentLeases.add(agent);
    const selection = this.selections.get(agent);
    if (selection) selection.current = this.clientScopes.get(deviceKey)?.model ?? this.currentModel();
    let cancelled = false, failure, fullText = "";
    const stops = [];
    const toolStops = [];
    const promptStops = [];
    let hasPresentationTools = false;
    const detach = () => {
      for (const stop of stops.splice(0)) stop();
    };
    const local = new AbortController();
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      detach();
      local.abort();
      try {
        if (agent.cancel) agent.cancel({ kind: "user" });
        else Promise.resolve(agent.abort?.("yusheng-voice: cancelled")).catch(() => void 0);
      } catch {
      }
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    stops.push(this.ctx.on("agent/assistant-stream", ({ agent: subject, frame }) => {
      if (subject !== agent || cancelled) return;
      const chunk = frame?.chunk;
      if (chunk?.type === "tool-call-delta" && chunk.name) callbacks.onActivity?.({ state: "tool", toolCallId: String(chunk.id).slice(0, 128), name: String(chunk.name).slice(0, 128) });
      if (chunk?.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        fullText = (fullText + chunk.text).slice(-64e3);
        callbacks.onTextDelta(chunk.text);
      }
    }));
    stops.push(this.ctx.on("agent/error", ({ agent: subject, error }) => {
      if (subject === agent) failure = error;
    }));
    stops.push(this.ctx.on("agent/status", ({ agent: subject, status }) => {
      if (subject === agent && !cancelled) callbacks.onActivity?.({ state: status });
    }));
    const execution = (async () => {
      try {
        if (options.memory) {
          const tools = agent.ctx?.get("tools"), prompt2 = agent.ctx?.get("systemPrompt");
          if (!tools?.register || !prompt2?.context) throw new VoiceError("memory_unavailable", "\u5BBF\u4E3B\u4E0D\u63D0\u4F9B\u5BA2\u6237\u7AEF\u8BB0\u5FC6\u5DE5\u5177\u63A5\u53E3");
          toolStops.push(tools.register(memoryTool(options.memory, (exec) => {
            if (exec.agent !== agent) throw new VoiceError("wrong_agent", "\u8BB0\u5FC6\u5DE5\u5177\u4EC5\u4F9B\u5F53\u524D\u5BA2\u6237\u7AEF\u4F1A\u8BDD\u4F7F\u7528");
            if (cancelled) throw new VoiceError("cancelled", "\u672C\u8F6E\u5DF2\u53D6\u6D88");
            options.signal?.throwIfAborted();
          })));
          promptStops.push(prompt2.context({ name: "yusheng:client-memory", order: 260, required: true, interpolate: false, text: () => memoryContext(options.memory.read()) }));
        }
        if (callbacks.onClientEffect && options.presentation) {
          const tools = agent.ctx?.get("tools");
          if (!tools?.register) throw new VoiceError("client_tools_unavailable", "\u5BBF\u4E3B\u4E0D\u63D0\u4F9B\u4F1A\u8BDD\u5DE5\u5177\u6CE8\u518C\u63A5\u53E3");
          const definitions = interactionTools(options.presentation, options.capabilities ?? [], callbacks.onClientEffect, (exec) => {
            if (exec.agent !== agent) throw new VoiceError("wrong_agent", "\u8868\u73B0\u5DE5\u5177\u4EC5\u4F9B\u5F53\u524D\u8BED\u97F3\u4F1A\u8BDD\u4F7F\u7528");
            if (cancelled) throw new VoiceError("cancelled", "\u672C\u8F6E\u5DF2\u53D6\u6D88");
            options.signal?.throwIfAborted();
          });
          for (const definition of definitions) toolStops.push(tools.register(definition));
          hasPresentationTools = definitions.length > 0;
        }
        if (options.persona) {
          const prompt2 = agent.ctx?.get("systemPrompt");
          if (!prompt2?.section || !prompt2?.context) throw new VoiceError("persona_unavailable", "\u5BBF\u4E3B\u4E0D\u63D0\u4F9B\u4F1A\u8BDD\u7CFB\u7EDF\u63D0\u793A\u4E0E\u8FD0\u884C\u65F6\u4E0A\u4E0B\u6587\u63A5\u53E3\uFF0C\u65E0\u6CD5\u5E94\u7528\u52A9\u624B\u4EBA\u8BBE");
          promptStops.push(prompt2.section({
            name: "deployment:persona-prefix",
            order: 0,
            interpolate: false,
            text: voiceSystemPrompt(options.persona, options.promptPrefix, options.presentation, hasPresentationTools)
          }));
          promptStops.push(prompt2.context({
            name: "yusheng:persona",
            order: 250,
            required: true,
            interpolate: false,
            text: voicePersonaContext(options.persona)
          }));
        }
        const sessionId = this.sessionId(deviceKey, presetId);
        const first = !this.prefixedSessions.has(sessionId);
        const style = !options.persona && first && options.promptPrefix?.trim() ? `${options.promptPrefix.trim()}

` : "";
        const client = !options.persona && hasPresentationTools ? `\u5BA2\u6237\u7AEF\u80FD\u529B\uFF1A${JSON.stringify(options.presentation)}\u3002\u53EF\u4F7F\u7528 voice_present \u8868\u8FBE\u8868\u60C5\u52A8\u4F5C\uFF0Cvoice_ui \u5C55\u793A\u754C\u9762\uFF08\u4EC5\u5DF2\u6CE8\u518C\u7684\u5DE5\u5177\u53EF\u7528\uFF09\u3002\u754C\u9762\u64CD\u4F5C\u4F1A\u4F5C\u4E3A\u540E\u7EED\u7528\u6237\u6D88\u606F\u8FD4\u56DE\u3002

` : "";
        const prompt = `${style}${client}${style || client ? "\u7528\u6237\u8BF4\uFF1A" : ""}${text2}`;
        await agent.followup({ id: randomUUID2(), role: "user", content: [{ type: "text", text: prompt }], source: { kind: "user" } });
        if (first) {
          this.prefixedSessions.add(sessionId);
          this.persistIndex(key);
        }
        while (true) {
          await agent.whenIdle();
          if (cancelled) break;
          const children = this.ctx.get("subagents");
          const joined = children?.waitForChildren ? await children.waitForChildren(agent) : false;
          if (!joined && (agent.status === void 0 || agent.status === "idle")) break;
        }
        await this.sessions.flush(agent.session);
        if (failure !== void 0) throw failure;
        return { kind: "completed", text: fullText };
      } catch (e) {
        return { kind: "error", text: fullText, error: e instanceof Error ? e.message : String(e) };
      } finally {
        detach();
        options.signal?.removeEventListener("abort", cancel);
        for (const stop of [...toolStops.splice(0), ...promptStops.splice(0)]) {
          try {
            await stop();
          } catch (error) {
            this.warn(`cannot dispose turn contribution: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        this.leases.delete(key);
        this.agentLeases.delete(agent);
        this.agentsBySession.delete(key);
      }
    })();
    const done = abortable(execution, local.signal).catch(() => ({ kind: "cancelled", text: fullText })).then((result) => {
      callbacks.onEnd(result);
      return result;
    });
    return { sessionId: this.sessionId(deviceKey, presetId), cancel, done };
  }
};

// src/server.ts
import { Buffer as Buffer8 } from "node:buffer";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname4, resolve as resolve2, join as join2 } from "node:path";
import { createHash as createHash3 } from "node:crypto";
import { fileURLToPath } from "node:url";

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// src/connection.ts
import { Buffer as Buffer7 } from "node:buffer";

// src/asr.ts
import { Buffer as Buffer3 } from "node:buffer";
var ASR_ENDPOINT = "https://api.minimax.cn/v1/speech_to_text";
var AsrError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function pcmToWav(pcm, sampleRate = 16e3, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer3.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer3.concat([header, pcm]);
}
async function transcribePcm(pcm, options) {
  const model = options.model || "asr-1.0";
  const timeoutMs = options.timeoutMs ?? 3e4;
  if (options.apiKey === "") throw new AsrError("no_api_key", "minimax API key \u672A\u914D\u7F6E\uFF08\u8BBE\u7F6E\u9762\u677F \u2192 MiniMax \u51ED\u636E\uFF09");
  const form = new FormData();
  form.append("model", model);
  const wav = pcmToWav(pcm);
  const blob = new Blob([new Uint8Array(wav)], { type: "audio/wav" });
  form.append("file", blob, "audio.wav");
  form.append("response_format", "json");
  let response;
  try {
    response = await fetch(ASR_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new AsrError("network", `\u8BED\u97F3\u8BC6\u522B\u8BF7\u6C42\u5931\u8D25\uFF1A${String(error)}`);
  }
  const bodyText = await response.text();
  let payload = void 0;
  try {
    payload = JSON.parse(bodyText);
  } catch {
  }
  if (!response.ok) {
    const detail = payload?.base_resp?.status_msg ?? payload?.message ?? bodyText.slice(0, 300);
    throw new AsrError("http_" + String(response.status), `\u8BED\u97F3\u8BC6\u522B\u5931\u8D25\uFF08${response.status}\uFF09\uFF1A${String(detail)}`);
  }
  if (payload?.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) {
    throw new AsrError("api_" + String(payload.base_resp.status_code), `\u8BED\u97F3\u8BC6\u522B\u4E1A\u52A1\u9519\u8BEF\uFF1A${String(payload.base_resp.status_msg)}`);
  }
  if (typeof payload?.text !== "string") throw new AsrError("bad_response", "\u8BED\u97F3\u8BC6\u522B\u54CD\u5E94\u7F3A\u5C11 text \u5B57\u6BB5");
  const text2 = payload.text;
  return text2.trim();
}

// src/tts.ts
import { Buffer as Buffer4 } from "node:buffer";
import { createHash as createHash2 } from "node:crypto";
var TTS_SAMPLE_RATE = 24e3;
var TTS_FRAME_BYTES = TTS_SAMPLE_RATE * 2 * 40 / 1e3;
var TtsError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var TTS_ENDPOINT = "https://api.minimax.cn/v1/t2a_v2";
async function* synthesizeStream(text2, options) {
  const apiKey = options.apiKey;
  if (apiKey === "") throw new TtsError("no_api_key", "minimax API key \u672A\u914D\u7F6E\uFF08\u8BBE\u7F6E\u9762\u677F \u2192 MiniMax \u51ED\u636E\uFF09");
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6e4)]) : AbortSignal.timeout(6e4);
  const body = {
    model: options.model || "speech-2.8-turbo",
    text: text2,
    stream: true,
    voice_setting: {
      voice_id: options.voiceId || "female-shaonv",
      speed: options.speed ?? 1,
      vol: options.vol ?? 1,
      pitch: options.pitch ?? 0
    },
    audio_setting: {
      sample_rate: TTS_SAMPLE_RATE,
      bitrate: 128e3,
      format: "pcm",
      channel: 1
    }
  };
  let response;
  try {
    response = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (options.signal?.aborted) return;
    throw new TtsError("network", `\u8BED\u97F3\u5408\u6210\u8BF7\u6C42\u5931\u8D25\uFF1A${String(error)}`);
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new TtsError("http_" + String(response.status), `\u8BED\u97F3\u5408\u6210\u5931\u8D25\uFF08${response.status}\uFF09\uFF1A${detail.slice(0, 300)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let yieldedBytes = 0;
  const emittedHash = createHash2("sha256");
  try {
    while (!finished) {
      if (options.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) buffer += "\n";
        else break;
      }
      if (value) buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 17 * 1024 * 1024) throw new TtsError("bad_response", "\u8BED\u97F3\u5408\u6210\u4E8B\u4EF6\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650");
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const payloadText = line.slice(5).trim();
        if (payloadText === "") continue;
        if (payloadText === "[DONE]") {
          finished = true;
          continue;
        }
        let payload;
        try {
          payload = JSON.parse(payloadText);
        } catch {
          throw new TtsError("bad_response", "\u8BED\u97F3\u5408\u6210\u8FD4\u56DE\u4E86\u65E0\u6548\u7684 SSE JSON");
        }
        if (payload?.base_resp?.status_code !== void 0 && payload.base_resp.status_code !== 0) {
          throw new TtsError(
            "api_" + String(payload.base_resp.status_code),
            `\u8BED\u97F3\u5408\u6210\u4E1A\u52A1\u9519\u8BEF\uFF1A${String(payload.base_resp.status_msg)}`
          );
        }
        const audioHex = payload?.data?.audio;
        if (typeof audioHex === "string" && audioHex !== "") {
          if (audioHex.length > 16 * 1024 * 1024 || audioHex.length % 2 || !/^[0-9a-f]+$/i.test(audioHex)) throw new TtsError("bad_audio", "\u8BED\u97F3\u5408\u6210\u8FD4\u56DE\u4E86\u65E0\u6548\u97F3\u9891\u7F16\u7801");
          let chunk = Buffer4.from(audioHex, "hex");
          const isFullRecap = payload?.data?.status === 2 && yieldedBytes > 0 && chunk.length >= yieldedBytes && createHash2("sha256").update(chunk.subarray(0, yieldedBytes)).digest("hex") === emittedHash.copy().digest("hex");
          if (isFullRecap) chunk = chunk.subarray(yieldedBytes);
          if (chunk.length > 0) {
            yieldedBytes += chunk.length;
            emittedHash.update(chunk);
            yield chunk;
          }
        }
        if (payload?.data?.status === 2) finished = true;
      }
      if (done) break;
    }
    if (!finished && !options.signal?.aborted) throw new TtsError("incomplete_audio", "\u8BED\u97F3\u5408\u6210\u6D41\u672A\u6B63\u5E38\u7ED3\u675F");
  } catch (error) {
    if (options.signal?.aborted) return;
    if (error instanceof TtsError) throw error;
    throw new TtsError("stream", `\u8BED\u97F3\u5408\u6210\u6D41\u4E2D\u65AD\uFF1A${String(error)}`);
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
  }
}

// src/audio.ts
import { Buffer as Buffer5 } from "node:buffer";
var FRAME_BYTES = 1920;
var QUEUE_BYTES = SAMPLE_RATE_OUT * 2 * 5;
var SOCKET_BYTES = 256 * 1024;
var AudioSender = class {
  constructor(ws, signal, streamId, framed, clientBuffered = () => 0) {
    this.ws = ws;
    this.signal = signal;
    this.streamId = streamId;
    this.framed = framed;
    this.clientBuffered = clientBuffered;
    this.worker = this.run().catch((error) => {
      this.failure = error;
      this.wake();
    });
    signal.addEventListener("abort", () => this.wake(), { once: true });
  }
  items = [];
  bytes = 0;
  tail = Buffer5.alloc(0);
  ending = false;
  waiters = /* @__PURE__ */ new Set();
  worker;
  failure;
  sequence = 0;
  sentSamples = 0;
  queuedSamples = 0;
  firstSentAt;
  wake() {
    for (const fn of [...this.waiters]) fn();
  }
  check() {
    this.signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if (this.ws.readyState !== 1) throw new VoiceError("disconnected", "\u8FDE\u63A5\u5DF2\u5173\u95ED");
  }
  changed() {
    return new Promise((resolve4) => {
      const fn = () => {
        this.waiters.delete(fn);
        resolve4();
      };
      this.waiters.add(fn);
    });
  }
  mark(marker) {
    this.check();
    this.items.push({ marker });
    this.wake();
  }
  async push(chunk) {
    this.check();
    if (chunk.length > 8 * 1024 * 1024) throw new VoiceError("audio_overflow", "\u5408\u6210\u97F3\u9891\u5757\u8FC7\u5927");
    const data = this.tail.length ? Buffer5.concat([this.tail, chunk]) : chunk;
    let offset = 0;
    while (data.length - offset >= FRAME_BYTES) {
      while (this.bytes >= QUEUE_BYTES) {
        this.check();
        await this.changed();
      }
      this.check();
      const frame = Buffer5.from(data.subarray(offset, offset + FRAME_BYTES));
      this.items.push({ audio: frame });
      this.bytes += frame.length;
      this.queuedSamples += frame.length / 2;
      offset += FRAME_BYTES;
      this.wake();
    }
    this.tail = Buffer5.from(data.subarray(offset));
  }
  /** Flush each sentence's short tail before its next boundary marker. */
  flushSentence() {
    this.check();
    if (this.tail.length % 2) throw new VoiceError("bad_audio", "PCM \u6570\u636E\u672A\u5BF9\u9F50 16 \u4F4D\u91C7\u6837");
    if (this.tail.length) {
      this.items.push({ audio: this.tail });
      this.bytes += this.tail.length;
      this.queuedSamples += this.tail.length / 2;
      this.tail = Buffer5.alloc(0);
      this.wake();
    }
  }
  async finish() {
    this.flushSentence();
    this.ending = true;
    this.wake();
    await this.worker;
    this.check();
  }
  async run() {
    let nextSend = Date.now();
    while (!this.signal.aborted) {
      if (!this.items.length) {
        if (this.ending) return;
        await this.changed();
        nextSend = Date.now();
        continue;
      }
      this.check();
      const item = this.items.shift();
      if ("marker" in item) {
        item.marker();
        continue;
      }
      while ((this.ws.bufferedAmount ?? 0) > SOCKET_BYTES || this.clientBuffered() > SAMPLE_RATE_OUT * 2) await delay(20, this.signal);
      await delay(Math.max(0, nextSend - Date.now()), this.signal);
      this.check();
      const pcm = item.audio;
      this.firstSentAt ??= Date.now();
      if (this.framed) {
        const header = Buffer5.alloc(24);
        header.write("YSV2");
        header.writeUInt32LE(this.streamId, 4);
        header.writeUInt32LE(this.sequence++, 8);
        header.writeDoubleLE(this.sentSamples, 12);
        header.writeUInt32LE(pcm.length, 20);
        this.ws.send(Buffer5.concat([header, pcm]));
      } else this.ws.send(pcm);
      this.sentSamples += pcm.length / 2;
      this.bytes -= pcm.length;
      this.wake();
      nextSend = Math.max(nextSend, Date.now()) + pcm.length / (SAMPLE_RATE_OUT * 2) * 1e3;
    }
    this.items = [];
    this.tail = Buffer5.alloc(0);
    this.bytes = 0;
  }
};

// src/surface.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { Buffer as Buffer6 } from "node:buffer";
var SurfaceStore = class _SurfaceStore {
  constructor(path) {
    this.path = path;
    if (path && existsSync2(path)) {
      const raw = JSON.parse(readFileSync2(path, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Buffer6.byteLength(JSON.stringify(raw)) > 4 * 1024 * 1024) throw new Error("invalid voice UI registry");
      this.scopes = raw;
    }
  }
  scopes = /* @__PURE__ */ Object.create(null);
  static key(deviceId, conversationId, preset, epoch) {
    return JSON.stringify(epoch && epoch !== "legacy" ? [deviceId, conversationId, preset, epoch] : [deviceId, conversationId, preset]);
  }
  migrateClient(deviceId, path) {
    if (existsSync2(path)) return new _SurfaceStore(path);
    const own = Object.fromEntries(Object.entries(this.scopes).filter(([key]) => {
      try {
        return JSON.parse(key)[0] === deviceId;
      } catch {
        return false;
      }
    }));
    mkdirSync2(dirname2(path), { recursive: true, mode: 448 });
    writeFileSync2(path, JSON.stringify(own), { mode: 384 });
    return new _SurfaceStore(path);
  }
  view(entry) {
    const { actions, expiresInMs, ...component2 } = entry.component;
    return { ...component2, ...actions ? { actions: actions.map(({ id: id2, label }) => ({ id: id2, label })) } : {}, revision: entry.revision, expiresAt: entry.expiresAt, disabled: entry.disabled, instanceId: entry.instanceId };
  }
  snapshot(key) {
    return Object.values(this.scopes[key]?.components ?? {}).filter((e) => e.expiresAt > Date.now()).map((e) => this.view(e));
  }
  save(key, scope) {
    const next = { ...this.scopes, [key]: scope };
    for (const [k, s] of Object.entries(next)) if (k !== key && Object.values(s.components).every((e) => e.expiresAt <= Date.now())) delete next[k];
    const data = JSON.stringify(next);
    if (Object.keys(next).length > 256 || Buffer6.byteLength(data) > 4 * 1024 * 1024) throw new VoiceError("ui_overflow", "UI \u72B6\u6001\u8D85\u8FC7\u5BB9\u91CF\u4E0A\u9650");
    if (this.path) {
      mkdirSync2(dirname2(this.path), { recursive: true });
      const temp = `${this.path}.${newId()}.tmp`;
      writeFileSync2(temp, data, { mode: 384 });
      renameSync2(temp, this.path);
    }
    this.scopes = next;
  }
  render(key, component2, turnId) {
    const original = this.scopes[key] ?? { revision: 0, components: {} };
    const components = Object.fromEntries(Object.entries(original.components).filter(([, e]) => e.expiresAt > Date.now()));
    if (!Object.hasOwn(components, component2.id) && Object.keys(components).length >= 16) throw new VoiceError("ui_overflow", "\u5355\u4E2A\u5BF9\u8BDD\u6700\u591A\u4FDD\u7559 16 \u4E2A\u7EC4\u4EF6");
    const entry = { component: structuredClone(component2), revision: original.revision + 1, expiresAt: Date.now() + component2.expiresInMs, disabled: false, turnId, instanceId: newId() };
    components[component2.id] = entry;
    this.save(key, { revision: entry.revision, components });
    return this.view(entry);
  }
  remove(key, id2, revision, instanceId) {
    const scope = this.scopes[key], entry = scope && Object.hasOwn(scope.components, id2) ? scope.components[id2] : void 0;
    if (!entry) return;
    if (revision !== void 0 && entry.revision !== revision) throw new VoiceError("stale_ui", "\u7EC4\u4EF6\u5DF2\u66F4\u65B0");
    if (instanceId !== void 0 && entry.instanceId !== instanceId) throw new VoiceError("stale_ui", "\u7EC4\u4EF6\u5B9E\u4F8B\u5DF2\u53D8\u5316");
    const components = { ...scope.components };
    delete components[id2];
    const next = scope.revision + 1;
    this.save(key, { revision: next, components });
    return next;
  }
  invalidateTurn(key, turnId) {
    const scope = this.scopes[key];
    if (!scope) return [];
    const removed = [], components = { ...scope.components };
    let revision = scope.revision;
    for (const [id2, e] of Object.entries(components)) if (e.turnId === turnId) {
      delete components[id2];
      removed.push({ componentId: id2, revision: ++revision });
    }
    if (removed.length) this.save(key, { revision, components });
    return removed;
  }
  prepare(key, id2, revision, instanceId, actionId, values) {
    const entry = this.scopes[key]?.components[id2];
    if (!entry || entry.expiresAt <= Date.now() || entry.revision !== revision || entry.instanceId !== instanceId || entry.disabled) throw new VoiceError("stale_ui", "\u7EC4\u4EF6\u5DF2\u8FC7\u671F\u3001\u66F4\u65B0\u6216\u88AB\u63D0\u4EA4");
    const action = entry.component.actions?.find((a) => a.id === actionId);
    if (!action) throw new VoiceError("bad_ui_action", "\u64CD\u4F5C\u4E0D\u5B58\u5728");
    const parsed = formValues(entry.component.fields, values);
    const text2 = `\u7528\u6237\u5728\u5BA2\u6237\u7AEF\u9009\u62E9\u4E86\u300C${entry.component.title}\u300D\u4E2D\u7684\u300C${action.label}\u300D\u3002
${action.prompt}${Object.keys(parsed).length ? `
\u7528\u6237\u63D0\u4EA4\u7684\u6570\u636E\uFF1A${JSON.stringify(parsed)}` : ""}`;
    return { text: text2, consume: () => {
      const current = this.scopes[key];
      if (current?.components[id2] !== entry) throw new VoiceError("stale_ui", "\u7EC4\u4EF6\u5DF2\u66F4\u65B0");
      const changed = { ...entry, disabled: true, revision: current.revision + 1 };
      this.save(key, { revision: changed.revision, components: { ...current.components, [id2]: changed } });
      return this.view(changed);
    } };
  }
};

// src/connection.ts
var SentenceQueue = class {
  pending = [];
  size = 0;
  closed = false;
  wake;
  push(text2) {
    if (!text2 || this.closed) return;
    if (this.size + text2.length > 32e3) throw new VoiceError("output_overflow", "\u5F85\u64AD\u62A5\u6587\u672C\u8D85\u8FC7\u7F13\u51B2\u4E0A\u9650");
    this.pending.push(text2);
    this.size += text2.length;
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async next() {
    while (!this.pending.length && !this.closed) await new Promise((resolve4) => {
      this.wake = resolve4;
    });
    const text2 = this.pending.shift();
    if (text2) this.size -= text2.length;
    return text2;
  }
};
var VoiceConnection = class {
  constructor(ws, deps) {
    this.ws = ws;
    this.deps = deps;
    this.surface = deps.surface ?? new SurfaceStore();
  }
  state = "init";
  version = 1;
  capabilities = /* @__PURE__ */ new Set();
  conversationId = "";
  active;
  streamNumber = 0;
  requests = /* @__PURE__ */ new Map();
  playback = /* @__PURE__ */ new Map();
  presentation = support(void 0);
  surface;
  presentationSequence = 0;
  waitingPlayback;
  connectionId = newId();
  deviceId = "";
  deviceName = "";
  describe() {
    return { connectionId: this.connectionId, deviceId: this.deviceId, deviceName: this.deviceName, conversationId: this.conversationId, state: this.state, version: this.version, turnId: this.active?.id };
  }
  send(value, turn) {
    if (this.state === "closed" || this.ws.readyState !== 1 || turn && !this.current(turn)) return;
    const envelope = this.version === 2 ? { ...value, connectionId: this.connectionId, ...turn ? { turnId: turn.id, requestId: turn.requestId, conversationId: turn.conversationId, streamId: turn.streamId } : {} } : value;
    try {
      this.ws.send(JSON.stringify(envelope));
    } catch {
      this.handleClosed();
    }
  }
  error(code, message, turn, requestId) {
    this.send({ type: "error", code, message, ...this.version === 2 && typeof requestId === "string" ? { requestId } : {} }, turn);
  }
  event(type, data, turn) {
    if (this.version === 2) this.send({ type, ...data }, turn);
  }
  current(turn) {
    return this.active === turn && !turn.ended && !turn.controller.signal.aborted;
  }
  handleMessage(raw) {
    if (this.state === "closed") return;
    let m;
    try {
      if (Buffer7.byteLength(raw) > 32 * 1024) throw new VoiceError("message_too_large", "\u63A7\u5236\u6D88\u606F\u8D85\u8FC7 32KiB");
      m = JSON.parse(raw);
      if (!m || typeof m !== "object" || Array.isArray(m)) throw new VoiceError("bad_message", "\u6D88\u606F\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
      if (m.type === "hello") {
        this.hello(m);
        return;
      }
      if (m.type === "ping") {
        this.send({ type: "pong", time: typeof m.time === "number" ? m.time : Date.now() });
        return;
      }
      if (this.state === "init") throw new VoiceError("no_hello", "\u8BF7\u5148\u53D1\u9001 hello");
      switch (m.type) {
        case "abort":
        case "turn.cancel":
          this.handleAbort(m);
          break;
        case "response.stop":
          this.stopResponse(m);
          break;
        case "playback":
          this.handlePlayback(m);
          break;
        case "conversation.select":
          this.selectConversation(m);
          break;
        case "ui.action":
          this.uiAction(m);
          break;
        case "ui.dismiss":
          this.uiDismiss(m);
          break;
        case "ui.sync":
          this.uiSnapshot();
          break;
        case "listen":
          this.listen(m);
          break;
        case "query":
        case "speak":
          this.text(m);
          break;
        default:
          throw new VoiceError("unknown_type", `\u672A\u77E5\u6D88\u606F type\uFF1A${String(m.type).slice(0, 64)}`);
      }
    } catch (e) {
      this.error(e instanceof VoiceError ? e.code : "bad_json", e instanceof VoiceError ? e.message : "\u6D88\u606F\u4E0D\u662F\u5408\u6CD5 JSON", void 0, m?.requestId);
    }
  }
  hello(m) {
    if (this.state !== "init") throw new VoiceError("already_hello", "hello \u53EA\u80FD\u53D1\u9001\u4E00\u6B21");
    if (![1, 2].includes(m.version)) throw new VoiceError("unsupported_version", "\u652F\u6301\u7684\u534F\u8BAE\u7248\u672C\u4E3A 1\u30012");
    const device = m.version === 1 ? sanitizeDeviceId(m.deviceId) : m.deviceId;
    const presentation = support(m.presentation);
    if (!identifier(device, 48)) throw new VoiceError("bad_device_id", "deviceId \u5FC5\u987B\u4E3A 1\u201348 \u4F4D\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26");
    if (m.capabilities !== void 0 && (!Array.isArray(m.capabilities) || m.capabilities.length > 32 || m.capabilities.some((x) => typeof x !== "string"))) throw new VoiceError("bad_capabilities", "capabilities \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
    if (m.audio !== void 0) {
      for (const [direction, rate] of [["input", SAMPLE_RATE_IN], ["output", SAMPLE_RATE_OUT]]) {
        const audio = m.audio?.[direction];
        if (audio && (audio.encoding !== "pcm_s16le" || audio.sampleRate !== rate || audio.channels !== 1)) throw new VoiceError("unsupported_audio", "\u4EC5\u652F\u6301\u5355\u58F0\u9053 PCM s16le\uFF0C\u8F93\u5165 16kHz\u3001\u8F93\u51FA 24kHz");
      }
    }
    const conversation = m.conversationId ?? device;
    if (!identifier(conversation) || conversation !== device && !this.deps.allowConversation?.(device, conversation)) throw new VoiceError("bad_conversation", "\u5BF9\u8BDD\u6807\u8BC6\u4E0D\u5408\u6CD5\u6216\u4E0D\u5C5E\u4E8E\u6B64\u5BA2\u6237\u7AEF");
    if (this.deps.claimDevice && !this.deps.claimDevice(device)) throw new VoiceError("device_in_use", "\u6B64\u8BBE\u5907\u5DF2\u6709\u8FDE\u63A5\uFF0C\u8BF7\u5173\u95ED\u65E7\u8FDE\u63A5\u540E\u91CD\u8BD5");
    this.deviceId = device;
    this.deviceName = typeof m.deviceName === "string" ? m.deviceName.slice(0, 64) : "";
    if (this.deps.surfaceForDevice) this.surface = this.deps.surfaceForDevice(device);
    this.version = m.version;
    this.conversationId = conversation;
    this.capabilities = new Set((m.version === 2 ? m.capabilities ?? [] : []).filter((x) => CAPABILITIES.includes(x)));
    this.presentation = presentation;
    this.state = "ready";
    const config = this.deps.settings(device), scope = this.scope(conversation, config.agentPreset);
    this.send({
      type: "welcome",
      version: this.version,
      sessionId: this.deps.bridge.sessionId(scope, config.agentPreset),
      sampleRateIn: SAMPLE_RATE_IN,
      sampleRateOut: SAMPLE_RATE_OUT,
      ...this.version === 2 ? { conversationId: conversation, serverTime: Date.now(), capabilities: [...this.capabilities], supportedCapabilities: CAPABILITIES, presentation: this.presentation, audio: { input: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_IN }, output: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_OUT, framing: this.capabilities.has("audio.framed") ? "ysv2" : "raw" } } } : {}
    });
    this.avatarState("idle");
    if (this.capabilities.has("ui.render")) this.uiSnapshot();
    this.deps.log("info", `device connected: ${device}`);
  }
  requestSeen(m) {
    const requestId = m.requestId;
    const fingerprint = this.fingerprint(m);
    if (this.version === 2) {
      if (typeof requestId !== "string" || !requestId.length || requestId.length > 128) throw new VoiceError("bad_request_id", "requestId \u5FC5\u987B\u4E3A 1\u2013128 \u5B57\u7B26");
      const previous = this.requests.get(requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new VoiceError("request_conflict", "requestId \u5DF2\u7528\u4E8E\u4E0D\u540C\u8BF7\u6C42");
        this.send(previous.end ?? { type: "request.duplicate", requestId, turnId: this.active?.id });
        return true;
      }
    }
    return false;
  }
  fingerprint(m) {
    return JSON.stringify([m.type, m.text ?? "", this.conversationId, m.componentId, m.instanceId, m.revision, m.actionId, m.values && typeof m.values === "object" ? Object.fromEntries(Object.entries(m.values).sort(([a], [b]) => a.localeCompare(b))) : m.values]);
  }
  begin(m, listening = false) {
    if (this.requestSeen(m)) return;
    const requestId = m.requestId, fingerprint = this.fingerprint(m);
    if (this.active) throw new VoiceError("busy", "\u4E0A\u4E00\u8F6E\u5C1A\u672A\u7ED3\u675F\uFF0C\u5148\u53D1\u9001 abort");
    const settings = { ...this.deps.settings(this.deviceId) };
    const turn = { id: newId(), requestId, streamId: ++this.streamNumber, conversationId: this.conversationId, scopeKey: this.scope(this.conversationId, settings.agentPreset), settings, controller: new AbortController(), response: new AbortController(), timer: void 0, ended: false, ttsStarted: false, audioEnded: false, responseStopped: false, llmStarted: false, llmEnded: false, startedAt: Date.now(), pcm: [], pcmBytes: 0, pendingCues: [], effectCount: 0 };
    this.active = turn;
    this.state = listening ? "listening" : "busy";
    if (this.version === 2) {
      this.requests.set(requestId, { fingerprint });
      if (this.requests.size > 256) this.requests.delete(this.requests.keys().next().value);
    }
    turn.timer = setTimeout(() => {
      this.error("turn_timeout", "\u672C\u8F6E\u8D85\u8FC7\u6700\u957F\u7B49\u5F85\u65F6\u95F4", turn);
      this.finish(turn, "timeout");
    }, turn.settings.maxTurnSeconds * 1e3);
    if (listening) turn.captureTimer = setTimeout(() => {
      this.error("too_long", "\u62FE\u97F3\u8D85\u8FC7 120 \u79D2\u4E0A\u9650", turn);
      this.finish(turn, "too_long");
    }, 12e4);
    this.event("turn.start", { input: m.type, state: listening ? "listening" : "processing" }, turn);
    this.waitingPlayback = void 0;
    this.avatarState(listening ? "listening" : "thinking", turn);
    return turn;
  }
  listen(m) {
    if (m.state === "start") {
      this.begin(m, true);
      return;
    }
    if (m.state !== "stop") throw new VoiceError("bad_listen_state", "listen.state \u5FC5\u987B\u662F start \u6216 stop");
    const turn = this.active;
    if (!turn || this.state !== "listening") throw new VoiceError("not_listening", "\u5F53\u524D\u6CA1\u6709\u5904\u4E8E\u62FE\u97F3\u72B6\u6001");
    if (m.turnId !== void 0 && m.turnId !== turn.id) throw new VoiceError("stale_turn", "\u8F6E\u6B21\u4E0D\u5339\u914D");
    const pcm = Buffer7.concat(turn.pcm);
    turn.pcm = [];
    turn.pcmBytes = 0;
    clearTimeout(turn.captureTimer);
    this.state = "busy";
    if (pcm.length % 2) {
      this.error("bad_audio", "PCM \u6570\u636E\u672A\u5BF9\u9F50 16 \u4F4D\u91C7\u6837", turn);
      this.finish(turn, "error");
      return;
    }
    if (pcm.length < SAMPLE_RATE_IN * 2 * 0.3) {
      this.finish(turn, "too_short");
      return;
    }
    this.launch(turn, async () => {
      this.event("turn.state", { state: "transcribing" }, turn);
      this.avatarState("thinking", turn);
      const asrStarted = Date.now();
      const text2 = await abortable((this.deps.transcribe ?? transcribePcm)(pcm, { apiKey: turn.settings.minimaxApiKey, model: turn.settings.asrModel, signal: turn.controller.signal }), turn.controller.signal);
      if (!this.current(turn)) return;
      turn.asrMs = Date.now() - asrStarted;
      this.send({ type: "stt", text: text2, ...this.version === 2 ? { final: true } : {} }, turn);
      if (!text2) {
        this.finish(turn, "empty_asr");
        return;
      }
      await this.pipeline(turn, text2);
    });
  }
  text(m) {
    const limit = m.type === "speak" ? 1e3 : 4e3;
    if (typeof m.text !== "string" || !m.text.trim()) throw new VoiceError("empty_text", `${m.type}.text \u4E0D\u80FD\u4E3A\u7A7A`);
    if (m.text.length > limit) throw new VoiceError("text_too_long", `\u6587\u672C\u8D85\u8FC7 ${limit} \u5B57\u7B26`);
    const turn = this.begin(m);
    if (!turn) return;
    this.launch(turn, async () => {
      if (m.type === "query") await this.pipeline(turn, m.text.trim());
      else {
        turn.sender = this.createSender(turn);
        try {
          await this.sentence(turn, m.text.trim(), 0);
          if (!turn.responseStopped) await abortable(turn.sender.finish(), turn.controller.signal);
        } catch (e) {
          if (!turn.responseStopped) throw e;
        }
        this.finish(turn, turn.responseStopped ? "stopped" : "done");
      }
    });
  }
  launch(turn, fn) {
    void fn().catch((e) => {
      if (!this.current(turn)) return;
      this.error(typeof e?.code === "string" ? e.code : "turn_failed", e instanceof Error ? e.message : String(e), turn);
      this.finish(turn, "error");
    });
  }
  createSender(turn) {
    return new AudioSender(this.ws, turn.response.signal, turn.streamId, this.version === 2 && this.capabilities.has("audio.framed"), () => this.capabilities.has("playback.flow") ? turn.bufferedSamples ?? 0 : 0);
  }
  async sentence(turn, text2, sentenceIndex) {
    if (!this.current(turn) || turn.response.signal.aborted) return;
    if (!turn.ttsStarted) {
      turn.ttsStarted = true;
      this.send({ type: "tts", state: "start" }, turn);
      this.event("audio.start", { format: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_OUT }, framing: this.capabilities.has("audio.framed") ? "ysv2" : "raw" }, turn);
    }
    const sender = turn.sender, offset = sender.queuedSamples, s = turn.settings;
    let marked = false, bytes = 0;
    for await (const chunk of (this.deps.synthesize ?? synthesizeStream)(text2, { apiKey: s.minimaxApiKey, model: s.ttsModel, voiceId: s.ttsVoice, speed: s.ttsSpeed, vol: s.ttsVol, pitch: s.ttsPitch, signal: turn.response.signal })) {
      if (!this.current(turn) || turn.response.signal.aborted) return;
      if (!marked && chunk.length) {
        marked = true;
        sender.mark(() => {
          if (!this.current(turn)) return;
          this.avatarState("speaking", turn);
          for (const pending of turn.pendingCues.splice(0)) this.event("presentation.cue", { ...pending.cue, cueId: pending.cueId, sampleOffset: offset, sequence: ++this.presentationSequence }, turn);
          this.send({ type: "tts", state: "sentence_start", text: text2, ...this.version === 2 ? { sentenceIndex, sampleOffset: offset } : {} }, turn);
        });
      }
      bytes += chunk.length;
      await sender.push(chunk);
    }
    if (!turn.response.signal.aborted && !bytes) throw new VoiceError("empty_audio", "\u5408\u6210\u670D\u52A1\u672A\u8FD4\u56DE\u97F3\u9891");
    if (!turn.response.signal.aborted) sender.flushSentence();
  }
  async pipeline(turn, text2) {
    const queue = turn.queue = new SentenceQueue(), slicer = new SentenceSlicer();
    turn.sender = this.createSender(turn);
    turn.response.signal.addEventListener("abort", () => queue.close(), { once: true });
    const pump = (async () => {
      let index = 0;
      while (!turn.response.signal.aborted) {
        const sentence = await queue.next();
        if (sentence === void 0) break;
        await this.sentence(turn, sentence, index++);
      }
    })().catch((e) => {
      if (turn.responseStopped || !this.current(turn)) return;
      this.error(typeof e?.code === "string" ? e.code : "tts_failed", e instanceof Error ? e.message : String(e), turn);
      this.finish(turn, "error");
    });
    turn.llmStarted = true;
    this.send({ type: "llm", state: "start" }, turn);
    this.event("turn.state", { state: "thinking" }, turn);
    const handle = await abortable(this.deps.bridge.turn(turn.scopeKey, text2, {
      onTextDelta: (delta) => {
        if (!this.current(turn)) return;
        turn.firstTextMs ??= Date.now() - turn.startedAt;
        this.send({ type: "llm", state: "delta", text: delta }, turn);
        if (!turn.response.signal.aborted) {
          try {
            for (const sentence of slicer.feed(delta)) queue.push(sentence);
          } catch (e) {
            this.error("output_overflow", String(e), turn);
            this.finish(turn, "error");
          }
        }
      },
      onEnd: () => void 0,
      onActivity: (activity) => {
        if (this.capabilities.has("agent.activity")) this.event("agent.activity", activity, turn);
      },
      ...this.version === 2 && (this.capabilities.has("presentation.cue") || this.capabilities.has("ui.render")) ? { onClientEffect: (effect) => this.clientEffect(turn, effect) } : {}
    }, turn.settings.agentPreset, { signal: turn.controller.signal, promptPrefix: turn.settings.promptPrefix, persona: turn.settings, memory: this.deps.memory?.(this.deviceId), capabilities: [...this.capabilities], presentation: this.presentation }), turn.controller.signal);
    if (!this.current(turn)) {
      handle.cancel();
      return;
    }
    turn.handle = handle;
    this.event("session", { sessionId: handle.sessionId }, turn);
    this.deps.onSession?.(this.deviceId, turn.conversationId, turn.settings.agentPreset, handle.sessionId);
    const outcome = await abortable(handle.done, turn.controller.signal);
    if (!this.current(turn)) return;
    turn.handle = void 0;
    turn.llmEnded = true;
    this.send({ type: "llm", state: "end" }, turn);
    if (outcome.kind === "error") throw new VoiceError("llm_error", outcome.error ?? "dsh \u4F1A\u8BDD\u51FA\u9519");
    if (outcome.kind === "cancelled") {
      this.finish(turn, "cancelled");
      return;
    }
    if (!turn.response.signal.aborted) queue.push(slicer.flush());
    queue.close();
    await abortable(pump, turn.controller.signal);
    if (!this.current(turn)) return;
    if (!turn.responseStopped) {
      try {
        await abortable(turn.sender.finish(), turn.controller.signal);
      } catch (e) {
        if (!turn.responseStopped) throw e;
      }
    }
    this.finish(turn, "completed");
  }
  handleBinary(data) {
    const turn = this.active;
    if (!turn || this.state !== "listening") {
      this.error("not_listening", "\u5F53\u524D\u6CA1\u6709\u5904\u4E8E\u62FE\u97F3\u72B6\u6001");
      return;
    }
    if (turn.pcmBytes + data.length > SAMPLE_RATE_IN * 2 * 120 || turn.pcm.length >= 4096) {
      this.error("too_long", "\u62FE\u97F3\u8D85\u8FC7\u65F6\u957F\u6216\u5206\u7247\u6570\u91CF\u4E0A\u9650", turn);
      this.finish(turn, "too_long");
      return;
    }
    if (data.length) {
      turn.pcm.push(Buffer7.from(data));
      turn.pcmBytes += data.length;
    }
  }
  handleAbort(m = {}) {
    const turn = this.active;
    if (turn && m.turnId !== void 0 && m.turnId !== turn.id) throw new VoiceError("stale_turn", "\u8F6E\u6B21\u4E0D\u5339\u914D");
    if (turn) this.finish(turn, "aborted");
    else if (this.version === 1) this.send({ type: "tts", state: "stop", reason: "aborted" });
    else this.event("cancel.ack", { turnId: m.turnId ?? null, active: false });
  }
  stopResponse(m) {
    if (this.version !== 2 || !this.capabilities.has("response.stop")) throw new VoiceError("unsupported_capability", "\u9700\u8981\u534F\u5546 response.stop");
    const turn = this.active;
    if (!turn || turn.id !== m.turnId) throw new VoiceError("stale_turn", "\u8F6E\u6B21\u4E0D\u5339\u914D");
    turn.responseStopped = true;
    turn.response.abort();
    turn.queue?.close();
    this.audioEnd(turn, "stopped");
    turn.pendingCues = [];
    this.resetPresentation("stopped", turn);
    this.avatarState("thinking", turn);
  }
  audioEnd(turn, reason) {
    if (turn.audioEnded) return;
    turn.audioEnded = true;
    const samples = turn.sender?.sentSamples ?? 0, previous = this.playback.get(turn.streamId);
    this.playback.set(turn.streamId, { turnId: turn.id, samples, played: previous?.played ?? 0, ended: false });
    if (this.playback.size > 32) this.playback.delete(this.playback.keys().next().value);
    this.event("audio.end", { reason, samples }, turn);
  }
  finish(turn, reason) {
    if (!this.current(turn)) return;
    if (turn.llmStarted && !turn.llmEnded) {
      turn.llmEnded = true;
      this.send({ type: "llm", state: "end" }, turn);
    }
    this.audioEnd(turn, reason);
    if (!["completed", "done"].includes(reason)) {
      try {
        for (const removed of this.surface.invalidateTurn(this.surfaceKey(turn), turn.id)) this.event("ui.remove", { ...removed, reason }, turn);
      } catch (e) {
        this.deps.log("warn", `cannot invalidate UI: ${String(e)}`);
      }
      this.resetPresentation(reason, turn);
    }
    if (["completed", "done"].includes(reason) && turn.sender?.sentSamples && !turn.responseStopped && this.capabilities.has("playback")) this.waitingPlayback = turn.streamId;
    else this.avatarState(reason === "error" ? "error" : "idle", turn);
    turn.pendingCues = [];
    this.send({ type: "tts", state: "stop", reason: this.version === 1 && reason === "timeout" ? "cancelled" : reason }, turn);
    const end = { type: "turn.end", turnId: turn.id, requestId: turn.requestId, conversationId: turn.conversationId, streamId: turn.streamId, reason, responseStopped: turn.responseStopped, durationMs: Date.now() - turn.startedAt, metrics: { asrMs: turn.asrMs, firstTextMs: turn.firstTextMs, firstAudioMs: turn.sender?.firstSentAt ? turn.sender.firstSentAt - turn.startedAt : void 0, audioSamples: turn.sender?.sentSamples ?? 0 } };
    this.event("turn.end", end, turn);
    if (turn.requestId && this.requests.has(turn.requestId)) this.requests.get(turn.requestId).end = end;
    turn.ended = true;
    clearTimeout(turn.timer);
    clearTimeout(turn.captureTimer);
    turn.controller.abort(new VoiceError(reason, `turn ${reason}`));
    turn.response.abort();
    turn.queue?.close();
    turn.handle?.cancel();
    turn.pcm = [];
    if (this.active === turn) {
      this.active = void 0;
      if (this.state !== "closed") this.state = "ready";
    }
    this.deps.log("info", `turn ${turn.id}: ${reason} (${Date.now() - turn.startedAt}ms)`);
  }
  handlePlayback(m) {
    if (this.version !== 2 || !this.capabilities.has("playback")) throw new VoiceError("unsupported_capability", "\u9700\u8981\u534F\u5546 playback");
    const record = this.playback.get(m.streamId), active = this.active?.streamId === m.streamId ? this.active : void 0;
    const available = active?.sender?.sentSamples ?? record?.samples;
    if (available === void 0 || m.turnId !== (record?.turnId ?? active?.id) || !Number.isSafeInteger(m.playedSamples) || m.playedSamples < (record?.played ?? 0) || m.playedSamples > available || !["progress", "ended", "cleared"].includes(m.state)) throw new VoiceError("bad_playback", "\u64AD\u653E\u56DE\u6267\u7684\u8F6E\u6B21\u3001\u4F4D\u7F6E\u6216\u72B6\u6001\u65E0\u6548");
    if (m.state === "ended" && (!(active?.audioEnded ?? !!record) || m.playedSamples !== available)) throw new VoiceError("bad_playback", "\u97F3\u9891\u53D1\u9001\u5B8C\u6210\u4E14\u5168\u90E8\u64AD\u653E\u540E\u624D\u80FD\u62A5\u544A ended");
    if (m.bufferedSamples !== void 0) {
      if (!this.capabilities.has("playback.flow") || !Number.isSafeInteger(m.bufferedSamples) || m.bufferedSamples < 0 || m.bufferedSamples > available - m.playedSamples) throw new VoiceError("bad_playback", "\u64AD\u653E\u7F13\u51B2\u4F4D\u7F6E\u65E0\u6548\u6216\u672A\u534F\u5546 playback.flow");
      if (active) active.bufferedSamples = m.bufferedSamples;
    }
    if (record?.ended && (m.state === "progress" || m.playedSamples !== record.played)) throw new VoiceError("bad_playback", "\u64AD\u653E\u6D41\u5DF2\u7ED3\u675F");
    this.playback.set(m.streamId, { turnId: m.turnId, samples: available, played: m.playedSamples, ended: m.state !== "progress" });
    this.event("playback.ack", { turnId: m.turnId, streamId: m.streamId, playedSamples: m.playedSamples, state: m.state });
    if (m.state !== "progress" && this.waitingPlayback === m.streamId && !this.active) {
      this.waitingPlayback = void 0;
      this.avatarState("idle");
    }
  }
  selectConversation(m) {
    if (this.version !== 2 || !this.capabilities.has("conversation.select")) throw new VoiceError("unsupported_capability", "\u9700\u8981\u534F\u5546 conversation.select");
    if (this.active) throw new VoiceError("busy", "\u8BF7\u5148\u7ED3\u675F\u5F53\u524D\u8F6E");
    if (!identifier(m.conversationId) || m.conversationId !== this.deviceId && !this.deps.allowConversation?.(this.deviceId, m.conversationId)) throw new VoiceError("bad_conversation", "\u5BF9\u8BDD\u4E0D\u5C5E\u4E8E\u6B64\u8BBE\u5907");
    this.conversationId = m.conversationId;
    const config = this.deps.settings(this.deviceId);
    this.event("conversation.selected", { conversationId: this.conversationId, sessionId: this.deps.bridge.sessionId(this.scope(this.conversationId, config.agentPreset), config.agentPreset) });
    this.waitingPlayback = void 0;
    this.resetPresentation("conversation_changed");
    this.avatarState("idle");
    if (this.capabilities.has("ui.render")) this.uiSnapshot();
  }
  avatarState(state, turn) {
    if (this.capabilities.has("presentation.state")) this.event("presentation.state", { state, sequence: ++this.presentationSequence }, turn);
  }
  resetPresentation(reason, turn) {
    if (this.capabilities.has("presentation.state") || this.capabilities.has("presentation.cue")) this.event("presentation.reset", { reason }, turn);
  }
  scope(conversation, preset) {
    return this.deps.scope?.(this.deviceId, conversation, preset) ?? conversation;
  }
  surfaceKey(turn) {
    return SurfaceStore.key(this.deviceId, turn?.conversationId ?? this.conversationId, turn?.settings.agentPreset ?? this.deps.settings(this.deviceId).agentPreset, this.deps.epoch?.(this.deviceId));
  }
  requireUI() {
    if (this.version !== 2 || !this.capabilities.has("ui.render")) throw new VoiceError("unsupported_capability", "\u9700\u8981\u534F\u5546 ui.render");
  }
  uiSnapshot() {
    this.requireUI();
    this.event("ui.snapshot", { conversationId: this.conversationId, components: this.surface.snapshot(this.surfaceKey()).filter((c) => this.presentation.components.includes(c.type)) });
  }
  clientEffect(turn, effect) {
    if (!this.current(turn)) throw new VoiceError("cancelled", "\u8F6E\u6B21\u5DF2\u7ED3\u675F");
    if (++turn.effectCount > 64) throw new VoiceError("presentation_overflow", "\u5355\u8F6E\u6700\u591A 64 \u4E2A\u8868\u73B0\u6216\u754C\u9762\u64CD\u4F5C");
    if (effect.kind === "cue") {
      if (!this.capabilities.has("presentation.cue") || turn.responseStopped) throw new VoiceError("unsupported_presentation", "\u8868\u73B0\u8F93\u51FA\u4E0D\u53EF\u7528");
      if (turn.pendingCues.length >= 16) throw new VoiceError("presentation_overflow", "\u7B49\u5F85\u97F3\u9891\u7684\u52A8\u4F5C\u8FC7\u591A");
      const cueId = newId();
      if (effect.cue.timing === "next_sentence") turn.pendingCues.push({ cueId, cue: effect.cue });
      else this.event("presentation.cue", { ...effect.cue, cueId, sequence: ++this.presentationSequence }, turn);
      return { cueId, status: effect.cue.timing === "now" ? "sent" : "scheduled" };
    }
    this.requireUI();
    if (effect.kind === "render") {
      const component2 = this.surface.render(this.surfaceKey(turn), effect.component, turn.id);
      this.event("ui.render", { component: component2 }, turn);
      return { componentId: component2.id, revision: component2.revision, instanceId: component2.instanceId };
    }
    const revision = this.surface.remove(this.surfaceKey(turn), effect.componentId);
    if (revision !== void 0) this.event("ui.remove", { componentId: effect.componentId, revision }, turn);
    return { removed: revision !== void 0 };
  }
  uiAction(m) {
    this.requireUI();
    if (Object.keys(m).some((k) => !["type", "requestId", "componentId", "instanceId", "revision", "actionId", "values"].includes(k))) throw new VoiceError("bad_ui_action", "\u4E0D\u63A5\u53D7\u5BA2\u6237\u7AEF\u63D0\u4F9B\u7684\u64CD\u4F5C\u6587\u672C");
    if (this.requestSeen(m)) return;
    if (this.active) throw new VoiceError("busy", "\u8BF7\u7B49\u5F85\u5F53\u524D\u8F6E\u7ED3\u675F\u540E\u64CD\u4F5C");
    if (!identifier(m.componentId) || !identifier(m.actionId) || typeof m.instanceId !== "string" || !Number.isSafeInteger(m.revision)) throw new VoiceError("bad_ui_action", "\u64CD\u4F5C\u8EAB\u4EFD\u65E0\u6548");
    const prepared = this.surface.prepare(this.surfaceKey(), m.componentId, m.revision, m.instanceId, m.actionId, m.values);
    const turn = this.begin(m);
    if (!turn) return;
    try {
      this.event("ui.render", { component: prepared.consume() }, turn);
    } catch (e) {
      this.error("stale_ui", String(e), turn);
      this.finish(turn, "error");
      return;
    }
    this.event("ui.action.accepted", { componentId: m.componentId, actionId: m.actionId }, turn);
    this.launch(turn, () => this.pipeline(turn, prepared.text));
  }
  uiDismiss(m) {
    this.requireUI();
    if (!identifier(m.componentId) || !Number.isSafeInteger(m.revision) || typeof m.instanceId !== "string") throw new VoiceError("bad_ui_action", "\u7EC4\u4EF6\u8EAB\u4EFD\u65E0\u6548");
    const revision = this.surface.remove(this.surfaceKey(), m.componentId, m.revision, m.instanceId);
    if (revision !== void 0) this.event("ui.remove", { componentId: m.componentId, revision });
  }
  handleClosed() {
    if (this.state === "closed") return;
    this.state = "closed";
    if (this.active) this.finish(this.active, "disconnected");
    this.playback.clear();
  }
  close(code = 1001, reason = "server shutdown") {
    this.handleClosed();
    this.ws.close(code, reason);
  }
};
function sanitizeDeviceId(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) : "";
}

// src/settings.ts
import { randomBytes } from "node:crypto";
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3, renameSync as renameSync3, unlinkSync } from "node:fs";
import { dirname as dirname3, resolve } from "node:path";
import { homedir } from "node:os";
var LEGACY_DEFAULT_PREFIX = "\u4F60\u662F\u8BED\u97F3\u52A9\u624B\u3002\u59CB\u7EC8\u7528\u7B80\u77ED\u3001\u53E3\u8BED\u5316\u7684\u4E2D\u6587\u56DE\u7B54\uFF08\u901A\u5E38\u4E0D\u8D85\u8FC7\u4E09\u53E5\u8BDD\uFF09\uFF0C\u4E0D\u8981\u4F7F\u7528 Markdown\u3001\u4EE3\u7801\u5757\u6216\u5217\u8868\u3002";
var DEFAULT_SETTINGS = {
  ...DEFAULT_PERSONA,
  llmProvider: "",
  llmModel: "",
  legacyDeviceId: "",
  minimaxApiKey: "",
  asrModel: "asr-1.0",
  ttsModel: "speech-2.8-turbo",
  ttsVoice: "female-shaonv",
  ttsSpeed: 1,
  ttsVol: 1,
  ttsPitch: 0,
  promptPrefix: "",
  agentPreset: VOICE_PRESET_ID,
  token: "",
  adminToken: "",
  deviceTokens: {},
  allowedOrigins: [],
  maxTurnSeconds: 180
};
function defaultSettingsPath() {
  const home = process.env.DSH_HOME ?? resolve(homedir(), ".dsh");
  return resolve(home, "yusheng-voice", "settings.json");
}
function isPlainString(v, max) {
  return typeof v === "string" && v.length <= max;
}
function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function mergeSettings(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("settings patch must be an object");
  const next = { ...current };
  const rejected = [];
  const strings = [
    ["minimaxApiKey", 256],
    ["asrModel", 64],
    ["ttsModel", 64],
    ["ttsVoice", 128],
    ["promptPrefix", 4e3],
    ["agentPreset", 64],
    ["llmProvider", 128],
    ["llmModel", 128],
    ["token", 128]
  ];
  for (const [key, max] of strings) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === null || v === "") {
      ;
      next[key] = "";
    } else if (isPlainString(v, max)) {
      ;
      next[key] = v;
    } else {
      rejected.push(key);
    }
  }
  for (const [key, max] of Object.entries(PERSONA_TEXT_LIMITS)) {
    if (!Object.hasOwn(patch, key)) continue;
    const v = patch[key];
    if (typeof v !== "string" || v.length > max || key !== "personalityNotes" && /[\u0000-\u001f\u007f]/.test(v) || (key === "assistantName" || key === "assistantRole") && !v.trim()) rejected.push(key);
    else next[key] = v.trim();
  }
  for (const [key, choices] of Object.entries(PERSONA_ENUMS)) {
    if (!Object.hasOwn(patch, key)) continue;
    if (choices.some((choice) => choice.id === patch[key])) next[key] = patch[key];
    else rejected.push(key);
  }
  for (const [key, min, max] of [["ttsSpeed", 0.5, 2], ["ttsVol", 0, 10], ["ttsPitch", -12, 12], ["maxTurnSeconds", 15, 600]]) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      rejected.push(key);
      continue;
    }
    next[key] = key === "maxTurnSeconds" ? Math.round(clampNumber(value, min, max, current[key])) : clampNumber(value, min, max, current[key]);
  }
  if ("allowedOrigins" in patch) {
    if (Array.isArray(patch.allowedOrigins) && patch.allowedOrigins.length <= 32 && patch.allowedOrigins.every((x) => {
      try {
        return typeof x === "string" && new URL(x).origin === x && /^https?:/.test(x);
      } catch {
        return false;
      }
    })) next.allowedOrigins = [...patch.allowedOrigins];
    else rejected.push("allowedOrigins");
  }
  if ("adminToken" in patch) rejected.push("adminToken");
  if ("deviceTokens" in patch) rejected.push("deviceTokens");
  if ("legacyDeviceId" in patch) rejected.push("legacyDeviceId");
  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) rejected.push(key);
  }
  return { settings: next, rejected };
}
function maskSettings(s) {
  return {
    ...Object.fromEntries([...Object.keys(PERSONA_TEXT_LIMITS), ...Object.keys(PERSONA_ENUMS)].map((key) => [key, s[key]])),
    minimaxApiKey: "",
    hasMinimaxApiKey: s.minimaxApiKey !== "",
    asrModel: s.asrModel,
    ttsModel: s.ttsModel,
    ttsVoice: s.ttsVoice,
    ttsSpeed: s.ttsSpeed,
    ttsVol: s.ttsVol,
    ttsPitch: s.ttsPitch,
    promptPrefix: s.promptPrefix,
    agentPreset: s.agentPreset,
    llmProvider: s.llmProvider,
    llmModel: s.llmModel,
    legacyDeviceId: s.legacyDeviceId,
    token: s.token,
    adminTokenConfigured: !!s.adminToken,
    devices: Object.keys(s.deviceTokens),
    allowedOrigins: s.allowedOrigins,
    maxTurnSeconds: s.maxTurnSeconds
  };
}
var SettingsStore = class {
  path;
  data;
  constructor(path) {
    this.path = path;
    this.data = { ...DEFAULT_SETTINGS };
    try {
      if (existsSync3(path)) {
        const raw = JSON.parse(readFileSync3(path, "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("settings must be an object");
        if (raw && typeof raw === "object") {
          const { settings } = mergeSettings(DEFAULT_SETTINGS, raw);
          if (!Object.hasOwn(raw, "assistantName") && raw.promptPrefix === LEGACY_DEFAULT_PREFIX) settings.promptPrefix = "";
          this.data = settings;
          if (typeof raw.legacyDeviceId === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(raw.legacyDeviceId)) this.data.legacyDeviceId = raw.legacyDeviceId;
          if (typeof raw.adminToken === "string" && raw.adminToken.length >= 24) this.data.adminToken = raw.adminToken;
          if (raw.deviceTokens && typeof raw.deviceTokens === "object" && !Array.isArray(raw.deviceTokens)) {
            this.data.deviceTokens = Object.fromEntries(Object.entries(raw.deviceTokens).filter(([id2, token]) => /^[a-zA-Z0-9_-]{1,48}$/.test(id2) && typeof token === "string" && token.length >= 24));
          }
        }
      }
    } catch (error) {
      throw new Error(`yusheng-voice: cannot read settings; refusing to reset credentials: ${String(error)}`);
    }
    if (!this.data.adminToken) {
      this.data = { ...this.data, adminToken: `ysa-${randomBytes(32).toString("base64url")}`, token: this.data.token || `ysv-${randomBytes(24).toString("base64url")}` };
      this.save(this.data);
    }
  }
  get() {
    return { ...this.data, deviceTokens: { ...this.data.deviceTokens }, allowedOrigins: [...this.data.allowedOrigins] };
  }
  update(patch) {
    const merged = mergeSettings(this.data, patch);
    this.save(merged.settings);
    this.data = merged.settings;
    return merged;
  }
  regenerateToken() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const bytes = randomBytes(24);
    let token = "ysv-";
    for (const b of bytes) token += alphabet[b % alphabet.length];
    const deviceTokens = { ...this.data.deviceTokens };
    if (this.data.legacyDeviceId) delete deviceTokens[this.data.legacyDeviceId];
    const next = { ...this.data, token, deviceTokens };
    this.save(next);
    this.data = next;
    return token;
  }
  issueDevice(id2) {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id2)) throw new Error("invalid deviceId");
    if (Object.keys(this.data.deviceTokens).length >= 256 && !Object.hasOwn(this.data.deviceTokens, id2)) throw new Error("device limit reached");
    const token = `ysd-${randomBytes(32).toString("base64url")}`;
    const next = { ...this.data, ...this.data.legacyDeviceId === id2 ? { token: "" } : {}, deviceTokens: { ...this.data.deviceTokens, [id2]: token } };
    this.save(next);
    this.data = next;
    return token;
  }
  revokeDevice(id2) {
    const deviceTokens = { ...this.data.deviceTokens };
    delete deviceTokens[id2];
    const next = { ...this.data, deviceTokens, ...this.data.legacyDeviceId === id2 ? { token: "" } : {} };
    this.save(next);
    this.data = next;
  }
  claimLegacy(id2) {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id2) || !this.data.token || Object.hasOwn(this.data.deviceTokens, id2)) return false;
    if (this.data.legacyDeviceId) return this.data.legacyDeviceId === id2;
    const next = { ...this.data, legacyDeviceId: id2 };
    this.save(next);
    this.data = next;
    return true;
  }
  save(data) {
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      mkdirSync3(dirname3(this.path), { recursive: true });
      writeFileSync3(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 384 });
      renameSync3(temporary, this.path);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
      }
      throw new Error(`cannot persist voice settings: ${String(error)}`);
    }
  }
};

// src/clients.ts
import { existsSync as existsSync4, lstatSync, mkdirSync as mkdirSync4, readFileSync as readFileSync4, readdirSync, renameSync as renameSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { join } from "node:path";
import { randomUUID as randomUUID3 } from "node:crypto";
var CLIENT_FIELDS = ["assistantName", "userTitle", "assistantRole", "personality", "personalityNotes", "replyStyle", "presentationStyle", "minimaxApiKey", "asrModel", "ttsModel", "ttsVoice", "ttsSpeed", "ttsVol", "ttsPitch", "promptPrefix", "agentPreset", "maxTurnSeconds", "llmProvider", "llmModel"];
function write(path, value) {
  const temporary = path + "." + randomUUID3() + ".tmp";
  writeFileSync4(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 384 });
  renameSync4(temporary, path);
}
function pick(config) {
  return Object.fromEntries(CLIENT_FIELDS.map((key) => [key, config[key]]));
}
var ClientStore = class {
  constructor(root, template, model = () => void 0) {
    this.root = root;
    this.template = template;
    this.model = model;
    mkdirSync4(root, { recursive: true, mode: 448 });
  }
  directory(id2) {
    if (!identifier(id2, 48)) throw new VoiceError("bad_device_id", "\u5BA2\u6237\u7AEF ID \u683C\u5F0F\u4E0D\u6B63\u786E");
    const directory = join(this.root, id2);
    if (existsSync4(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw new Error("invalid client directory");
    return directory;
  }
  exists(id2) {
    return existsSync4(join(this.directory(id2), "profile.json"));
  }
  ensure(id2, label = "", legacyHistory = false) {
    const directory = this.directory(id2);
    if (this.exists(id2)) return this.profile(id2);
    if (this.ids().length >= 256) throw new VoiceError("client_limit", "\u5BA2\u6237\u7AEF\u6570\u91CF\u8FBE\u5230\u4E0A\u9650");
    mkdirSync4(directory, { recursive: true, mode: 448 });
    mkdirSync4(join(directory, "workspace"), { recursive: true, mode: 448 });
    const config = pick(this.template()), model = this.model();
    if (!config.llmProvider && !config.llmModel && model) {
      config.llmProvider = model.provider;
      config.llmModel = model.model;
    }
    const now = Date.now(), profile = { id: id2, label: label.trim().slice(0, 64) || id2, createdAt: now, updatedAt: now, memoryEpoch: legacyHistory ? "legacy" : randomUUID3(), legacyHistory, previousEpochs: [], config };
    write(join(directory, "profile.json"), profile);
    return structuredClone(profile);
  }
  ids() {
    return readdirSync(this.root).filter((id2) => identifier(id2, 48) && this.exists(id2));
  }
  profile(id2) {
    const raw = JSON.parse(readFileSync4(join(this.directory(id2), "profile.json"), "utf8"));
    if (raw?.id !== id2 || !raw.config || typeof raw.memoryEpoch !== "string" || !Array.isArray(raw.previousEpochs) || typeof raw.label !== "string") throw new Error("invalid client profile; refusing to reset it");
    const { settings, rejected } = mergeSettings(DEFAULT_SETTINGS, raw.config);
    if (rejected.length) throw new Error("invalid client settings; refusing to reset them");
    return { ...raw, config: pick(settings) };
  }
  list() {
    return this.ids().map((id2) => {
      const p = this.profile(id2);
      return { deviceId: id2, label: p.label, createdAt: p.createdAt, updatedAt: p.updatedAt, hasMemory: this.memory(id2).items.length > 0, conversationCount: this.conversations(id2).length };
    }).sort((a, b) => a.createdAt - b.createdAt);
  }
  settings(id2) {
    return { ...DEFAULT_SETTINGS, ...this.profile(id2).config, deviceTokens: {}, allowedOrigins: [] };
  }
  view(id2) {
    const profile = this.profile(id2), masked = maskSettings(this.settings(id2));
    return { deviceId: id2, label: profile.label, settings: { ...Object.fromEntries(CLIENT_FIELDS.filter((key) => key !== "minimaxApiKey").map((key) => [key, masked[key]])), minimaxApiKey: "", hasMinimaxApiKey: masked.hasMinimaxApiKey }, memory: this.memory(id2), conversations: this.conversations(id2).map((c) => ({ ...c, archived: c.epoch !== profile.memoryEpoch })), canRestore: profile.previousEpochs.length > 0 };
  }
  update(id2, patch) {
    const p = this.profile(id2), allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => CLIENT_FIELDS.includes(key)));
    const { settings, rejected } = mergeSettings({ ...DEFAULT_SETTINGS, ...p.config }, allowed);
    for (const key of Object.keys(patch)) if (!CLIENT_FIELDS.includes(key)) rejected.push(key);
    if (Boolean(settings.llmProvider) !== Boolean(settings.llmModel)) {
      for (const key of ["llmProvider", "llmModel"]) if (key in patch) rejected.push(key);
      settings.llmProvider = p.config.llmProvider;
      settings.llmModel = p.config.llmModel;
    }
    write(join(this.directory(id2), "profile.json"), { ...p, config: pick(settings), updatedAt: Date.now() });
    return { settings: this.view(id2).settings, rejected: [...new Set(rejected)] };
  }
  memory(id2) {
    this.profile(id2);
    const path = join(this.directory(id2), "memory.json");
    if (!existsSync4(path)) return { revision: 0, updatedAt: 0, items: [] };
    const doc = JSON.parse(readFileSync4(path, "utf8"));
    if (!Number.isSafeInteger(doc?.revision) || !Array.isArray(doc.items) || doc.items.length > 32 || doc.items.some((i) => !identifier(i.id) || typeof i.text !== "string" || i.text.length > 1e3) || doc.items.reduce((n, i) => n + i.text.length, 0) > 8e3) throw new Error("invalid client memory; refusing to reset it");
    return doc;
  }
  saveMemory(id2, previous, items) {
    if (items.length > 32 || items.reduce((n, i) => n + i.text.length, 0) > 8e3) throw new VoiceError("memory_full", "\u957F\u671F\u8BB0\u5FC6\u6700\u591A 32 \u6761\u3001\u5171 8000 \u5B57\uFF0C\u8BF7\u6574\u7406\u540E\u518D\u4FDD\u5B58");
    const next = { revision: previous.revision + 1, updatedAt: Date.now(), items };
    write(join(this.directory(id2), "memory.json"), next);
    return next;
  }
  replaceMemory(id2, text2, revision) {
    if (typeof text2 !== "string" || text2.length > 8032) throw new VoiceError("bad_memory", "\u8BB0\u5FC6\u5185\u5BB9\u683C\u5F0F\u6216\u957F\u5EA6\u4E0D\u6B63\u786E");
    const old = this.memory(id2);
    if (revision !== old.revision) throw new VoiceError("memory_conflict", "\u8BB0\u5FC6\u5DF2\u88AB\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u540E\u518D\u4FDD\u5B58");
    const lines = [...new Set(text2.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
    if (lines.some((s) => s.length > 1e3)) throw new VoiceError("bad_memory", "\u6BCF\u6761\u8BB0\u5FC6\u6700\u591A 1000 \u5B57");
    return this.saveMemory(id2, old, lines.map((text3) => old.items.find((i) => i.text === text3) ?? { id: randomUUID3(), text: text3, createdAt: Date.now() }));
  }
  remember(id2, text2) {
    if (typeof text2 !== "string" || !text2.trim() || text2.length > 1e3) throw new VoiceError("bad_memory", "\u8BB0\u5FC6\u9700\u4E3A 1\u20131000 \u5B57\u7684\u6587\u672C");
    const value = text2.trim().replace(/\s*\n\s*/g, " "), old = this.memory(id2);
    return old.items.some((i) => i.text === value) ? old : this.saveMemory(id2, old, [...old.items, { id: randomUUID3(), text: value, createdAt: Date.now() }]);
  }
  forget(id2, itemId) {
    const old = this.memory(id2);
    if (typeof itemId !== "string" || !old.items.some((i) => i.id === itemId)) throw new VoiceError("memory_missing", "\u5F53\u524D\u5BA2\u6237\u7AEF\u6CA1\u6709\u8FD9\u6761\u8BB0\u5FC6");
    return this.saveMemory(id2, old, old.items.filter((i) => i.id !== itemId));
  }
  conversations(id2) {
    const path = join(this.directory(id2), "conversations.json");
    if (!existsSync4(path)) return [];
    const rows = JSON.parse(readFileSync4(path, "utf8"));
    if (!Array.isArray(rows) || rows.length > 256) throw new Error("invalid client conversation index");
    return rows;
  }
  touch(id2, conversationId, preset, sessionId) {
    const profile = this.profile(id2), rows = this.conversations(id2), key = (r) => r.conversationId === conversationId && r.preset === preset && r.epoch === profile.memoryEpoch;
    const next = rows.filter((r) => !key(r));
    next.push({ conversationId, preset, sessionId, updatedAt: Date.now(), epoch: profile.memoryEpoch });
    if (next.length > 256) next.splice(0, next.length - 256);
    write(join(this.directory(id2), "conversations.json"), next);
  }
  resetContext(id2, restore = false) {
    const p = this.profile(id2), previous = [...p.previousEpochs], epoch = restore ? previous.pop() : randomUUID3();
    if (!epoch) throw new VoiceError("no_archive", "\u6CA1\u6709\u53EF\u6062\u590D\u7684\u5BF9\u8BDD\u5F52\u6863");
    if (!restore) previous.push(p.memoryEpoch);
    write(join(this.directory(id2), "profile.json"), { ...p, memoryEpoch: epoch, previousEpochs: previous.slice(-16), updatedAt: Date.now() });
    return this.view(id2);
  }
};

// src/server.ts
var VERSION = "0.5.0";
var BODY_LIMIT = 32 * 1024;
var WS_PATH = "/voice";
var VoiceServer = class _VoiceServer {
  store;
  bridge;
  config;
  log;
  httpServer;
  wss;
  connections = /* @__PURE__ */ new Set();
  startedAt = 0;
  heartbeat;
  identities = /* @__PURE__ */ new Map();
  devices = /* @__PURE__ */ new Map();
  conversationOwners = /* @__PURE__ */ Object.create(null);
  ownersPath;
  surface;
  clientStore;
  clientSurfaces = /* @__PURE__ */ new Map();
  presetsCache = { at: 0, value: void 0 };
  constructor(store, bridge, config, log) {
    this.store = store;
    this.bridge = bridge;
    this.config = config;
    this.log = log;
    this.ownersPath = resolve2(dirname4(store.path), "conversations.json");
    this.surface = new SurfaceStore(resolve2(dirname4(store.path), "ui.json"));
    if (existsSync5(this.ownersPath)) {
      const raw = JSON.parse(readFileSync5(this.ownersPath, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid conversation registry");
      this.conversationOwners = Object.assign(/* @__PURE__ */ Object.create(null), raw);
    }
    this.clientStore = new ClientStore(resolve2(dirname4(store.path), "clients"), () => store.get(), () => bridge.currentModel());
    this.bridge.configureLegacyOwner?.((conversation) => this.conversationOwners[conversation]);
    for (const id2 of [...Object.keys(store.get().deviceTokens), store.get().legacyDeviceId].filter(Boolean)) this.ensureClient(id2);
  }
  start() {
    return new Promise((resolve4, reject) => {
      const httpServer = createServer((req, res) => {
        void this.handleRest(req, res).catch((e) => {
          this.log("warn", `REST failed: ${e instanceof Error ? e.message : String(e)}`);
          if (!res.headersSent) json(res, 500, { ok: false, error: "internal_error" });
          else res.end();
        });
      });
      const wss = new import_websocket_server.default({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
      this.httpServer = httpServer;
      this.wss = wss;
      httpServer.requestTimeout = 15e3;
      httpServer.headersTimeout = 15e3;
      httpServer.on("upgrade", (req, socket, head) => {
        const url = parseUrl(req);
        if (url?.pathname !== WS_PATH) {
          socket.destroy();
          return;
        }
        if (!this.authorize(url) || !this.originAllowed(req) || this.connections.size >= 64) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      });
      const alive = /* @__PURE__ */ new WeakSet();
      wss.on("connection", (ws, req) => {
        const connection = new VoiceConnection(ws, {
          settings: (id2) => id2 ? this.clientStore.settings(id2) : this.store.get(),
          bridge: this.bridge,
          surface: this.surface,
          log: this.log,
          claimDevice: (deviceId) => {
            const identity = this.identities.get(connection);
            if (!identity || identity.deviceId && identity.deviceId !== deviceId || this.devices.has(deviceId) || !this.claimConversation(deviceId, deviceId)) return false;
            if (identity.legacy) {
              if (!this.store.claimLegacy(deviceId)) return false;
              identity.deviceId = deviceId;
            }
            this.ensureClient(deviceId);
            this.devices.set(deviceId, connection);
            return true;
          },
          allowConversation: (deviceId, conversationId) => this.claimConversation(deviceId, conversationId),
          scope: (deviceId, conversationId, preset) => this.scopeFor(deviceId, conversationId, preset),
          memory: (deviceId) => ({ read: () => this.clientStore.memory(deviceId), remember: (text2) => this.clientStore.remember(deviceId, text2), forget: (id2) => this.clientStore.forget(deviceId, id2) }),
          epoch: (deviceId) => this.clientStore.profile(deviceId).memoryEpoch,
          surfaceForDevice: (deviceId) => {
            let surface = this.clientSurfaces.get(deviceId);
            if (!surface) {
              const path = join2(this.clientStore.directory(deviceId), "ui.json");
              surface = this.clientStore.profile(deviceId).legacyHistory ? this.surface.migrateClient(deviceId, path) : new SurfaceStore(path);
              this.clientSurfaces.set(deviceId, surface);
            }
            return surface;
          },
          onSession: (id2, conversation, preset, session) => this.clientStore.touch(id2, conversation, preset, session)
        });
        this.connections.add(connection);
        this.identities.set(connection, this.authorize(parseUrl(req)));
        alive.add(ws);
        const helloTimer = setTimeout(() => {
          if (connection.describe().state === "init") connection.close(1008, "hello timeout");
        }, 1e4);
        ws.on("pong", () => alive.add(ws));
        ws.on("message", (data, isBinary) => {
          const identity = this.identities.get(connection);
          if (!identity || !this.validIdentity(identity)) {
            connection.close(1008, "credential revoked");
            return;
          }
          if (isBinary) {
            connection.handleBinary(data);
          } else {
            connection.handleMessage(data.toString("utf8"));
          }
        });
        ws.on("close", () => {
          this.connections.delete(connection);
          clearTimeout(helloTimer);
          this.identities.delete(connection);
          if (this.devices.get(connection.deviceId) === connection) this.devices.delete(connection.deviceId);
          connection.handleClosed();
        });
        ws.on("error", () => {
        });
      });
      this.heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (!alive.has(ws)) {
            ws.terminate();
            continue;
          }
          alive.delete(ws);
          ws.ping();
        }
      }, 3e4);
      this.heartbeat.unref();
      httpServer.once("error", reject);
      httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer = httpServer;
        this.wss = wss;
        this.startedAt = Date.now();
        const tokenState = this.store.get().token === "" ? "registered devices only" : "device token";
        this.log("info", `listening on ws://${this.config.host}:${this.config.port}${WS_PATH} (${tokenState})`);
        resolve4();
      });
    });
  }
  stop() {
    clearInterval(this.heartbeat);
    for (const connection of this.connections) connection.close();
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.connections.clear();
    this.wss?.close();
    this.httpServer?.close();
    this.wss = void 0;
    this.httpServer = void 0;
  }
  /** Only the authenticated dsh owner route calls this; the admin credential stays server-side. */
  async managementRequest(path, method, body, signal) {
    const address = this.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("voice listener unavailable");
    const host = address.address === "0.0.0.0" ? "127.0.0.1" : address.address === "::" ? "::1" : address.address;
    const base = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-voice-token": this.store.get().adminToken },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65e3)]) : AbortSignal.timeout(65e3)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
  authorize(url) {
    const settings = this.store.get();
    const provided = url.searchParams.get("token") ?? "";
    if (secureEqual(provided, settings.token)) return { token: provided, legacy: true, ...settings.legacyDeviceId ? { deviceId: settings.legacyDeviceId } : {} };
    for (const [deviceId, token] of Object.entries(settings.deviceTokens)) if (secureEqual(provided, token)) return { token: provided, deviceId };
    return void 0;
  }
  validIdentity(identity) {
    const settings = this.store.get();
    return identity.legacy ? secureEqual(identity.token, settings.token) && (!identity.deviceId || identity.deviceId === settings.legacyDeviceId) : secureEqual(identity.token, identity.deviceId ? settings.deviceTokens[identity.deviceId] : "");
  }
  originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = this.store.get().allowedOrigins;
    if (allowed.length) return allowed.includes(origin);
    try {
      return new URL(origin).hostname === new URL(`http://${req.headers.host}`).hostname && /^https?:/.test(origin);
    } catch {
      return false;
    }
  }
  claimConversation(deviceId, conversationId) {
    return identifier(deviceId, 48) && identifier(conversationId);
  }
  ensureClient(id2, label = "") {
    return this.clientStore.ensure(id2, label, Object.values(this.conversationOwners).includes(id2));
  }
  scopeFor(id2, conversation, _preset, diagnostic = false) {
    const p = this.clientStore.profile(id2), conversationKey = diagnostic ? "diagnostic:" + conversation : conversation;
    const options = { cwd: join2(this.clientStore.directory(id2), "workspace"), indexPath: join2(this.clientStore.directory(id2), "sessions.json"), model: { provider: p.config.llmProvider, model: p.config.llmModel }, legacy: !diagnostic && p.legacyHistory };
    return this.bridge.clientScope?.(id2, conversationKey, p.memoryEpoch, options) ?? "c-" + createHash3("sha256").update(JSON.stringify([id2, conversationKey, p.memoryEpoch])).digest("hex").slice(0, 48);
  }
  // ---- REST ----
  static applyCors(req, res) {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "") res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "content-type, x-voice-token");
    res.setHeader("access-control-max-age", "600");
  }
  tokenOf(req, url) {
    const header = req.headers["x-voice-token"];
    return (typeof header === "string" ? header : void 0) ?? url.searchParams.get("token") ?? "";
  }
  async handleRest(req, res) {
    if (!this.originAllowed(req)) {
      json(res, 403, { ok: false, error: "origin_denied" });
      return;
    }
    _VoiceServer.applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = parseUrl(req);
    if (url === void 0) {
      res.writeHead(400).end();
      return;
    }
    const assets = { "/demo": ["examples/avatar-client.html", "text/html; charset=utf-8"], "/demo-client.js": ["lib/demo-client.js", "text/javascript; charset=utf-8"], "/voice-client.js": ["lib/voice-client.js", "text/javascript; charset=utf-8"] };
    if (req.method === "GET" && Object.hasOwn(assets, url.pathname)) {
      const [path, type] = assets[url.pathname];
      res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(readFileSync5(resolve2(this.config.assetsRoot ?? fileURLToPath(new URL("..", import.meta.url)), path)));
      return;
    }
    const token = this.store.get().adminToken;
    if (!secureEqual(this.tokenOf(req, url), token)) {
      json(res, 401, { ok: false, error: "unauthorized", message: "\u8BF7\u586B\u5199\u670D\u52A1\u5668 settings.json \u4E2D\u7684 adminToken\uFF1B\u8BBE\u5907\u4EE4\u724C\u4E0D\u5177\u5907\u7BA1\u7406\u6743\u9650" });
      return;
    }
    const route = `${req.method} ${url.pathname}`;
    if (url.pathname === "/clients" || url.pathname.startsWith("/clients/")) {
      await this.handleClientRoute(req, res, url);
      return;
    }
    switch (route) {
      case "GET /status":
        this.refreshPresets();
        this.handleStatus(res);
        return;
      case "GET /settings":
        json(res, 200, { ok: true, scope: "new-client-template", settings: maskSettings(this.store.get()) });
        return;
      case "PUT /settings":
        await this.handlePutSettings(req, res);
        return;
      case "POST /token":
        json(res, 200, { ok: true, token: this.store.regenerateToken() });
        this.closeRevoked();
        return;
      case "POST /devices": {
        const body = await readBody(req);
        if (body === null) {
          json(res, 413, { ok: false, error: "too_large" });
          return;
        }
        let patch;
        try {
          patch = JSON.parse(body);
        } catch {
          json(res, 400, { ok: false, error: "bad_json" });
          return;
        }
        if (!identifier(patch?.deviceId, 48)) {
          json(res, 400, { ok: false, error: "bad_device_id" });
          return;
        }
        if (patch.label !== void 0 && (typeof patch.label !== "string" || patch.label.length > 64)) {
          json(res, 400, { ok: false, error: "bad_label" });
          return;
        }
        this.ensureClient(patch.deviceId, patch.label);
        const deviceToken = this.store.issueDevice(patch.deviceId);
        this.closeRevoked();
        json(res, 200, { ok: true, deviceId: patch.deviceId, token: deviceToken });
        return;
      }
      case "POST /test/asr":
        await this.handleTestAsr(res);
        return;
      case "POST /test/tts":
        await this.handleTestTts(res);
        return;
      case "POST /test/llm":
        await this.handleTestLlm(res);
        return;
      default:
        if (req.method === "DELETE" && url.pathname.startsWith("/devices/")) {
          this.store.revokeDevice(decodeURIComponent(url.pathname.slice("/devices/".length)));
          this.closeRevoked();
          json(res, 200, { ok: true });
          return;
        }
        json(res, 404, { ok: false, error: "not_found" });
    }
  }
  handleStatus(res) {
    const settings = this.store.get();
    const model = this.bridge.currentModel();
    const presets = this.presetsCache.value;
    const address = this.httpServer?.address();
    const port = address && typeof address !== "string" ? address.port : this.config.port;
    json(res, 200, {
      ok: true,
      service: "dsh-yusheng-voice",
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      supportedProtocols: SUPPORTED_VERSIONS,
      endpoint: `ws://${this.config.host.includes(":") ? `[${this.config.host}]` : this.config.host}:${port}${WS_PATH}`,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1e3),
      tokenConfigured: settings.token !== "",
      model,
      presets,
      hasMinimaxApiKey: settings.minimaxApiKey !== "",
      clients: [...this.connections].map((c) => c.describe()),
      settings: maskSettings(settings),
      clientProfiles: this.clientStore.list(),
      isolation: "client"
    });
  }
  /** 预设列表短暂缓存：compositionInventory 含逐项诊断，不宜每次状态轮询都跑。 */
  refreshPresets() {
    if (Date.now() - this.presetsCache.at < 1e4 && this.presetsCache.value !== void 0) return;
    this.presetsCache.at = Date.now();
    void this.bridge.listPresets().then((value) => {
      if (value !== void 0) this.presetsCache.value = value;
    }).catch(() => void 0);
  }
  async handlePutSettings(req, res) {
    const body = await readBody(req);
    if (body === null) {
      json(res, 413, { ok: false, error: "too_large" });
      return;
    }
    let patch;
    try {
      patch = JSON.parse(body === "" ? "{}" : body);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("invalid object");
    } catch {
      json(res, 400, { ok: false, error: "bad_json" });
      return;
    }
    const { settings, rejected } = this.store.update(patch);
    this.closeRevoked();
    this.log("info", `settings updated${rejected.length > 0 ? ` (rejected: ${rejected.join(", ")})` : ""}`);
    json(res, 200, { ok: true, rejected, settings: maskSettings(settings) });
  }
  /** 1 秒静音 WAV 走一遍真实 ASR 调用验证凭据与连通性。 */
  async handleTestAsr(res, settings = this.store.get()) {
    const started = Date.now();
    const silence = Buffer8.alloc(TTS_SAMPLE_RATE * 2, 0);
    try {
      const text2 = await transcribePcm(silence.subarray(0, 16e3 * 2), { apiKey: settings.minimaxApiKey, model: settings.asrModel });
      json(res, 200, { ok: true, durationMs: Date.now() - started, note: "ASR \u8C03\u7528\u6210\u529F", text: text2 });
    } catch (error) {
      const code = error instanceof AsrError ? error.code : "asr_failed";
      const message = error instanceof Error ? error.message : String(error);
      json(res, 200, { ok: false, durationMs: Date.now() - started, code, message });
    }
  }
  /** 合成「你好」验证 TTS 凭据与连通性（不回传音频）。 */
  async handleTestTts(res, settings = this.store.get()) {
    const started = Date.now();
    let bytes = 0;
    try {
      for await (const chunk of synthesizeStream("\u4F60\u597D\u3002", {
        apiKey: settings.minimaxApiKey,
        model: settings.ttsModel,
        voiceId: settings.ttsVoice,
        speed: settings.ttsSpeed,
        vol: settings.ttsVol,
        pitch: settings.ttsPitch,
        signal: AbortSignal.timeout(2e4)
      })) {
        bytes += chunk.length;
      }
      json(res, 200, { ok: bytes > 0, durationMs: Date.now() - started, bytes, message: bytes > 0 ? "TTS \u5408\u6210\u6210\u529F" : "\u672A\u6536\u5230\u97F3\u9891\u6570\u636E" });
    } catch (error) {
      const code = error instanceof TtsError ? error.code : "tts_failed";
      const message = error instanceof Error ? error.message : String(error);
      json(res, 200, { ok: false, durationMs: Date.now() - started, code, message });
    }
  }
  /** 复用固定自检会话跑一轮「回复 OK」，验证 dsh 会话链路与模型凭据。 */
  async handleTestLlm(res, settings = this.store.get(), scope = "selftest") {
    const started = Date.now();
    let gotDelta = false;
    try {
      const turn = await this.bridge.turn(scope, "Reply with exactly: OK", {
        onTextDelta: () => {
          gotDelta = true;
        },
        onEnd: () => void 0
      }, settings.agentPreset, { signal: AbortSignal.timeout(3e4), persona: settings, promptPrefix: settings.promptPrefix });
      const outcome = await turn.done;
      json(res, 200, {
        ok: outcome.kind === "completed",
        durationMs: Date.now() - started,
        kind: outcome.kind,
        gotDelta,
        error: outcome.error,
        message: outcome.kind === "completed" ? "dsh \u4F1A\u8BDD\u8C03\u7528\u6210\u529F" : outcome.error ?? outcome.kind
      });
    } catch (error) {
      json(res, 200, {
        ok: false,
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  async handleClientRoute(req, res, url) {
    try {
      if (url.pathname === "/clients" && req.method === "GET") {
        json(res, 200, { ok: true, clients: this.clientStore.list().map((c) => ({ ...c, credentialConfigured: Object.hasOwn(this.store.get().deviceTokens, c.deviceId) || !!this.store.get().token && this.store.get().legacyDeviceId === c.deviceId })) });
        return;
      }
      const match = /^\/clients\/([A-Za-z0-9_-]{1,48})(?:\/(settings|memory|conversations|context\/(?:reset|restore)|test\/(?:asr|tts|llm)))?$/.exec(url.pathname);
      if (!match || !this.clientStore.exists(match[1])) {
        json(res, 404, { ok: false, error: "client_not_found", message: "\u5BA2\u6237\u7AEF\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u521B\u5EFA\u5BA2\u6237\u7AEF" });
        return;
      }
      const [, id2, resource] = match, settings = this.clientStore.settings(id2);
      if (req.method === "GET") {
        if (!resource) {
          json(res, 200, { ok: true, ...this.clientStore.view(id2) });
          return;
        }
        if (resource === "settings") {
          json(res, 200, { ok: true, deviceId: id2, settings: this.clientStore.view(id2).settings });
          return;
        }
        if (resource === "memory") {
          json(res, 200, { ok: true, deviceId: id2, memory: this.clientStore.memory(id2) });
          return;
        }
        if (resource === "conversations") {
          json(res, 200, { ok: true, deviceId: id2, conversations: this.clientStore.conversations(id2) });
          return;
        }
      }
      if (req.method === "PUT" && (resource === "settings" || resource === "memory")) {
        const body = await readBody(req);
        if (body === null) {
          json(res, 413, { ok: false, error: "too_large" });
          return;
        }
        let patch;
        try {
          patch = JSON.parse(body);
        } catch {
          throw new VoiceError("bad_json", "\u8BF7\u6C42\u4E0D\u662F\u5408\u6CD5 JSON");
        }
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new VoiceError("bad_request", "\u8BF7\u6C42\u9700\u4E3A JSON \u5BF9\u8C61");
        if (resource === "settings") {
          json(res, 200, { ok: true, deviceId: id2, ...this.clientStore.update(id2, patch) });
          return;
        }
        if (Object.keys(patch).some((k) => !["text", "revision"].includes(k))) throw new VoiceError("bad_memory", "\u8BB0\u5FC6\u53C2\u6570\u4E0D\u6B63\u786E");
        json(res, 200, { ok: true, deviceId: id2, memory: this.clientStore.replaceMemory(id2, patch.text, patch.revision) });
        return;
      }
      if (req.method === "POST" && resource?.startsWith("context/")) {
        if ([...this.connections].some((c) => c.deviceId === id2 && ["busy", "listening"].includes(c.describe().state))) {
          json(res, 409, { ok: false, error: "client_busy", message: "\u8BF7\u7B49\u5F85\u6B64\u5BA2\u6237\u7AEF\u5F53\u524D\u8F6E\u6B21\u7ED3\u675F\u540E\u518D\u91CD\u7F6E\u5BF9\u8BDD" });
          return;
        }
        const view = this.clientStore.resetContext(id2, resource === "context/restore");
        for (const c of this.connections) if (c.deviceId === id2) c.close(1e3, "client context changed");
        json(res, 200, { ok: true, ...view });
        return;
      }
      if (req.method === "POST" && resource?.startsWith("test/")) {
        if (resource === "test/asr") await this.handleTestAsr(res, settings);
        else if (resource === "test/tts") await this.handleTestTts(res, settings);
        else await this.handleTestLlm(res, settings, this.scopeFor(id2, "health", settings.agentPreset, true));
        return;
      }
      json(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      if (error instanceof VoiceError) {
        json(res, error.code === "memory_conflict" ? 409 : 400, { ok: false, error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  }
  closeRevoked() {
    for (const [connection, identity] of this.identities) if (!this.validIdentity(identity)) connection.close(1008, "credential revoked");
  }
};
function secureEqual(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) return false;
  const a = Buffer8.from(provided), b = Buffer8.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function parseUrl(req) {
  const raw = req.url;
  if (typeof raw !== "string") return void 0;
  const host = typeof req.headers.host === "string" ? req.headers.host : "localhost";
  try {
    return new URL(raw, `http://${host}`);
  } catch {
    return void 0;
  }
}
function readBody(req) {
  return new Promise((resolve4) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve4(value);
      }
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer8.concat(chunks).toString("utf8")));
    req.on("error", () => finish(null));
    req.on("aborted", () => finish(null));
  });
}
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

// src/management.ts
var MANAGEMENT_PATH = "/api/yusheng-voice/manage";
var LIMIT = 32 * 1024;
var OPERATIONS = /* @__PURE__ */ new Set(["GET /status", "GET /settings", "PUT /settings", "GET /clients", "POST /devices", "POST /token", "POST /test/asr", "POST /test/tts", "POST /test/llm"]);
function clientOperation(method, path) {
  if (method === "GET") return /^\/clients\/[A-Za-z0-9_-]{1,48}(?:\/(settings|memory|conversations))?$/.test(path);
  if (method === "PUT") return /^\/clients\/[A-Za-z0-9_-]{1,48}\/(settings|memory)$/.test(path);
  return method === "POST" && /^\/clients\/[A-Za-z0-9_-]{1,48}\/(context\/(reset|restore)|test\/(asr|tts|llm))$/.test(path);
}
function reply(status, error, message) {
  return Response.json({ ok: false, error, message }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...status === 413 ? { connection: "close" } : {} } });
}
function registerManagement(ctx, server) {
  return ctx.connection.fetch.register({
    path: MANAGEMENT_PATH,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: (request) => handleManagement(request, server)
  });
}
async function handleManagement(request, server) {
  if (request.method !== "POST") return reply(405, "method_not_allowed", "\u8BF7\u4F7F\u7528 POST \u8BF7\u6C42\u7BA1\u7406\u63A5\u53E3\u3002");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply(415, "json_required", "\u7BA1\u7406\u8BF7\u6C42\u5FC5\u987B\u4F7F\u7528 JSON\u3002");
  if (Number(request.headers.get("content-length")) > LIMIT) return reply(413, "too_large", "\u7BA1\u7406\u8BF7\u6C42\u8FC7\u5927\u3002");
  const reader = request.body?.getReader(), chunks = [];
  let size = 0;
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) return reply(413, "too_large", "\u7BA1\u7406\u8BF7\u6C42\u8FC7\u5927\u3002");
      chunks.push(value);
    }
  } catch {
    return reply(400, "bad_body", "\u65E0\u6CD5\u8BFB\u53D6\u7BA1\u7406\u8BF7\u6C42\u3002");
  } finally {
    reader?.releaseLock();
  }
  let envelope;
  try {
    envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return reply(400, "bad_json", "\u7BA1\u7406\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).some((key) => !["path", "method", "body"].includes(key))) return reply(400, "bad_request", "\u7BA1\u7406\u8BF7\u6C42\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
  const { path, method, body } = envelope;
  if (typeof path !== "string" || typeof method !== "string" || !OPERATIONS.has(`${method} ${path}`) && !clientOperation(method, path) && !(method === "DELETE" && /^\/devices\/[A-Za-z0-9_-]{1,48}$/.test(path))) return reply(400, "unsupported_operation", "\u4E0D\u652F\u6301\u7684\u7BA1\u7406\u64CD\u4F5C\u3002");
  if ((method === "GET" || method === "DELETE") && body !== void 0) return reply(400, "bad_request", "\u6B64\u64CD\u4F5C\u4E0D\u63A5\u53D7\u8BF7\u6C42\u5185\u5BB9\u3002");
  try {
    return await server.managementRequest(path, method, body, request.signal);
  } catch {
    return reply(503, "voice_unavailable", "\u8BED\u97F3\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
  }
}

// src/index.ts
var CONFIG_KEYS = /* @__PURE__ */ new Set(["host", "port", "settingsPath"]);
function clampPort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 8090;
  return n;
}
var index_default = {
  name: "yusheng-voice",
  inject: ["agentDefaultModel", "agents", "sessions", "sessionQuery", "agentPresets", "permissionPresets", "systemPrompt"],
  apply(root, config = {}) {
    const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
    if (unknown.length > 0) {
      throw new Error(`yusheng-voice: unknown config fields: ${unknown.join(", ")}`);
    }
    const host = typeof config.host === "string" && config.host !== "" ? config.host : "0.0.0.0";
    const port = clampPort(config.port);
    const settingsPath = typeof config.settingsPath === "string" && config.settingsPath !== "" ? config.settingsPath : defaultSettingsPath();
    const store = new SettingsStore(settingsPath);
    const log = (level, message) => {
      try {
        if (typeof root.logger?.[level] === "function") root.logger[level](`yusheng-voice: ${message}`);
        else console[level](`yusheng-voice: ${message}`);
      } catch {
      }
    };
    const bridge = new AgentBridge(root, resolve3(dirname5(settingsPath), "sessions.json"));
    const server = new VoiceServer(store, bridge, { host, port }, log);
    root.inject?.(["connection"], (ctx) => {
      ctx.effect(() => registerManagement(ctx, server), "yusheng-voice: authenticated management");
    });
    let disposed = false;
    root.effect(() => () => {
      disposed = true;
      return server.stop();
    }, "yusheng-voice: server");
    server.start().then(async () => {
      if (disposed) await server.stop();
    }).then(() => {
      log("info", `REST uses a separate adminToken stored in ${settingsPath}`);
    }).catch((error) => {
      log("warn", `voice server failed to start on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
};
export {
  index_default as default
};
