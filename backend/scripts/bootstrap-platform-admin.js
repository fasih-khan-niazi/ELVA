"use strict";
/**
 * Interactive one-time provisioning for ELVA platform operators.
 * Usage (from backend/):  npx tsx scripts/bootstrap-platform-admin.ts
 * Creates (or resets password for) a user with role platform_admin: no tenant, local auth only.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("readline/promises"));
const node_process_1 = require("node:process");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongoose_1 = __importDefault(require("mongoose"));
const index_1 = require("../src/models/index");
function ensureMongo() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const uri = (_a = process.env.MONGO_URI) === null || _a === void 0 ? void 0 : _a.trim();
        if (!uri) {
            console.error('MONGO_URI is required in backend/.env');
            process.exit(1);
        }
        yield mongoose_1.default.connect(uri, {
            serverSelectionTimeoutMS: 10000,
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMongo();
        console.log('[bootstrap] Connected to Mongo.\n');
        const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
        try {
            const email = (yield rl.question('Operator email (lowercased login): ')).trim().toLowerCase();
            if (!email || !email.includes('@')) {
                console.error('Invalid email.');
                process.exitCode = 1;
                return;
            }
            const password = yield rl.questionPassword('Password (never echoed). Min 12 characters recommended: ');
            if (!password || password.length < 12) {
                console.error('Password must be at least 12 characters.');
                process.exitCode = 1;
                return;
            }
            const confirm = yield rl.questionPassword('Confirm password (must match exactly): ');
            if (password !== confirm) {
                console.error('Passwords do not match.');
                process.exitCode = 1;
                return;
            }
            const hash = yield bcryptjs_1.default.hash(password, 12);
            const existing = yield index_1.User.findOne({ email });
            if (existing) {
                if (existing.role !== 'platform_admin') {
                    console.error('That email already belongs to a workspace account. Pick a dedicated operator inbox.');
                    process.exitCode = 1;
                    return;
                }
                existing.passwordHash = hash;
                existing.authProvider = 'local';
                existing.tenantId = undefined;
                yield existing.save();
                console.log('[bootstrap] Password updated for existing platform_admin.');
            }
            else {
                yield index_1.User.create({
                    email,
                    passwordHash: hash,
                    role: 'platform_admin',
                    authProvider: 'local',
                    accountStatus: 'active',
                    termsAcceptedAt: new Date(),
                    termsVersionAccepted: 'bootstrap',
                });
                console.log('[bootstrap] Created platform_admin. Sign in at /login.');
            }
            console.log('\nDone. Store this credential in your password manager. Do not commit it.');
        }
        finally {
            yield rl.close();
            yield mongoose_1.default.disconnect();
        }
    });
}
void main();
