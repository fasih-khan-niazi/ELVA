/**
 * One-shot migration: lift legacy agents that were created when
 *   responseConfig.maxTurns default was 4 and memoryConfig.shortTermWindow was 8.
 *
 * After this script runs:
 *   - Every agent with maxTurns < 30 is bumped to 30 (so voice calls don't
 *     hang up mid-conversation).
 *   - Every agent whose shortTermWindow != 6 is normalised to 6 (production
 *     dialogue context size).
 *
 * Usage:
 *   npx ts-node src/scripts/upgradeAgentLimits.ts
 *   # or, with built JS:
 *   node dist/scripts/upgradeAgentLimits.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGO_URI || '';
if (!MONGODB_URI) {
    console.error('MONGO_URI not set in environment.');
    process.exit(1);
}

async function run() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Use raw collection access - schema-less so we don't depend on the full
    // Agent model being in the script's import graph.
    const db = mongoose.connection.db;
    if (!db) throw new Error('Mongo connection has no db');
    const agents = db.collection('agents');

    const totalBefore = await agents.countDocuments({});
    console.log(`Total agents: ${totalBefore}`);

    const turnsResult = await agents.updateMany(
        {
            $or: [
                { 'responseConfig.maxTurns': { $exists: false } },
                { 'responseConfig.maxTurns': { $lt: 30 } },
            ],
        },
        { $set: { 'responseConfig.maxTurns': 30 } },
    );
    console.log(`responseConfig.maxTurns lifted on ${turnsResult.modifiedCount} agents`);

    const memResult = await agents.updateMany(
        {
            $or: [
                { 'memoryConfig.shortTermWindow': { $exists: false } },
                { 'memoryConfig.shortTermWindow': { $ne: 6 } },
            ],
        },
        { $set: { 'memoryConfig.shortTermWindow': 6 } },
    );
    console.log(`memoryConfig.shortTermWindow normalised on ${memResult.modifiedCount} agents`);

    await mongoose.disconnect();
    console.log('Done.');
}

run().catch((err) => {
    console.error('Migration failed:', err);
    mongoose.disconnect().finally(() => process.exit(1));
});
