import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { terminalLog } from '../utils/terminalLog';

dotenv.config();

async function runLegacyUserMigrations() {
    try {
        // Brief defer: after `mongoose.connect` resolves, the native client may not be ready for
        // collection ops on some drivers / Atlas handshakes (avoids MongoNotConnectedError).
        await new Promise<void>((resolve) => setImmediate(resolve));
        const users = mongoose.connection.collection('users');
        const tenants = mongoose.connection.collection('tenants');
        await users.updateMany(
            /* Legacy MongoDB role name → canonical platform_admin */
            { role: 'super_admin' },
            { $set: { role: 'platform_admin' } },
        );
        await users.updateMany(
            { accountStatus: { $exists: false } },
            { $set: { accountStatus: 'active' } },
        );
        await tenants.updateMany(
            { registrationType: { $exists: false } },
            { $set: { registrationType: 'company' } },
        );
    } catch (e: any) {
        console.warn('[migrate] Legacy fields:', e?.message || e);
    }
}

export function isDbConnected(): boolean {
    return mongoose.connection.readyState === 1;
}

const connectDB = async (retries = 5) => {
    while (retries > 0) {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI || '', {
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 5000,
            });
            terminalLog.ok('MongoDB', `Connected — ${conn.connection.host}`);
            await runLegacyUserMigrations();
            return;
        } catch (error: any) {
            terminalLog.err('MongoDB', error.message);
            retries -= 1;
            terminalLog.warn('MongoDB', `${retries} retries left…`);
            if (retries === 0) {
                process.exit(1);
            }
            // Wait 5 seconds before retrying
            await new Promise(res => setTimeout(res, 5000));
        }
    }
};

export default connectDB;
