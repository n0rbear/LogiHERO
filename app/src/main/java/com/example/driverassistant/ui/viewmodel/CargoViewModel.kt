package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.CargoTransitionRequest
import com.example.driverassistant.domain.model.Cargo
import com.example.driverassistant.domain.model.CargoEvent
import com.example.driverassistant.domain.repository.DriverRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CargoViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing = _isProcessing.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    fun getCargoForTour(tourId: Long): Flow<List<Cargo>> = repository.getCargoForTour(tourId)

    fun getStopsForTour(tourId: Long) = repository.getStopsForTour(tourId)

    fun pickupCargo(cargo: Cargo, stopId: Long, condition: String?, reason: String?) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val now = System.currentTimeMillis()
                val updated = cargo.copy(
                    status = "PICKED_UP",
                    conditionAtPickup = condition,
                    updatedAt = now
                )
                repository.updateCargo(updated)
                repository.insertCargoEvent(CargoEvent(
                    cargoId = cargo.id,
                    eventType = "PICKED_UP",
                    fromStatus = cargo.status,
                    toStatus = "PICKED_UP",
                    actorType = "DRIVER",
                    actorId = driverName,
                    stopId = stopId,
                    timestamp = now,
                    reason = reason
                ))
                
                // Sync with backend
                try {
                    backendApi.pickupCargo(cargo.id, CargoTransitionRequest(
                        stopId = stopId,
                        driverName = driverName,
                        condition = condition,
                        reason = reason
                    ))
                } catch (e: Exception) {
                    android.util.Log.e("CargoSync", "Failed to sync pickup", e)
                }
            } catch (e: Exception) {
                _error.value = "Hiba a felvétel során: ${e.message}"
            } finally {
                _isProcessing.value = false
            }
        }
    }

    fun deliverCargo(cargo: Cargo, stopId: Long, condition: String?, reason: String?) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val now = System.currentTimeMillis()
                val updated = cargo.copy(
                    status = "DELIVERED",
                    conditionAtDelivery = condition,
                    updatedAt = now
                )
                repository.updateCargo(updated)
                repository.insertCargoEvent(CargoEvent(
                    cargoId = cargo.id,
                    eventType = "DELIVERED",
                    fromStatus = cargo.status,
                    toStatus = "DELIVERED",
                    actorType = "DRIVER",
                    actorId = driverName,
                    stopId = stopId,
                    timestamp = now,
                    reason = reason
                ))
                
                // Sync with backend
                try {
                    backendApi.deliverCargo(cargo.id, CargoTransitionRequest(
                        stopId = stopId,
                        driverName = driverName,
                        condition = condition,
                        reason = reason
                    ))
                } catch (e: Exception) {
                    android.util.Log.e("CargoSync", "Failed to sync delivery", e)
                }
            } catch (e: Exception) {
                _error.value = "Hiba a leadás során: ${e.message}"
            } finally {
                _isProcessing.value = false
            }
        }
    }

    fun reportProblem(cargo: Cargo, stopId: Long, type: String, reason: String) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val now = System.currentTimeMillis()
                val status = if (type == "Sérült") "DAMAGED" else "MISSING"
                val updated = cargo.copy(
                    status = status,
                    updatedAt = now
                )
                repository.updateCargo(updated)
                repository.insertCargoEvent(CargoEvent(
                    cargoId = cargo.id,
                    eventType = if (type == "Sérült") "DAMAGED_REPORTED" else "MISSING_REPORTED",
                    fromStatus = cargo.status,
                    toStatus = status,
                    actorType = "DRIVER",
                    actorId = driverName,
                    stopId = stopId,
                    timestamp = now,
                    reason = reason
                ))
                
                // Sync with backend
                try {
                    if (type == "Sérült") {
                        backendApi.reportDamage(cargo.id, CargoTransitionRequest(stopId = stopId, driverName = driverName, reason = reason))
                    } else {
                        backendApi.reportMissing(cargo.id, CargoTransitionRequest(stopId = stopId, driverName = driverName, reason = reason))
                    }
                } catch (e: Exception) {
                    android.util.Log.e("CargoSync", "Failed to sync problem report", e)
                }
            } catch (e: Exception) {
                _error.value = "Hiba a bejelentés során: ${e.message}"
            } finally {
                _isProcessing.value = false
            }
        }
    }
    
    fun clearError() { _error.value = null }
}
