import { encode } from "@toon-format/toon";

export function commandRows(commands: string[]): Array<{ command: string }> {
  return commands.map((command) => ({ command }));
}

export function nextActions(commands: string[]): Array<{ command: string }> {
  return commandRows(commands);
}

/**
 * Preserve canonical TOON structure while adding one inexpensive blank line
 * between root fields. Arrays and nested objects retain their normal two-space
 * indentation, so multi-row data stays compact and unambiguous.
 */
export function renderSections(value: Record<string, unknown>): string {
  const lines = encode(value).split("\n");
  const output: string[] = [];
  let sawRootField = false;

  for (const line of lines) {
    const isRootField = line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t");
    if (isRootField && sawRootField) output.push("");
    if (isRootField) sawRootField = true;
    output.push(line);
  }
  return output.join("\n");
}
