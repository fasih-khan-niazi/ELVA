/**
 * dialerManager.ts
 *
 * Wraps the in-process dialer loop and adds durability across server restarts:
 *   - On startup, scan MongoDB for any campaigns still in `running` status
 *     and resume their dialer loops automatically.
 *   - Also processes `scheduled` campaigns whose scheduledStartAt has arrived.
 *
 * The dialer loop itself already reads campaign state from MongoDB on every
 * poll cycle and stops when status !== 'running', so no extra persistence is
 * needed beyond the Campaign document itself.
 */

import { Campaign } from '../models/campaignModel';
import { startDialer, stopDialer, isDialerActive } from './outboundDialer';
import { terminalLog } from '../utils/terminalLog';

let _resumeDone = false;

/**
 * Called once after MongoDB connects.
 * Resumes every campaign that is still 'running' in the DB
 * (i.e. was running when the server last stopped).
 */
export async function resumeAllRunning(): Promise<void> {
    if (_resumeDone) return;
    _resumeDone = true;

    try {
        const running = await Campaign.find({ status: 'running' }).select('_id name').lean();
        if (running.length === 0) {
            terminalLog.dim('Dialer: no running campaigns to resume');
            return;
        }

        terminalLog.info('Dialer', `Resuming ${running.length} running campaign(s)…`);
        for (const c of running) {
            const id = String(c._id);
            if (!isDialerActive(id)) {
                terminalLog.dim(`Resuming campaign: ${c.name}`);
                startDialer(id).catch(err =>
                    terminalLog.err('Dialer', `Resume failed ${id}: ${err?.message}`)
                );
            }
        }
    } catch (err: any) {
        terminalLog.err('Dialer', err?.message || 'resume error');
    }
}

/**
 * Checks for campaigns whose scheduledStartAt has arrived and starts them.
 * Call this from a cron job (every minute) or startup.
 */
export async function checkScheduledCampaigns(): Promise<void> {
    try {
        const now = new Date();
        const due = await Campaign.find({
            status: 'scheduled',
            scheduledStartAt: { $lte: now },
        }).lean();

        for (const c of due) {
            const id = String(c._id);
            try {
                await Campaign.findByIdAndUpdate(id, { status: 'running' });
                if (!isDialerActive(id)) {
                    console.log(`[DIALER-MANAGER] Auto-starting scheduled campaign: ${c.name} (${id})`);
                    startDialer(id).catch(err =>
                        console.error(`[DIALER-MANAGER] Error starting scheduled campaign ${id}:`, err?.message)
                    );
                }
            } catch (err: any) {
                console.error(`[DIALER-MANAGER] Failed to start scheduled campaign ${id}:`, err?.message);
            }
        }
    } catch (err: any) {
        console.error('[DIALER-MANAGER] checkScheduled error:', err?.message);
    }
}

export { stopDialer, isDialerActive };
