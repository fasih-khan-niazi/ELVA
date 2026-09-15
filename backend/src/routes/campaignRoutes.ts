import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import {
    createCampaign,
    getCampaigns,
    getCampaignById,
    updateCampaign,
    updateCampaignScript,
    deleteCampaign,
    startCampaign,
    pauseCampaign,
    stopCampaign,
    uploadContacts,
    getContacts,
    updateContact,
    getContactDetail,
    getCampaignKpis,
    getHotLeads,
    getCallbacks,
    exportLeads,
    exportAllContacts,
    getTenantDnc,
    addTenantDnc,
    removeTenantDnc,
    getCampaignTemplates,
    getCampaignTemplateDetail,
    generateCampaignConfig,
    updateCampaignFilters,
    updateAbTest,
} from '../controllers/campaignController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);
router.use(requireActiveAccount);

// ─── Static routes (must be before /:id to avoid shadowing) ──────────────────
router.get('/dnc', getTenantDnc);
router.post('/dnc', addTenantDnc);
router.delete('/dnc/:phone', removeTenantDnc);

router.get('/templates', getCampaignTemplates);
router.get('/templates/:templateId', getCampaignTemplateDetail);
router.post('/generate', generateCampaignConfig);

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.post('/', createCampaign);
router.get('/', getCampaigns);
router.get('/:id', getCampaignById);
router.put('/:id', updateCampaign);
router.patch('/:id/script', updateCampaignScript);
router.patch('/:id/filters', updateCampaignFilters);
router.patch('/:id/ab-test', updateAbTest);
router.delete('/:id', deleteCampaign);

// ─── Lifecycle ────────────────────────────────────────────────────────────────
router.post('/:id/start', startCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/stop', stopCampaign);

// ─── Contacts ────────────────────────────────────────────────────────────────
router.post('/:id/contacts/upload', upload.single('file'), uploadContacts);
router.get('/:id/contacts/export', exportAllContacts);
router.get('/:id/contacts', getContacts);
router.patch('/:id/contacts/:contactId', updateContact);
router.get('/:id/contacts/:contactId/detail', getContactDetail);

// ─── Analytics ───────────────────────────────────────────────────────────────
router.get('/:id/kpis', getCampaignKpis);
router.get('/:id/hot-leads', getHotLeads);
router.get('/:id/callbacks', getCallbacks);
router.get('/:id/export-leads', exportLeads);

export default router;
