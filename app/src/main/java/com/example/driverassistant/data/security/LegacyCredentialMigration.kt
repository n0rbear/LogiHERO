package com.example.driverassistant.data.security

interface TokenSlot {
    fun read(): String?
    fun write(token: String): Boolean
    fun clear()
    fun exists(): Boolean
}

class LegacyCredentialMigration(
    private val legacy: TokenSlot,
    private val secure: TokenSlot
) {
    fun run(): Boolean {
        if (secure.exists()) return true
        val legacyToken = legacy.read()
        if (legacyToken.isNullOrBlank()) return true
        if (!secure.write(legacyToken)) return false
        if (secure.read() != legacyToken) return false
        legacy.clear()
        return true
    }
}
