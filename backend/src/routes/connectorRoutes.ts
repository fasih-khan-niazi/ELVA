import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { checkConnectorLimit } from '../middleware/connectorLimitMiddleware';
import {
    getConnectors, getConnector, createConnector, updateConnector,
    toggleConnectorStatus, deleteConnector, testConnectorHandler,
    getConnectorLogs, getTemplates, getConnectorStats,
} from '../controllers/connectorController';

const router = Router();

router.use(protect);
router.use(requireActiveAccount);

// Templates and stats (no connector limit needed)
router.get('/templates', getTemplates);
router.get('/stats', getConnectorStats);

// Connector CRUD
router.get('/', getConnectors);
router.get('/:id', getConnector);
router.post('/', checkConnectorLimit, createConnector);
router.put('/:id', updateConnector);
router.patch('/:id/status', toggleConnectorStatus);
router.delete('/:id', deleteConnector);

// Actions
router.post('/:id/test', testConnectorHandler);
router.get('/:id/logs', getConnectorLogs);

export default router;
