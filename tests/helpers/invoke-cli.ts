import { createProgram } from '../../src/cli.js';

export class ProcessExitError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super(`process.exit(${exitCode})`);
    this.name = 'ProcessExitError';
    this.exitCode = exitCode;
  }
}

export interface InvokeCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InvokeCliOpts {
  cwd?: string;
  /**
   * Wait until the command calls `process.exit` (used by `tested run`,
   * which exits from a child-process callback after parseAsync returns).
   */
  waitForProcessExit?: boolean;
}

/**
 * Invoke the public CLI in-process (same style as the existing diff e2e).
 * Captures stdout/stderr and intercepts process.exit so the test runner lives.
 */
export async function invokeCli(
  argv: string[],
  opts: InvokeCliOpts = {},
): Promise<InvokeCliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  const realExit = process.exit;
  const realStdoutWrite = process.stdout.write;
  const realStderrWrite = process.stderr.write;

  let settleExit: (() => void) | undefined;
  const exitSeen = new Promise<void>((resolve) => {
    settleExit = resolve;
  });

  const capture =
    (chunks: string[]) =>
    ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      if (typeof encoding === 'function') (encoding as () => void)();
      if (typeof cb === 'function') (cb as () => void)();
      return true;
    }) as typeof process.stdout.write;

  process.exitCode = 0;
  if (opts.cwd) process.chdir(opts.cwd);
  process.stdout.write = capture(stdout);
  process.stderr.write = capture(stderr);
  process.exit = ((code?: number) => {
    process.exitCode = code ?? 0;
    settleExit?.();
    // Do not throw from async child-process callbacks (`tested run`).
    // Sync callers (`tested init` error path) finish the action after this.
    if (!opts.waitForProcessExit) {
      throw new ProcessExitError(code ?? 0);
    }
    return undefined as never;
  }) as typeof process.exit;

  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => {
      stdout.push(s);
    },
    writeErr: (s) => {
      stderr.push(s);
    },
  });

  try {
    await program.parseAsync(['node', 'tested', ...argv]);
    if (opts.waitForProcessExit) {
      await exitSeen;
    }
  } catch (err) {
    if (err instanceof ProcessExitError) {
      // Command called process.exit — treat as a normal CLI termination.
    } else if (
      err &&
      typeof err === 'object' &&
      'exitCode' in err &&
      typeof (err as { exitCode: unknown }).exitCode === 'number'
    ) {
      process.exitCode = (err as { exitCode: number }).exitCode;
    } else {
      throw err;
    }
  } finally {
    process.chdir(prevCwd);
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
    process.exit = realExit;
  }

  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  process.exitCode = prevExitCode;
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
}
