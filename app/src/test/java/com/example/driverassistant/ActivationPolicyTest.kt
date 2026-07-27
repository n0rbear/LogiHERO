package com.example.driverassistant

import com.example.driverassistant.data.security.ActivationFailure
import com.example.driverassistant.data.security.ActivationPolicy
import com.example.driverassistant.data.security.ActivationUiState
import com.example.driverassistant.data.security.CredentialState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException

class ActivationPolicyTest {
    @Test fun invalidCodeFromUnauthorized() {
        assertEquals(ActivationFailure.INVALID_CODE, ActivationPolicy.classifyHttpFailure(401))
    }

    @Test fun expiredCodeFromGone() {
        assertEquals(ActivationFailure.EXPIRED_CODE, ActivationPolicy.classifyHttpFailure(410))
    }

    @Test fun driverDisabledFromLockedBody() {
        assertEquals(ActivationFailure.DRIVER_DISABLED, ActivationPolicy.classifyHttpFailure(423, "DRIVER_DISABLED"))
    }

    @Test fun deviceDisabledFromLockedBody() {
        assertEquals(ActivationFailure.DEVICE_DISABLED, ActivationPolicy.classifyHttpFailure(423, "DEVICE_DISABLED"))
    }

    @Test fun serverErrorClassified() {
        assertEquals(ActivationFailure.SERVER_ERROR, ActivationPolicy.classifyHttpFailure(500))
    }

    @Test fun timeoutClassified() {
        assertEquals(ActivationFailure.TIMEOUT, ActivationPolicy.classifyThrowable(SocketTimeoutException()))
    }

    @Test fun missingCredentialRequiresActivation() {
        val state = ActivationUiState(linked = false, credentialState = CredentialState.MISSING)
        assertTrue(state.needsActivation)
        assertFalse(state.syncAllowed)
    }

    @Test fun rotatedCredentialRequiresReactivation() {
        val state = ActivationUiState(linked = true, credentialState = CredentialState.REACTIVATION_REQUIRED)
        assertTrue(state.needsReactivation)
        assertFalse(state.syncAllowed)
    }

    @Test fun availableCredentialAllowsSync() {
        val state = ActivationUiState(linked = true, credentialState = CredentialState.AVAILABLE)
        assertTrue(state.syncAllowed)
        assertFalse(state.needsReactivation)
    }
}
