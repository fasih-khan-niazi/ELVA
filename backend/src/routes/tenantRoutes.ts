import { Router } from 'express';

import { protect } from '../middleware/authMiddleware';

import { requireActiveAccount } from '../middleware/activeAccountMiddleware';

import { requireBusinessAdmin } from '../middleware/businessAdminMiddleware';

import { listMembers, removeMember, suspendMember, resumeMember } from '../controllers/tenantMemberController';
import { listWorkspaceAudit } from '../controllers/tenantAuditController';

import { createInvite, listInvites, revokeInvite } from '../controllers/tenantInviteController';
import { patchInviteDomainPolicy } from '../controllers/tenantInvitePolicyController';
import { patchWorkspace } from '../controllers/tenantWorkspaceController';



const router = Router();



router.get('/members', protect, requireActiveAccount, listMembers);

router.delete('/members/:userId', protect, requireActiveAccount, requireBusinessAdmin, removeMember);

router.patch('/members/:userId/suspend', protect, requireActiveAccount, requireBusinessAdmin, suspendMember);

router.patch('/members/:userId/resume', protect, requireActiveAccount, requireBusinessAdmin, resumeMember);

router.get('/audit-log', protect, requireActiveAccount, requireBusinessAdmin, listWorkspaceAudit);



router.get('/invites', protect, requireActiveAccount, requireBusinessAdmin, listInvites);

router.post('/invites', protect, requireActiveAccount, requireBusinessAdmin, createInvite);

router.delete('/invites/:inviteId', protect, requireActiveAccount, requireBusinessAdmin, revokeInvite);

router.patch(
    '/invite-domain-policy',
    protect,
    requireActiveAccount,
    requireBusinessAdmin,
    patchInviteDomainPolicy,
);

router.patch('/workspace', protect, requireActiveAccount, requireBusinessAdmin, patchWorkspace);

export default router;

