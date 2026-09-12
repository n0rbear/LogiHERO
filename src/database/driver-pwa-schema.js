const DRIVER_PWA_REQUIRED_COLUMNS = Object.freeze({
    driver_accounts: ['uuid', 'driver_uuid', 'username', 'username_normalized', 'password_hash', 'must_change_password', 'is_active', 'password_version', 'created_at', 'updated_at', 'password_changed_at', 'last_login_at'],
    driver_web_sessions: ['uuid', 'account_uuid', 'token_hash', 'csrf_token_hash', 'password_version', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at', 'revoke_reason', 'user_agent']
});

const DRIVER_PWA_TABLES = Object.freeze(Object.keys(DRIVER_PWA_REQUIRED_COLUMNS));

module.exports = { DRIVER_PWA_REQUIRED_COLUMNS, DRIVER_PWA_TABLES };
