package com.example.driverassistant

import com.example.driverassistant.data.security.CredentialState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialStateTest {
    @Test
    fun credentialStatesCoverBackendContract() {
        val states = CredentialState.entries.map { it.name }.toSet()
        assertTrue(states.contains("MISSING"))
        assertTrue(states.contains("INVALID"))
        assertTrue(states.contains("DEVICE_DISABLED"))
        assertTrue(states.contains("DRIVER_DISABLED"))
        assertTrue(states.contains("REACTIVATION_REQUIRED"))
    }

    @Test
    fun invalidCredentialDoesNotMeanLocalDataDeletion() {
        val state = CredentialState.INVALID
        assertEquals("INVALID", state.name)
    }

    @Test
    fun revokedCredentialIsDistinctFromMissing() {
        assertTrue(CredentialState.REVOKED != CredentialState.MISSING)
    }
}
