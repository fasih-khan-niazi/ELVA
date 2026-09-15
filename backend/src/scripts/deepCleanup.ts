/**
 * Deep Cleanup Script: Remove ALL orphaned data from MongoDB and Supabase
 * Also cleans Supabase vectors that don't have matching agents
 * 
 * Usage: npx ts-node src/scripts/deepCleanup.ts
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

async function deepCleanup() {
    console.log('🧹 Starting DEEP cleanup...\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Initialize Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // 1. List all agents
        const agents = await Agent.find({});
        console.log('📊 EXISTING AGENTS:');
        agents.forEach(a => {
            console.log(`   - ${a._id}: ${a.name}`);
        });
        const validAgentIds = new Set(agents.map(a => a._id.toString()));
        console.log(`\n   Total: ${validAgentIds.size} agents\n`);

        // 2. List all MongoDB documents
        const allDocs = await Document.find({});
        console.log('📄 MONGODB DOCUMENTS:');
        allDocs.forEach(d => {
            const isOrphaned = d.agentId && !validAgentIds.has(d.agentId.toString());
            console.log(`   - ${d._id}: ${d.filename} (agent: ${d.agentId}) ${isOrphaned ? '❌ ORPHANED' : '✅'}`);
        });
        console.log(`\n   Total: ${allDocs.length} documents\n`);

        // 3. Get all Supabase vectors
        console.log('🧠 SUPABASE VECTORS:');
        const { data: vectors, error: vectorError } = await supabase
            .from('documents')
            .select('id, metadata, content');

        if (vectorError) {
            console.log(`   ⚠️ Error fetching vectors: ${vectorError.message}`);
        } else if (vectors) {
            console.log(`   Found ${vectors.length} total vectors`);
            
            // Group by agent_id
            const vectorsByAgent: Record<string, number> = {};
            const orphanedVectorIds: string[] = [];
            
            vectors.forEach(v => {
                const agentId = v.metadata?.agent_id;
                if (agentId) {
                    vectorsByAgent[agentId] = (vectorsByAgent[agentId] || 0) + 1;
                    if (!validAgentIds.has(agentId)) {
                        orphanedVectorIds.push(v.id);
                    }
                }
            });

            console.log('\n   Vectors per agent:');
            Object.entries(vectorsByAgent).forEach(([agentId, count]) => {
                const isValid = validAgentIds.has(agentId);
                console.log(`   - Agent ${agentId}: ${count} vectors ${isValid ? '✅' : '❌ ORPHANED'}`);
            });

            // 4. DELETE ORPHANED VECTORS
            if (orphanedVectorIds.length > 0) {
                console.log(`\n🗑️  Deleting ${orphanedVectorIds.length} orphaned vectors from Supabase...`);
                
                // Delete in batches of 100
                for (let i = 0; i < orphanedVectorIds.length; i += 100) {
                    const batch = orphanedVectorIds.slice(i, i + 100);
                    const { error: deleteError } = await supabase
                        .from('documents')
                        .delete()
                        .in('id', batch);

                    if (deleteError) {
                        console.log(`   ⚠️ Error deleting batch: ${deleteError.message}`);
                    } else {
                        console.log(`   ✅ Deleted batch ${i/100 + 1} (${batch.length} vectors)`);
                    }
                }
            } else {
                console.log('\n✨ No orphaned vectors found!');
            }
        }

        // 5. Delete orphaned MongoDB documents
        const orphanedDocs = allDocs.filter(doc => {
            if (!doc.agentId) return false;
            return !validAgentIds.has(doc.agentId.toString());
        });

        if (orphanedDocs.length > 0) {
            console.log(`\n🗑️  Deleting ${orphanedDocs.length} orphaned documents from MongoDB...`);
            const orphanedIds = orphanedDocs.map(d => d._id);
            await Document.deleteMany({ _id: { $in: orphanedIds } });
            console.log('   ✅ Deleted!');
        }

        // Final count
        console.log('\n========================================');
        console.log('🎉 Deep cleanup completed!');
        console.log('========================================\n');

        const finalDocs = await Document.countDocuments();
        const { count: finalVectorCount } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true });

        console.log('📊 Final state:');
        console.log(`   - Agents: ${validAgentIds.size}`);
        console.log(`   - MongoDB Documents: ${finalDocs}`);
        console.log(`   - Supabase Vectors: ${finalVectorCount || 0}`);

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Done!');
        process.exit(0);
    }
}

deepCleanup();
