package com.example.driverassistant

import com.example.driverassistant.data.security.LegacyCredentialMigration
import com.example.driverassistant.data.security.TokenSlot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyCredentialMigrationTest {
    @Test
    fun noLegacyTokenSucceedsWithoutWriting() {
        val legacy = MemorySlot(null)
        val secure = MemorySlot(null)
        assertTrue(LegacyCredentialMigration(legacy, secure).run())
        assertFalse(secure.exists())
    }

    @Test
    fun legacyTokenMovesToSecureSlotAndClearsPlainText() {
        val legacy = MemorySlot("legacy-token")
        val secure = MemorySlot(null)
        assertTrue(LegacyCredentialMigration(legacy, secure).run())
        assertEquals("legacy-token", secure.read())
        assertFalse(legacy.exists())
    }

    @Test
    fun alreadyMigratedStateDoesNotRepeat() {
        val legacy = MemorySlot("legacy-token")
        val secure = MemorySlot("secure-token")
        assertTrue(LegacyCredentialMigration(legacy, secure).run())
        assertEquals("secure-token", secure.read())
        assertTrue(legacy.exists())
    }

    @Test
    fun migrationFailureKeepsLegacyToken() {
        val legacy = MemorySlot("legacy-token")
        val secure = MemorySlot(null, failWrite = true)
        assertFalse(LegacyCredentialMigration(legacy, secure).run())
        assertEquals("legacy-token", legacy.read())
    }

    @Test
    fun processRestartDoesNotRemigrateAfterSecureExists() {
        val legacy = MemorySlot("legacy-token")
        val secure = MemorySlot(null)
        assertTrue(LegacyCredentialMigration(legacy, secure).run())
        legacy.write("new-plain-token")
        assertTrue(LegacyCredentialMigration(legacy, secure).run())
        assertEquals("legacy-token", secure.read())
    }

    private class MemorySlot(
        private var value: String?,
        private val failWrite: Boolean = false
    ) : TokenSlot {
        override fun read(): String? = value
        override fun write(token: String): Boolean {
            if (failWrite) return false
            value = token
            return true
        }
        override fun clear() {
            value = null
        }
        override fun exists(): Boolean = !value.isNullOrBlank()
    }
}
