/**
 * Interactive one-time provisioning for ELVA platform operators.
 * Usage (from backend/):  npx tsx scripts/bootstrap-platform-admin.ts
 * Creates (or resets password for) a user with role platform_admin: no tenant, local auth only.
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Writable } from 'node:stream';
import dotenv from 'dotenv';

dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../src/models/index';
import { validateStrongPassword } from '../src/utils/passwordPolicy';

/** Password prompt without echo (Node readline has no stable `questionPassword` on all LTS versions). */
async function questionHidden(query: string): Promise<string> {
    const sink = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });
    output.write(query);
    const rl = readline.createInterface({
        input,
        output: sink,
        terminal: true,
        historySize: 0,
    });
    try {
        return await rl.question('');
    } finally {
        await rl.close();
        output.write('\n');
    }
}

async function ensureMongo(): Promise<void> {
    const uri = process.env.MONGO_URI?.trim();
    if (!uri) {
        console.error('MONGO_URI is required in backend/.env');
        process.exit(1);
    }
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10_000,
    });
}

async function main() {
    await ensureMongo();
    console.log('[bootstrap] Connected to Mongo.\n');

    const rl = readline.createInterface({ input, output });
    let email = '';
    try {
        email = (await rl.question('Operator email (lowercased login): ')).trim().toLowerCase();
    } finally {
        await rl.close();
    }

    try {
        if (!email || !email.includes('@')) {
            console.error('Invalid email.');
            process.exitCode = 1;
            return;
        }

        const password = await questionHidden(
            'Password (never echoed). Same strength rules as sign-up (min 10 chars, mixed case, number, symbol): ',
        );

        const passCheck = validateStrongPassword(password);
        if (!passCheck.ok) {
            console.error(passCheck.message ?? 'Password does not meet policy.');
            process.exitCode = 1;
            return;
        }

        const confirm = await questionHidden('Confirm password (must match exactly): ');

        if (password !== confirm) {
            console.error('Passwords do not match.');
            process.exitCode = 1;
            return;
        }

        const hash = await bcrypt.hash(password, 12);

        const existing = await User.findOne({ email });
        if (existing) {
            if (existing.role !== 'platform_admin') {
                console.error(
                    'That email already belongs to a workspace account. Pick a dedicated operator inbox.',
                );
                process.exitCode = 1;
                return;
            }
            existing.passwordHash = hash;
            existing.authProvider = 'local';
            existing.tenantId = undefined;
            await existing.save();
            console.log('[bootstrap] Password updated for existing platform_admin.');
        } else {
            await User.create({
                email,
                passwordHash: hash,
                role: 'platform_admin',
                authProvider: 'local',
                accountStatus: 'active',
                termsAcceptedAt: new Date(),
                termsVersionAccepted: 'bootstrap',
            });
            console.log('[bootstrap] Created platform_admin. Sign in at /login.');
        }

        console.log('\nDone. Store this credential in your password manager. Do not commit it.');
    } finally {
        await mongoose.disconnect();
    }
}

void main();
