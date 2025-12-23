#!/usr/bin/env node
import 'dotenv/config';
import readline from 'readline';
import { parseCommand, getHelpText } from '@poly-trader/shared';

const API_URL = process.env.BOT_API_URL || 'http://localhost:3001';
const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || 'polytrader';

const authHeader = `Basic ${Buffer.from(`${DASH_USER}:${DASH_PASS}`).toString('base64')}`;

async function sendCommand(command: string): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({ command }),
    });

    const result = await response.json() as { success: boolean; message: string };

    if (result.success) {
      console.log('\n' + result.message);
    } else {
      console.log('\n❌ ' + result.message);
    }
  } catch (err) {
    console.log('\n❌ Connection error: ' + (err as Error).message);
    console.log('   Make sure the bot server is running on ' + API_URL);
  }
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   ██████╗  ██████╗ ██╗  ██╗   ██╗    ████████╗██████╗  █████╗    ║
║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝    ╚══██╔══╝██╔══██╗██╔══██╗   ║
║   ██████╔╝██║   ██║██║   ╚████╔╝        ██║   ██████╔╝███████║   ║
║   ██╔═══╝ ██║   ██║██║    ╚██╔╝         ██║   ██╔══██╗██╔══██║   ║
║   ██║     ╚██████╔╝███████╗██║          ██║   ██║  ██║██║  ██║   ║
║   ╚═╝      ╚═════╝ ╚══════╝╚═╝          ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ║
║                                                                   ║
║         Polymarket Paper Trading Bot - CLI Interface              ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝

Type "help" for available commands. Type "exit" to quit.
Connecting to: ${API_URL}
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n💹 poly> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('\nGoodbye! 👋\n');
      process.exit(0);
    }

    // Handle help locally for faster response
    if (input.toLowerCase() === 'help') {
      console.log('\n' + getHelpText());
      rl.prompt();
      return;
    }

    await sendCommand(input);
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye! 👋\n');
    process.exit(0);
  });
}

main().catch(console.error);

