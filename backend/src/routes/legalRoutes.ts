import { Router } from 'express';
import { getLegalMeta } from '../controllers/legalMetaController';

const router = Router();

router.get('/terms-meta', getLegalMeta);

export default router;
