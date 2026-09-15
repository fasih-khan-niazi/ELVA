import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { requireActiveAccount } from '../middleware/activeAccountMiddleware';
import { verifySlackSignature } from '../middleware/slackSignatureMiddleware';
import {
    slackInstall,
    slackCallback,
    getSlackWorkspaces,
    listSlackChannels,
    slackInteractions,
} from '../controllers/slackOAuthController';

const router = Router();

// OAuth install - token validated inside handler (browser popup can't set headers)
router.get('/oauth/install', slackInstall);

// OAuth callback - public (Slack sends code here)
router.get('/oauth/callback', slackCallback);

// List connected workspaces for tenant
router.get('/workspaces', protect, requireActiveAccount, getSlackWorkspaces);

// List channels in a workspace
router.get('/workspaces/:workspaceId/channels', protect, requireActiveAccount, listSlackChannels);

// Slack interactive components webhook (verifySlackSignature handles raw body)
router.post('/interactions', verifySlackSignature, slackInteractions);

export default router;
