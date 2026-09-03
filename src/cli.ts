// Shared command-line parsing for both entrypoints (MCP server and TUI).

/**
 * The backlog path given on the command line as `--file <path>` or
 * `--file=<path>`, or undefined when the flag is absent. A `--file` with no
 * value is ignored rather than fatal — resolution falls through to the env
 * var, the project config, and the defaults, which is always a usable answer.
 *
 * `argv` is the raw list *after* node and the script (i.e. `process.argv.slice(2)`).
 */
export function parseFileArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--file') {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('-')) return value;
      continue;
    }
    if (arg.startsWith('--file=')) {
      const value = arg.slice('--file='.length);
      if (value.length > 0) return value;
    }
  }
  return undefined;
}
