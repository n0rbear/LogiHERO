package com.example.driverassistant.data.security

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class CredentialState {
    AVAILABLE,
    MISSING,
    INVALID,
    REVOKED,
    DEVICE_DISABLED,
    DRIVER_DISABLED,
    REACTIVATION_REQUIRED
}

interface CredentialCipher {
    fun encrypt(plainText: String): String
    fun decrypt(payload: String): String
}

class AndroidKeystoreCipher(
    private val alias: String = "logihero_device_token"
) : CredentialCipher {
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    override fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return "${b64(cipher.iv)}:${b64(encrypted)}"
    }

    override fun decrypt(payload: String): String {
        val parts = payload.split(':', limit = 2)
        require(parts.size == 2) { "Invalid encrypted credential payload" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        keyStore.getKey(alias, null)?.let { return it as SecretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

class DeviceCredentialStore(
    context: Context,
    private val cipher: CredentialCipher = AndroidKeystoreCipher()
) {
    private val legacyPrefs: SharedPreferences = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
    private val securePrefs: SharedPreferences = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)

    fun saveDeviceToken(token: String): Boolean {
        if (token.isBlank()) return false
        return runCatching {
            securePrefs.edit()
                .putString(KEY_ENCRYPTED_TOKEN, cipher.encrypt(token))
                .putString(KEY_STATE, CredentialState.AVAILABLE.name)
                .putBoolean(KEY_MIGRATED, true)
                .apply()
            legacyPrefs.edit().remove(LEGACY_TOKEN_KEY).apply()
            true
        }.getOrElse {
            securePrefs.edit().putString(KEY_STATE, CredentialState.INVALID.name).apply()
            false
        }
    }

    fun getDeviceToken(): String? {
        val payload = securePrefs.getString(KEY_ENCRYPTED_TOKEN, null) ?: return null
        return runCatching { cipher.decrypt(payload) }.getOrElse {
            securePrefs.edit().putString(KEY_STATE, CredentialState.INVALID.name).apply()
            null
        }
    }

    fun state(): CredentialState {
        val stored = securePrefs.getString(KEY_STATE, null)
        if (stored != null) return runCatching { CredentialState.valueOf(stored) }.getOrDefault(CredentialState.INVALID)
        return if (securePrefs.contains(KEY_ENCRYPTED_TOKEN)) CredentialState.AVAILABLE else CredentialState.MISSING
    }

    fun markState(state: CredentialState) {
        securePrefs.edit().putString(KEY_STATE, state.name).apply()
    }

    fun migrateLegacyTokenIfNeeded(): Boolean {
        if (securePrefs.contains(KEY_ENCRYPTED_TOKEN)) {
            securePrefs.edit().putBoolean(KEY_MIGRATED, true).apply()
            return true
        }
        val legacy = legacyPrefs.getString(LEGACY_TOKEN_KEY, null)
        if (legacy.isNullOrBlank()) {
            securePrefs.edit().putBoolean(KEY_MIGRATED, true).apply()
            return true
        }
        val saved = saveDeviceToken(legacy)
        if (saved && getDeviceToken() == legacy) {
            legacyPrefs.edit().remove(LEGACY_TOKEN_KEY).apply()
            return true
        }
        return false
    }

    fun clear() {
        securePrefs.edit().clear().apply()
        legacyPrefs.edit().remove(LEGACY_TOKEN_KEY).apply()
    }

    companion object {
        const val LEGACY_PREFS = "driver_prefs"
        const val SECURE_PREFS = "device_credentials"
        const val LEGACY_TOKEN_KEY = "device_token"
        private const val KEY_ENCRYPTED_TOKEN = "device_token_encrypted"
        private const val KEY_STATE = "credential_state"
        private const val KEY_MIGRATED = "legacy_token_migrated"
    }
}
