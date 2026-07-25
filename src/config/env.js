const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const NODE_ENV = process.env.NODE_ENV;
const DATABASE_URL = process.env.DATABASE_URL || '';
const NDP_PROJECT_ID = process.env.NDP_PROJECT_ID || 'cms0g920d0001v1mom53he7pk';
const NDP_APP_NAME = process.env.NDP_APP_NAME || 'LogiHERO';
const NDP_ENVIRONMENT = process.env.NDP_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const IS_DEPLOYED = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
const PORT = process.env.PORT || 3000;

module.exports = {
    ADMIN_TOKEN,
    MAX_UPLOAD_BYTES,
    NODE_ENV,
    DATABASE_URL,
    NDP_PROJECT_ID,
    NDP_APP_NAME,
    NDP_ENVIRONMENT,
    IS_DEPLOYED,
    PORT
};
