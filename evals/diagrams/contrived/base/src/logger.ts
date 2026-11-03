export type Level = 'info' | 'warn' | 'error';

export type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields?: Fields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'info') process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

export const log = {
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
};

export function errorFields(error: unknown): Fields {
  if (error instanceof Error) return { error: error.message, kind: error.name };
  return { error: String(error) };
}
