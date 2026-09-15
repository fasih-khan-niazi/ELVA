/**
 * Security-focused API smoke tests (tenant isolation, auth hardening).
 * Run: npm test (with ELVA_SKIP_LISTEN=1 and MONGO_URI set)
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';

describe('Security API smoke', () => {
    it('GET /api/auth/session without auth returns 401', async () => {
        await request(app).get('/api/auth/session').expect(401);
    });

    it('GET /api/internal/catalog without secret returns 401 or 503', async () => {
        const prev = process.env.INTERNAL_API_SECRET;
        process.env.INTERNAL_API_SECRET = 'test-internal-secret-for-ci-only';
        const res = await request(app).get('/api/internal/catalog');
        process.env.INTERNAL_API_SECRET = prev;
        assert.ok([401, 503].includes(res.status));
    });

    it('POST /api/chat/message without auth returns 401', async () => {
        await request(app)
            .post('/api/chat/message')
            .send({ agentId: '000000000000000000000001', message: 'hi' })
            .expect(401);
    });

    after(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
});
