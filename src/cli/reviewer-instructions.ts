import { readFileSync } from 'node:fs';

/**
 * `--instructions` or `--instructions-file`: the engineer's own guidance for
 * the model, or null when neither was given. Throws a message fit for a usage
 * error.
 */
export function reviewerInstructions(
  text: string | undefined,
  file: string | undefined,
): string | null {
  if (text !== undefined && file !== undefined) {
    throw new Error('--instructions and --instructions-file cannot be combined');
  }
  if (text === undefined && file === undefined) return null;
  const flag = file === undefined ? '--instructions' : '--instructions-file';
  const instructions = (text ?? readInstructionsFile(file!)).trim();
  if (instructions === '') throw new Error(`${flag} is empty`);
  return instructions;
}

function readInstructionsFile(file: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(`--instructions-file: ${(error as Error).message}`, { cause: error });
  }
  return decodeText(bytes, file);
}

/**
 * Windows PowerShell 5.1 writes UTF-16LE with a byte-order mark from `>` and
 * Out-File, so a file made the obvious way there is not UTF-8. Anything that
 * is neither is refused rather than handed to the model as mojibake.
 */
function decodeText(bytes: Uint8Array, file: string): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`--instructions-file: ${file} is not UTF-8 or UTF-16 text`);
  }
}
