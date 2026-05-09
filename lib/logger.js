export const consoleLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

export function resolveLogger(logger) {
  return logger || consoleLogger;
}
