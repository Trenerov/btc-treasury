const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: Level = 'debug';

function log(level: Level, message: string, ...args: unknown[]): void {
    if (LEVELS[level] < LEVELS[currentLevel]) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (level === 'error') {
        console.error(prefix, message, ...args);
    } else if (level === 'warn') {
        console.warn(prefix, message, ...args);
    } else {
        console.info(prefix, message, ...args);
    }
}

export const logger = {
    debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
    info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
    warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
    error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
};
