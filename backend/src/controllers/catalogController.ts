import { Request, Response } from 'express';
import { CatalogItem, Agent } from '../models';
import { getAiServiceSecretHeaders } from '../utils/aiServiceSecret';

// GET /api/catalog/:agentId/items - list all catalog items for an agent
export const getCatalogItems = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        // Verify agent belongs to tenant
        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const items = await CatalogItem.find({ agentId, tenantId }).sort({ category: 1, name: 1 });
        return res.json(items);
    } catch (err: any) {
        console.error('Error fetching catalog items:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/catalog/:agentId/items - create a new catalog item
export const createCatalogItem = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        // Verify agent belongs to tenant
        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const { name, description, price, category, imageUrl, available, options } = req.body;

        if (!name || price == null) {
            return res.status(400).json({ message: 'Name and price are required' });
        }

        const item = await CatalogItem.create({
            agentId,
            tenantId,
            name,
            description: description || '',
            price: Number(price),
            category: category || 'General',
            imageUrl,
            available: available !== false,
            options: options || []
        });

        return res.status(201).json(item);
    } catch (err: any) {
        console.error('Error creating catalog item:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/catalog/:agentId/items/:itemId - update a catalog item
export const updateCatalogItem = async (req: Request, res: Response) => {
    try {
        const { agentId, itemId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const item = await CatalogItem.findOne({ _id: itemId, agentId, tenantId });
        if (!item) {
            return res.status(404).json({ message: 'Catalog item not found' });
        }

        const updates = req.body;
        const allowedFields = ['name', 'description', 'price', 'category', 'imageUrl', 'available', 'options'];

        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                (item as any)[key] = updates[key];
            }
        }

        await item.save();
        return res.json(item);
    } catch (err: any) {
        console.error('Error updating catalog item:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/catalog/:agentId/items/:itemId - delete a catalog item
export const deleteCatalogItem = async (req: Request, res: Response) => {
    try {
        const { agentId, itemId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        const item = await CatalogItem.findOneAndDelete({ _id: itemId, agentId, tenantId });
        if (!item) {
            return res.status(404).json({ message: 'Catalog item not found' });
        }

        return res.json({ message: 'Item deleted' });
    } catch (err: any) {
        console.error('Error deleting catalog item:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/catalog/:agentId/sync - sync catalog to RAG knowledge base
export const syncCatalogToRAG = async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        // Verify agent belongs to tenant
        const agent = await Agent.findOne({ _id: agentId, tenantId });
        if (!agent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const items = await CatalogItem.find({ agentId, tenantId, available: true }).sort({ category: 1, name: 1 });

        if (items.length === 0) {
            return res.json({ message: 'No catalog items to sync', chunksUpserted: 0 });
        }

        // Build a structured catalog document
        const categories = new Map<string, typeof items>();
        for (const item of items) {
            const cat = item.category || 'General';
            if (!categories.has(cat)) categories.set(cat, []);
            categories.get(cat)!.push(item);
        }

        let catalogText = `=== ${agent.businessName || agent.name} - Product Catalog / Menu ===\n\n`;

        const currencySymbols: Record<string, string> = {
            USD: '$', PKR: 'Rs.', EUR: '€', GBP: '£', INR: '₹',
            AED: 'AED ', SAR: 'SAR ', CAD: 'C$', AUD: 'A$',
        };
        const sym = currencySymbols[agent.currency || 'USD'] || '$';

        for (const [category, catItems] of categories) {
            catalogText += `--- ${category} ---\n`;
            for (const item of catItems) {
                catalogText += `• ${item.name} - ${sym}${item.price.toFixed(2)}`;
                if (item.description) catalogText += `\n  ${item.description}`;
                if (item.options && item.options.length > 0) {
                    for (const opt of item.options) {
                        catalogText += `\n  ${opt.name}: ${opt.choices.join(', ')}`;
                    }
                }
                catalogText += '\n';
            }
            catalogText += '\n';
        }

        // Send to AI service for RAG ingestion
        const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const ingestRes = await fetch(`${AI_URL}/ingest-text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAiServiceSecretHeaders(),
            },
            body: JSON.stringify({
                tenant_id: tenantId.toString(),
                agent_id: agentId,
                text: catalogText,
                source: `catalog_${agentId}`,
                metadata: { type: 'catalog', agentId, itemCount: items.length }
            })
        });

        if (!ingestRes.ok) {
            const errBody = await ingestRes.text();
            console.error('RAG ingest failed:', errBody);
            return res.status(502).json({ message: 'Failed to sync catalog to knowledge base' });
        }

        const ingestData = await ingestRes.json();
        return res.json({
            message: 'Catalog synced to knowledge base',
            itemCount: items.length,
            chunksUpserted: ingestData.chunks_upserted || ingestData.count || 0
        });
    } catch (err: any) {
        console.error('Error syncing catalog to RAG:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/catalog/:agentId/duplicate-from/:sourceAgentId
export const duplicateCatalogFromAgent = async (req: Request, res: Response) => {
    try {
        const { agentId, sourceAgentId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        if (agentId === sourceAgentId) {
            return res.status(400).json({ message: 'Cannot duplicate from the same agent' });
        }

        const [targetAgent, sourceAgent] = await Promise.all([
            Agent.findOne({ _id: agentId, tenantId }),
            Agent.findOne({ _id: sourceAgentId, tenantId }),
        ]);

        if (!targetAgent || !sourceAgent) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        const sourceItems = await CatalogItem.find({ agentId: sourceAgentId, tenantId }).lean();
        if (sourceItems.length === 0) {
            return res.status(400).json({ message: 'Source agent has no catalog items' });
        }

        await CatalogItem.deleteMany({ agentId, tenantId });

        const copies = sourceItems.map((item) => ({
            agentId,
            tenantId,
            name: item.name,
            description: item.description || '',
            price: item.price,
            category: item.category || 'General',
            imageUrl: item.imageUrl,
            available: item.available !== false,
            options: item.options || [],
        }));

        const created = await CatalogItem.insertMany(copies);

        return res.json({
            message: `Copied ${created.length} item(s) from ${sourceAgent.name}`,
            itemCount: created.length,
            sourceAgentName: sourceAgent.name,
        });
    } catch (err: any) {
        console.error('Error duplicating catalog:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};
