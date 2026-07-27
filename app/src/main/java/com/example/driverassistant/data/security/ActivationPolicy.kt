package com.example.driverassistant.data.security

import java.net.SocketTimeoutException

enum class ActivationFailure {
    INVALID_CODE,
    EXPIRED_CODE,
    DRIVER_DISABLED,
    DEVICE_DISABLED,
    MISSING_TOKEN,
    TIMEOUT,
    SERVER_ERROR,
    BAD_RESPONSE,
    NETWORK,
    UNKNOWN
}

data class ActivationUiState(
    val linked: Boolean,
    val credentialState: CredentialState,
    val activating: Boolean = false,
    val lastFailure: ActivationFailure? = null
) {
    val needsActivation: Boolean
        get() = !linked || credentialState == CredentialState.MISSING

    val needsReactivation: Boolean
        get() = linked && credentialState in setOf(
            CredentialState.REVOKED,
            CredentialState.DEVICE_DISABLED,
            CredentialState.DRIVER_DISABLED,
            CredentialState.REACTIVATION_REQUIRED,
            CredentialState.INVALID
        )

    val syncAllowed: Boolean
        get() = linked && credentialState == CredentialState.AVAILABLE && !activating
}

object ActivationPolicy {
    fun classifyHttpFailure(code: Int, body: String? = null): ActivationFailure = when {
        code == 401 || body.hasAny("INVALID", "NOT_FOUND") -> ActivationFailure.INVALID_CODE
        code == 410 || body.hasAny("EXPIRED") -> ActivationFailure.EXPIRED_CODE
        code == 423 && body.hasAny("DRIVER") -> ActivationFailure.DRIVER_DISABLED
        code == 423 && body.hasAny("DEVICE") -> ActivationFailure.DEVICE_DISABLED
        code in 500..599 -> ActivationFailure.SERVER_ERROR
        else -> ActivationFailure.UNKNOWN
    }

    fun classifyThrowable(error: Throwable): ActivationFailure = when (error) {
        is SocketTimeoutException -> ActivationFailure.TIMEOUT
        else -> ActivationFailure.NETWORK
    }

    fun message(failure: ActivationFailure): String = when (failure) {
        ActivationFailure.INVALID_CODE -> "Ervenytelen aktivalo kod."
        ActivationFailure.EXPIRED_CODE -> "Lejart aktivalo kod. Kerj uj kodot az admin feluleten."
        ActivationFailure.DRIVER_DISABLED -> "A sofor inaktiv. Admin ujraaktivalas szukseges."
        ActivationFailure.DEVICE_DISABLED -> "Az eszkoz le van tiltva. Ujraaktivalas szukseges."
        ActivationFailure.MISSING_TOKEN -> "A szerver nem adott eszkoz tokent, nem mentettem felig aktivalva."
        ActivationFailure.TIMEOUT -> "Idotullepes. A helyi adatok megmaradtak, probald ujra."
        ActivationFailure.SERVER_ERROR -> "Szerverhiba tortent. A helyi adatok megmaradtak."
        ActivationFailure.BAD_RESPONSE -> "Hibas szerver valasz. A helyi adatok megmaradtak."
        ActivationFailure.NETWORK -> "Halozati hiba. Offline modban a helyi adatok megmaradnak."
        ActivationFailure.UNKNOWN -> "Az aktivalas nem sikerult."
    }

    private fun String?.hasAny(vararg needles: String): Boolean {
        if (this == null) return false
        val upper = uppercase()
        return needles.any { upper.contains(it) }
    }
}
