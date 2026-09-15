/**
 * Phase 7: print a release checklist and run small API smoke tests.
 * Requires MongoDB (MONGO_URI in .env) because importing the app connects on startup.
 *
 * Optional (real tokens from a dev workspace with analytics-enabled plan):
 *   ELVA_PHASE7_ADMIN_JWT   - business_admin; expects 200 + workspace.reportingCurrency on GET /api/analytics/overview
 *   ELVA_PHASE7_MEMBER_JWT  - member; expects 403 from same route
 *
 * Run: npm test   (sets ELVA_SKIP_LISTEN=1 via package script)
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { TERMS_VERSION } from '../constants/legal';

function printPhase7Checklist() {
    console.log('\n========== Phase 7 - release checklist ==========\n');
    const lines = [
        '[ ] Tenant `reportingCurrency` stored; PATCH /api/tenant/workspace accepts ISO list (USD, PKR, …)',
        '[ ] GET /api/analytics/overview returns workspace.reportingCurrency for business_admin',
        '[ ] Global analytics UI: display currency control + Intl formatting (no FX conversion)',
        '[ ] RBAC: member cannot access /api/analytics/overview (403)',
        '[ ] Analytics plan gate: requireAnalyticsEnabled still returns 403 on free tier',
        '[ ] ELVA_SKIP_LISTEN=1 prevents binding a port when tests import app',
        '[ ] npm test passes against your .env (MONGO_URI)',
        '[ ] Auth/legal smoke: terms-meta, subscription 401, signup validation in phase7.api.test.ts',
    ];
    for (const line of lines) console.log(line);
    console.log('\nOptional JWT checks: set ELVA_PHASE7_ADMIN_JWT / ELVA_PHASE7_MEMBER_JWT\n');
    console.log('\n===================================================\n');
}

printPhase7Checklist();

describe('Phase 7 API smoke', () => {
    it('GET /health returns 200 with status ok', async () => {
        const res = await request(app).get('/health').expect(200);
        assert.equal(res.body.status, 'ok');
        assert.ok(typeof res.body.timestamp === 'string');
    });

    it('GET /api/analytics/overview without auth returns 401', async () => {
        const res = await request(app).get('/api/analytics/overview').expect(401);
        assert.ok(res.body.message);
    });

    it('PATCH /api/tenant/workspace without auth returns 401', async () => {
        await request(app)
            .patch('/api/tenant/workspace')
            .send({ reportingCurrency: 'PKR' })
            .expect(401);
    });

    const adminJwt = process.env.ELVA_PHASE7_ADMIN_JWT?.trim();
    if (adminJwt) {
        it('GET /api/analytics/overview with admin JWT returns 200 and workspace currency', async () => {
            const res = await request(app)
                .get('/api/analytics/overview')
                .set('Authorization', `Bearer ${adminJwt}`)
                .expect(200);
            assert.ok(res.body.workspace);
            assert.ok(typeof res.body.workspace.reportingCurrency === 'string');
            assert.match(res.body.workspace.reportingCurrency, /^[A-Z]{3}$/);
            assert.ok(res.body.summary);
        });

        it('PATCH /api/tenant/workspace with admin JWT rejects invalid reportingCurrency (400)', async () => {
            const res = await request(app)
                .patch('/api/tenant/workspace')
                .set('Authorization', `Bearer ${adminJwt}`)
                .send({ reportingCurrency: 'ZZZ' })
                .expect(400);
            assert.ok(res.body.message);
        });
    }

    const memberJwt = process.env.ELVA_PHASE7_MEMBER_JWT?.trim();
    if (memberJwt) {
        it('GET /api/analytics/overview with member JWT returns 403', async () => {
            const res = await request(app)
                .get('/api/analytics/overview')
                .set('Authorization', `Bearer ${memberJwt}`)
                .expect(403);
            assert.ok(res.body.message);
        });
    }
});

describe('Auth & legal API', () => {
    it('GET /api/legal/terms-meta returns current TERMS_VERSION', async () => {
        const res = await request(app).get('/api/legal/terms-meta').expect(200);
        assert.equal(res.body.termsVersion, TERMS_VERSION);
        assert.ok(typeof res.body.termsLastUpdated === 'string');
    });

    it('GET /api/subscription/current without auth returns 401', async () => {
        const res = await request(app).get('/api/subscription/current').expect(401);
        assert.ok(res.body.message);
    });

    it('POST /api/auth/login with unknown user returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'nonexistent-elva-test@example.com', password: 'irrelevant' })
            .expect(400);
        assert.ok(res.body.message);
    });

    it('POST /api/auth/signup rejects weak password', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({
                email: `elva-auth-test-weak-${Date.now()}@example.com`,
                password: '123',
                companyName: '',
                registrationType: 'solo',
                acceptTerms: true,
                termsVersion: TERMS_VERSION,
            })
            .expect(400);
        assert.ok(res.body.message);
    });

    it('POST /api/auth/signup rejects wrong terms version', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({
                email: `elva-auth-test-terms-${Date.now()}@example.com`,
                password: 'ValidStr0ng!Pass',
                companyName: '',
                registrationType: 'solo',
                acceptTerms: true,
                termsVersion: 'wrong-version',
            })
            .expect(400);
        assert.ok(res.body.message);
    });
});

after(async () => {
    await mongoose.disconnect().catch(() => {});
});
