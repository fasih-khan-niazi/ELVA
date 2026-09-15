/**
 * Colored, consistent terminal output for ELVA backend startup and voice pipeline.
 */

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
};

export const terminalLog = {
    banner(title: string): void {
        const line = '═'.repeat(Math.max(20, title.length + 4));
        console.log(`\n${c.cyan}${c.bold}╔${line}╗${c.reset}`);
        console.log(`${c.cyan}${c.bold}║  ${title.padEnd(line.length - 2)}║${c.reset}`);
        console.log(`${c.cyan}${c.bold}╚${line}╝${c.reset}`);
    },

    ok(tag: string, message: string): void {
        console.log(`${c.green}✓${c.reset} ${c.bold}${tag}${c.reset} ${message}`);
    },

    warn(tag: string, message: string): void {
        console.log(`${c.yellow}⚠${c.reset} ${c.bold}${tag}${c.reset} ${message}`);
    },

    err(tag: string, message: string): void {
        console.log(`${c.red}✗${c.reset} ${c.bold}${tag}${c.reset} ${message}`);
    },

    info(tag: string, message: string): void {
        console.log(`${c.blue}●${c.reset} ${c.bold}${tag}${c.reset} ${message}`);
    },

    voice(tag: string, message: string): void {
        console.log(`${c.magenta}♪${c.reset} ${c.bold}${tag}${c.reset} ${message}`);
    },

    dim(message: string): void {
        console.log(`${c.dim}  ${message}${c.reset}`);
    },

    row(label: string, value: string, ok?: boolean): void {
        const icon = ok === true ? `${c.green}●${c.reset}` : ok === false ? `${c.red}●${c.reset}` : `${c.dim}○${c.reset}`;
        console.log(`  ${icon} ${c.dim}${label}:${c.reset} ${value}`);
    },
};
