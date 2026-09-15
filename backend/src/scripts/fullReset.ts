/**
 * FULL Database Reset Script
 * Cleans ALL orphaned and legacy data
 * 
 * Usage: npx ts-node src/scripts/fullReset.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGO_URI || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Define schemas inline
const AgentSchema = new mongoose.Schema({
    name: String,
    tenantId: mongoose.Schema.Types.ObjectId
});

const DocumentSchema = new mongoose.Schema({
    tenantId: mongoose.Schema.Types.ObjectId,
    agentId: mongoose.Schema.Types.ObjectId,
    filename: String,
    filePath: String
});

const Agent = mongoose.model('Agent', AgentSchema);
const Document = mongoose.model('Document', DocumentSchema);

async function fullReset() {
    console.log('🔥 FULL DATABASE CLEANUP\n');
    console.log('This will remove ALL orphaned documents and vectors.\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // 1. Get existing agents
        const agents = await Agent.find({});
        const validAgentIds = new Set(agents.map(a => a._id.toString()));
        console.log(`📊 Found ${agents.length} agents:\n`);
        agents.forEach(a => console.log(`   - ${a.name} (${a._id})`));

        // 2. Get all vectors from Supabase
        console.log('\n🧠 Analyzing Supabase vectors...');
        const { data: allVectors, error } = await supabase
            .from('documents')
            .select('id, metadata');

        if (error) {
            console.log(`Error: ${error.message}`);
        } else if (allVectors) {
            console.log(`   Total vectors: ${allVectors.length}`);

            // Categorize vectors
            const validVectors: string[] = [];
            const orphanedVectors: string[] = [];
            const noAgentVectors: string[] = [];

            allVectors.forEach(v => {
                const agentId = v.metadata?.agent_id;
                if (!agentId) {
                    noAgentVectors.push(v.id);
                } else if (validAgentIds.has(agentId)) {
                    validVectors.push(v.id);
                } else {
                    orphanedVectors.push(v.id);
                }
            });

            console.log(`   - Valid (belong to existing agents): ${validVectors.length}`);
            console.log(`   - Orphaned (agent deleted): ${orphanedVectors.length}`);
            console.log(`   - No agent ID (legacy): ${noAgentVectors.length}`);

            // Delete orphaned vectors
            const toDelete = [...orphanedVectors, ...noAgentVectors];
            if (toDelete.length > 0) {
                console.log(`\n🗑️  Deleting ${toDelete.length} vectors...`);
                
                for (let i = 0; i < toDelete.length; i += 100) {
                    const batch = toDelete.slice(i, i + 100);
                    const { error: delError } = await supabase
                        .from('documents')
                        .delete()
                        .in('id', batch);
                    
                    if (delError) {
                        console.log(`   ⚠️ Error: ${delError.message}`);
                    } else {
                        console.log(`   ✅ Deleted batch ${Math.floor(i/100) + 1}`);
                    }
                }
            }
        }

        // 3. Clean MongoDB documents without agentId (legacy documents)
        console.log('\n📄 Cleaning MongoDB legacy documents...');
        const legacyDocs = await Document.find({ agentId: { $exists: false } });
        const orphanedDocs = await Document.find({
            agentId: { $exists: true, $nin: Array.from(validAgentIds) }
        });

        console.log(`   - Legacy (no agent): ${legacyDocs.length}`);
        console.log(`   - Orphaned (agent deleted): ${orphanedDocs.length}`);

        if (legacyDocs.length > 0 || orphanedDocs.length > 0) {
            // Delete files from Supabase storage
            const allOrphanedDocs = [...legacyDocs, ...orphanedDocs];
            const filePaths = allOrphanedDocs.map(d => d.filePath).filter(Boolean);
            
            if (filePaths.length > 0) {
                console.log(`\n🗑️  Deleting ${filePaths.length} files from Supabase storage...`);
                const { error: storageError } = await supabase.storage
                    .from('documents')
                    .remove(filePaths as string[]);
                
                if (storageError) {
                    console.log(`   ⚠️ Some files may already be deleted: ${storageError.message}`);
                } else {
                    console.log(`   ✅ Deleted files from storage`);
                }
            }

            // Delete from MongoDB
            const result = await Document.deleteMany({
                $or: [
                    { agentId: { $exists: false } },
                    { agentId: null },
                    { agentId: { $nin: Array.from(validAgentIds).map(id => new mongoose.Types.ObjectId(id)) } }
                ]
            });
            console.log(`   ✅ Deleted ${result.deletedCount} documents from MongoDB`);
        }

        // Final summary
        console.log('\n========================================');
        console.log('🎉 Full cleanup completed!');
        console.log('========================================\n');

        const finalAgents = await Agent.countDocuments();
        const finalDocs = await Document.countDocuments();
        const { count: finalVectors } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true });

        console.log('📊 Final state:');
        console.log(`   - Agents: ${finalAgents}`);
        console.log(`   - Documents: ${finalDocs}`);
        console.log(`   - Vectors: ${finalVectors || 0}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Done!');
        process.exit(0);
    }
}

fullReset();
