const buckets = new Map();

function clientKey(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
    return ip.replace(/^::ffff:/, '');
}

function rateLimit({ name, windowMs, max, key = clientKey }) {
    return (req, res, next) => {
        const now = Date.now();
        const id = `${name}:${key(req)}`;
        const current = buckets.get(id);
        const bucket = current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + windowMs };
        bucket.count += 1;
        buckets.set(id, bucket);

        if (bucket.count > max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfter));
            console.warn(`[RATE_LIMIT] requestId=${req.requestId || 'unknown'} route=${req.originalUrl || req.url} limiter=${name} result=429 retryAfter=${retryAfter}`);
            return res.status(429).json({
                error: 'RATE_LIMITED',
                retryAfter
            });
        }
        return next();
    };
}

function clearRateLimits() {
    buckets.clear();
}

module.exports = {
    rateLimit,
    clientKey,
    clearRateLimits
};
