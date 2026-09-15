/**
 * Run after dotenv. Fails fast in production when JWT is weak or unset.
 */
if (process.env.NODE_ENV === 'production') {
    const j = process.env.JWT_SECRET;
    const weakDefaults = ['', 'secret', 'your-super-secret-jwt-key'];

    if (!j || weakDefaults.includes(j.trim()) || j.length < 16) {
        console.error(
            '[env] Production requires a strong JWT_SECRET (set in .env, at least 16 characters, never the tutorial default)',
        );
        process.exit(1);
    }
}
