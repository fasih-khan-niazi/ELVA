import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { requireActiveSubscription } from '../middleware/subscriptionMiddleware';
import {
    getCatalogItems,
    createCatalogItem,
    updateCatalogItem,
    deleteCatalogItem,
    syncCatalogToRAG,
    duplicateCatalogFromAgent,
} from '../controllers/catalogController';

const router = Router();

// All catalog routes require auth + active subscription
router.use(protect);
router.use(requireActiveAccount);
router.use(requireActiveSubscription);

// CRUD
router.get('/:agentId/items', getCatalogItems);
router.post('/:agentId/items', createCatalogItem);
router.put('/:agentId/items/:itemId', updateCatalogItem);
router.delete('/:agentId/items/:itemId', deleteCatalogItem);

// Sync catalog to RAG knowledge base
router.post('/:agentId/sync', syncCatalogToRAG);
router.post('/:agentId/duplicate-from/:sourceAgentId', duplicateCatalogFromAgent);

export default router;
