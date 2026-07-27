export function formatCommandArgument(argument: string): string {
  if (argument.length > 0 && /^[A-Za-z0-9_./\\:@%+=,-]+$/.test(argument)) {
    return argument;
  }
  return `"${argument.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export function parseCommandArguments(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let tokenStarted = false;

  const pushCurrent = () => {
    if (tokenStarted) {
      args.push(current);
      current = "";
      tokenStarted = false;
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote === "'") {
      if (character === "'") {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }
    if (quote === "\"") {
      if (character === "\"") {
        quote = undefined;
      } else if (
        character === "\\" &&
        index + 1 < input.length &&
        ["\\", "\""].includes(input[index + 1])
      ) {
        current += input[index + 1];
        index += 1;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      pushCurrent();
    } else if (
      character === "\\" &&
      index + 1 < input.length &&
      (/[\s'"\\]/.test(input[index + 1]))
    ) {
      current += input[index + 1];
      tokenStarted = true;
      index += 1;
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  if (quote) {
    throw new Error("CLI arguments contain an unfinished quote.");
  }
  pushCurrent();
  if (args.length === 0) {
    throw new Error("Enter at least one CLI argument.");
  }
  return args;
}
