package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.HotelStatusRequest
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.model.HotelEvent
import com.example.driverassistant.domain.repository.DriverRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HotelsViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen") ?: "Ismeretlen"

    init {
        syncHotelsWithBackend()
    }

    val hotels = repository.getAllHotels(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun getHotelById(id: Long): Flow<Hotel?> = repository.getHotelById(id)

    fun syncHotelsWithBackend() {
        viewModelScope.launch {
            try {
                // 1. Process offline events
                val unsyncedEvents = repository.getUnsyncedHotelEvents()
                for (event in unsyncedEvents) {
                    try {
                        val request = HotelStatusRequest(
                            driverName = driverName,
                            reason = event.reason,
                            clientEventId = event.clientEventId,
                            metadata = event.metadata
                        )
                        when (event.eventType) {
                            "CHECKED_IN" -> backendApi.checkInHotel(event.hotelId, request)
                            "CHECKED_OUT" -> backendApi.checkOutHotel(event.hotelId, request)
                            "PROBLEM" -> backendApi.reportHotelProblem(event.hotelId, request)
                            "CANCELLED" -> backendApi.cancelHotel(event.hotelId, request)
                            "CONFIRMED" -> backendApi.confirmHotel(event.hotelId, request)
                        }
                        repository.markHotelEventSynced(event.id)
                    } catch (e: Exception) {
                        android.util.Log.e("SyncError", "Failed to sync hotel event ${event.id}", e)
                    }
                }

                // 2. Pull all hotels for driver
                val remoteHotels = backendApi.getManualHotels(driverName) // Backend renamed or unified needed? 
                // Let's assume backend returns all relevant hotels for driver
                repository.syncRemoteHotels(driverName, remoteHotels, System.currentTimeMillis())

                // 3. Pull tour hotels if there's a current tour
                repository.getCurrentTour(driverName).first()?.let { tour ->
                    val tourHotels = backendApi.getHotelsForTour(tour.id)
                    repository.insertHotels(tourHotels)
                }

            } catch (e: Exception) {
                android.util.Log.e("SyncError", "Failed to sync hotels", e)
            }
        }
    }

    fun transitionStatus(hotel: Hotel, toStatus: String, reason: String? = null) {
        viewModelScope.launch {
            val event = HotelEvent(
                hotelId = hotel.id,
                eventType = toStatus,
                fromStatus = hotel.status,
                toStatus = toStatus,
                actorId = driverName,
                reason = reason
            )
            repository.insertHotelEvent(event)
            
            // Optimistic local update
            repository.updateHotel(hotel.copy(status = toStatus, updatedAt = System.currentTimeMillis()))
            
            syncHotelsWithBackend()
        }
    }
}
