package com.example.driverassistant.activation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.driverassistant.data.security.ActivationFailure
import com.example.driverassistant.data.security.ActivationUiState
import com.example.driverassistant.data.security.CredentialState
import com.example.driverassistant.ui.screen.ActivationStatusPanel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ActivationUiInstrumentedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun missingCredentialShowsActivationScreen() {
        var opens = 0
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = false, credentialState = CredentialState.MISSING),
                onOpenActivation = { opens++ }
            )
        }

        compose.onNodeWithText("Aktiválás szükséges").assertIsDisplayed()
        compose.onNodeWithText("Telefon aktiválása").assertIsEnabled().performClick()
        assertEquals(1, opens)
    }

    @Test
    fun reactivationRequiredKeepsPendingDataMessageVisible() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.REACTIVATION_REQUIRED),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Újraaktiválás szükséges").assertIsDisplayed()
        compose.onNodeWithText("A helyi adatok és függő munkaidők megmaradnak.", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Újraaktiválás").assertIsEnabled()
    }

    @Test
    fun activatingDisablesRetryButton() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = false, credentialState = CredentialState.MISSING, activating = true),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Telefon aktiválása").assertIsNotEnabled()
    }

    @Test
    fun missingTokenFailureIsShown() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(
                    linked = false,
                    credentialState = CredentialState.MISSING,
                    lastFailure = ActivationFailure.MISSING_TOKEN
                ),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("A szerver nem adott eszkoz tokent, nem mentettem felig aktivalva.").assertIsDisplayed()
    }

    @Test
    fun activeDeviceShowsSyncAllowed() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.AVAILABLE),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Eszköz aktív").assertIsDisplayed()
        compose.onNodeWithText("A szinkron engedélyezett, a token biztonságos tárolóban van.").assertIsDisplayed()
    }

    @Test
    fun invalidCredentialShowsReactivation() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.INVALID),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Újraaktiválás szükséges").assertIsDisplayed()
    }

    @Test
    fun revokedCredentialShowsReactivation() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.REVOKED),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Újraaktiválás szükséges").assertIsDisplayed()
    }

    @Test
    fun deviceDisabledCredentialShowsReactivation() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.DEVICE_DISABLED),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Újraaktiválás szükséges").assertIsDisplayed()
    }

    @Test
    fun driverDisabledCredentialShowsReactivation() {
        compose.setContent {
            ActivationStatusPanel(
                state = ActivationUiState(linked = true, credentialState = CredentialState.DRIVER_DISABLED),
                onOpenActivation = {}
            )
        }

        compose.onNodeWithText("Újraaktiválás szükséges").assertIsDisplayed()
    }
}
