package com.example.driverassistant.credentials

import android.content.Context
import java.security.KeyStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.driverassistant.data.security.CredentialState
import com.example.driverassistant.data.security.DeviceCredentialStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceCredentialStoreInstrumentedTest {
    private lateinit var context: Context
    private lateinit var store: DeviceCredentialStore

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("device_credentials", Context.MODE_PRIVATE).edit().clear().commit()
        store = DeviceCredentialStore(context)
    }

    @After
    fun tearDown() {
        store.clear()
    }

    @Test
    fun savesAndReadsTokenThroughKeystore() {
        assertTrue(store.saveDeviceToken("token-one"))
        assertEquals("token-one", store.getDeviceToken())
        assertEquals(CredentialState.AVAILABLE, store.state())
    }

    @Test
    fun overwritesTokenOnRotation() {
        assertTrue(store.saveDeviceToken("old-token"))
        assertTrue(store.saveDeviceToken("new-token"))
        assertEquals("new-token", store.getDeviceToken())
        assertNotEquals("old-token", store.getDeviceToken())
    }

    @Test
    fun clearsTokenAndReportsMissing() {
        assertTrue(store.saveDeviceToken("token-clear"))
        store.clear()
        assertNull(store.getDeviceToken())
        assertEquals(CredentialState.MISSING, store.state())
    }

    @Test
    fun missingTokenIsHandled() {
        assertNull(store.getDeviceToken())
        assertEquals(CredentialState.MISSING, store.state())
    }

    @Test
    fun corruptedPayloadBecomesInvalidWithoutLeakingToken() {
        val secure = context.getSharedPreferences("device_credentials", Context.MODE_PRIVATE)
        secure.edit().putString("device_token_encrypted", "not-valid").commit()
        assertNull(store.getDeviceToken())
        assertEquals(CredentialState.INVALID, store.state())
    }

    @Test
    fun keystoreAliasExistsAfterSave() {
        assertTrue(store.saveDeviceToken("alias-token"))
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        assertTrue(keyStore.containsAlias("logihero_device_token"))
    }

    @Test
    fun migratesLegacyTokenAndRemovesPlainPreference() {
        val legacy = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
        legacy.edit().putString("device_token", "legacy-token").commit()
        assertTrue(store.migrateLegacyTokenIfNeeded())
        assertEquals("legacy-token", store.getDeviceToken())
        assertFalse(legacy.contains("device_token"))
    }

    @Test
    fun secureTokenPreventsRemigrationOnRestart() {
        val legacy = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
        assertTrue(store.saveDeviceToken("secure-token"))
        legacy.edit().putString("device_token", "plain-token").commit()
        val restarted = DeviceCredentialStore(context)
        assertTrue(restarted.migrateLegacyTokenIfNeeded())
        assertEquals("secure-token", restarted.getDeviceToken())
        assertTrue(legacy.contains("device_token"))
    }

    @Test
    fun rawTokenIsNotStoredInLegacyPreferences() {
        val legacy = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
        assertTrue(store.saveDeviceToken("raw-sensitive-token"))
        assertFalse(legacy.all.values.contains("raw-sensitive-token"))
        assertNotNull(store.getDeviceToken())
    }
}
