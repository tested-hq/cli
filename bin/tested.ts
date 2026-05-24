import { createProgram } from '../src/cli.js';

const program = createProgram();
await program.parseAsync(process.argv);
