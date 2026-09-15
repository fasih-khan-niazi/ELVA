/**
 * Cleanup Script: Remove orphaned documents from MongoDB and Supabase
 * Run this script to clean up documents that belong to deleted agents
 * 
 * Usage: npx ts-node src/scripts/cleanupOrphanedDocs.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGO_URI || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Define schemas inline to avoid import issues
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

async function cleanupOrphanedDocuments() {
    console.log('🧹 Starting cleanup of orphaned documents...\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get all existing agent IDs
        const agents = await Agent.find({}, { _id: 1 });
        const validAgentIds = new Set(agents.map(a => a._id.toString()));
        console.log(`📊 Found ${validAgentIds.size} existing agents\n`);

        // Find all documents in MongoDB
        const allDocs = await Document.find({});
        console.log(`📄 Found ${allDocs.length} total documents in MongoDB`);

        // Find orphaned documents (documents with agentId that doesn't exist)
        const orphanedDocs = allDocs.filter(doc => {
            if (!doc.agentId) return false; // Documents without agentId are tenant-level
            return !validAgentIds.has(doc.agentId.toString());
        });

        console.log(`🗑️  Found ${orphanedDocs.length} orphaned documents to delete\n`);

        if (orphanedDocs.length === 0) {
            console.log('✨ No orphaned documents found. Database is clean!\n');
        } else {
            // Collect orphaned agent IDs for Supabase cleanup
            const orphanedAgentIds = [...new Set(orphanedDocs.map(d => d.agentId?.toString()).filter(Boolean))];
            console.log(`🔍 Orphaned agent IDs: ${orphanedAgentIds.join(', ')}\n`);

            // Initialize Supabase
            if (SUPABASE_URL && SUPABASE_KEY) {
                const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

                // Delete from Supabase storage
                console.log('📦 Deleting files from Supabase storage...');
                const filePaths = orphanedDocs.map(d => d.filePath).filter(Boolean);
                if (filePaths.length > 0) {
                    const { error: storageError } = await supabase.storage
                        .from('documents')
                        .remove(filePaths as string[]);
                    
                    if (storageError) {
                        console.log(`⚠️  Storage deletion error (may already be deleted): ${storageError.message}`);
                    } else {
                        console.log(`✅ Deleted ${filePaths.length} files from Supabase storage`);
                    }
                }

                // Delete vector embeddings from Supabase 'documents' table
                console.log('\n🧠 Deleting vector embeddings from Supabase...');
                for (const agentId of orphanedAgentIds) {
                    const { error: vectorError } = await supabase
                        .from('documents')
                        .delete()
                        .filter('metadata->>agent_id', 'eq', agentId);
                    
                    if (vectorError) {
                        console.log(`⚠️  Vector deletion error for agent ${agentId}: ${vectorError.message}`);
                    } else {
                        console.log(`✅ Deleted vectors for orphaned agent: ${agentId}`);
                    }
                }

                // Also delete vectors with tenant_id that have non-existent agent_ids
                console.log('\n🔄 Cleaning up any remaining orphaned vectors...');
                const { data: allVectors, error: fetchError } = await supabase
                    .from('documents')
                    .select('id, metadata');

                if (!fetchError && allVectors) {
                    const vectorsToDelete = allVectors.filter(v => {
                        const agentId = v.metadata?.agent_id;
                        if (!agentId) return false;
                        return !validAgentIds.has(agentId);
                    });

                    if (vectorsToDelete.length > 0) {
                        const idsToDelete = vectorsToDelete.map(v => v.id);
                        const { error: deleteError } = await supabase
                            .from('documents')
                            .delete()
                            .in('id', idsToDelete);

                        if (deleteError) {
                            console.log(`⚠️  Bulk vector deletion error: ${deleteError.message}`);
                        } else {
                            console.log(`✅ Deleted ${vectorsToDelete.length} orphaned vector embeddings`);
                        }
                    } else {
                        console.log('✨ No orphaned vectors found in Supabase');
                    }
                }
            } else {
                console.log('⚠️  Supabase credentials not configured, skipping Supabase cleanup');
            }

            // Delete orphaned documents from MongoDB
            console.log('\n📝 Deleting orphaned documents from MongoDB...');
            const orphanedIds = orphanedDocs.map(d => d._id);
            const deleteResult = await Document.deleteMany({ _id: { $in: orphanedIds } });
            console.log(`✅ Deleted ${deleteResult.deletedCount} documents from MongoDB`);
        }

        // Summary
        console.log('\n========================================');
        console.log('🎉 Cleanup completed successfully!');
        console.log('========================================\n');

        // Show current state
        const remainingDocs = await Document.countDocuments();
        const agentCount = await Agent.countDocuments();
        console.log(`📊 Current state:`);
        console.log(`   - Agents: ${agentCount}`);
        console.log(`   - Documents: ${remainingDocs}`);

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');
        process.exit(0);
    }
}

// Run the cleanup
cleanupOrphanedDocuments();
