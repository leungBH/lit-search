import readline from 'node:readline';

export const consoleLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  startProgressList: (title, labels) => createConsoleProgressList(title, labels)
};

export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  startProgressList: () => null
};

export function resolveLogger(logger) {
  return logger || consoleLogger;
}

function createConsoleProgressList(title, labels) {
  const output = process.stdout;
  const isInteractive = output.isTTY && !process.env.CI;

  console.log(title);
  labels.forEach((label, index) => {
    console.log(formatProgressLine(index, label, '检索中...'));
  });

  if (!isInteractive) {
    return {
      update(index, status) {
        console.log(formatProgressLine(index, labels[index], status));
      },
      end() {}
    };
  }

  return {
    update(index, status) {
      const linesFromBottom = labels.length - index;
      readline.moveCursor(output, 0, -linesFromBottom);
      readline.cursorTo(output, 0);
      readline.clearLine(output, 0);
      output.write(formatProgressLine(index, labels[index], status));
      readline.moveCursor(output, 0, linesFromBottom);
      readline.cursorTo(output, 0);
    },
    end() {
      console.log('');
    }
  };
}

function formatProgressLine(index, label, status) {
  return `${index + 1}、${label} -> ${status}`;
}
