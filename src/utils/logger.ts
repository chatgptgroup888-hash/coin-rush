type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  // Structured JSON logs — easy to ship to CloudWatch / any log aggregator
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') log('debug', msg, meta);
  },
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
