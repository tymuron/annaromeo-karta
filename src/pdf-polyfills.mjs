/**
 * Компактные полифилы для работы legacy-сборки pdf.js 6.5 на iPhone с iOS 16.4–17.3
 * (в главном потоке и внутри модульного Web Worker).
 */

if (typeof Promise !== 'undefined' && typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new this((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof URL !== 'undefined' && typeof URL.parse !== 'function') {
  URL.parse = function parse(url, base) {
    try {
      return base !== undefined ? new URL(url, base) : new URL(url);
    } catch {
      return null;
    }
  };
}

if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = function hasOwn(obj, prop) {
    return Object.prototype.hasOwnProperty.call(Object(obj), prop);
  };
}

if (typeof Array !== 'undefined' && !Array.prototype.toSpliced) {
  Object.defineProperty(Array.prototype, 'toSpliced', {
    configurable: true,
    writable: true,
    value: function toSpliced(...args) {
      const copy = Array.from(this);
      copy.splice(...args);
      return copy;
    },
  });
}

if (typeof Array !== 'undefined' && !Array.prototype.findLast) {
  Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true,
    writable: true,
    value: function findLast(predicate, thisArg) {
      for (let i = this.length - 1; i >= 0; i--) {
        if (predicate.call(thisArg, this[i], i, this)) {
          return this[i];
        }
      }
      return undefined;
    },
  });
}
