package com.example.driverassistant.domain.repository

import com.example.driverassistant.domain.model.*
import kotlinx.coroutines.flow.Flow

interface DriverRepository {
    fun getAllTours(driverName: String): Flow<List<Tour>>
    suspend fun getAllToursWithDeleted(driverName: String): List<Tour>
    suspend fun insertTour(tour: Tour): Long
    suspend fun updateTour(tour: Tour)
    suspend fun deleteTour(tour: Tour)

    fun getStopsForTour(tourId: Long): Flow<List<Stop>>
    suspend fun getStopsForTourWithDeleted(tourId: Long): List<Stop>
    suspend fun getStopById(stopId: Long): Stop?
    suspend fun insertStop(stop: Stop)
    suspend fun updateStop(stop: Stop)
    suspend fun deleteStop(stop: Stop)

    fun getAllDocuments(driverName: String): Flow<List<Document>>
    suspend fun insertDocument(document: Document)
    suspend fun updateDocument(document: Document)
    suspend fun deleteDocument(document: Document)

    fun getAllCosts(driverName: String): Flow<List<Cost>>
    suspend fun insertCost(cost: Cost)
    suspend fun updateCost(cost: Cost)
    suspend fun deleteCost(cost: Cost)

    fun getAllHotels(driverName: String): Flow<List<Hotel>>
    fun getHotelsForTour(tourId: Long): Flow<List<Hotel>>
    fun getHotelById(id: Long): Flow<Hotel?>
    fun getHotelStops(driverName: String): Flow<List<Stop>>
    suspend fun insertHotel(hotel: Hotel)
    suspend fun insertHotels(hotels: List<Hotel>)
    suspend fun updateHotel(hotel: Hotel)
    suspend fun deleteHotel(hotel: Hotel)
    suspend fun deleteHotelByPublicId(publicId: String)
    suspend fun getAllHotelsSnapshot(driverName: String): List<Hotel>
    suspend fun getHotelsForTourSnapshot(tourId: Long): List<Hotel>
    suspend fun syncRemoteHotels(driverName: String, remoteHotels: List<Hotel>, syncStartedAt: Long)
    
    // Hotel Events
    suspend fun insertHotelEvent(event: HotelEvent)
    suspend fun getUnsyncedHotelEvents(): List<HotelEvent>
    suspend fun markHotelEventSynced(id: Long)

    fun getLocationHistory(): Flow<List<LocationData>>
    suspend fun insertLocation(location: LocationData)

    fun getWorkTimesByDate(date: String, driverName: String): Flow<List<WorkTime>>
    fun getWorkTimesByPattern(pattern: String, driverName: String): Flow<List<WorkTime>>
    suspend fun insertWorkTime(workTime: WorkTime)
    suspend fun updateWorkTime(workTime: WorkTime)
    suspend fun deleteWorkTime(workTime: WorkTime)
    suspend fun getAllOngoingWorkTimes(driverName: String): List<WorkTime>
    fun getOngoingWorkTimesFlow(driverName: String): Flow<List<WorkTime>>
    suspend fun closeAllOngoingWorkTimes(driverName: String, endTime: Long)
    suspend fun syncRemoteWorkTimes(driverName: String, remoteWorkTimes: List<WorkTime>)
    suspend fun syncRemoteCosts(driverName: String, remoteCosts: List<Cost>)

    fun getAllSavedLocations(): Flow<List<SavedLocation>>
    suspend fun insertSavedLocation(location: SavedLocation)
    suspend fun deleteSavedLocationByType(type: String)

    suspend fun deleteOldTours(timestamp: Long)

    fun getCurrentTour(driverName: String): Flow<Tour?>
    suspend fun setCurrentTour(tourId: Long)
    suspend fun syncRemoteTours(driverName: String, remoteTours: List<com.example.driverassistant.data.api.TourWithStops>)
    suspend fun updateStopStatus(stopId: Long, completed: Boolean, time: Long?)

    suspend fun getLastWorkTime(driverName: String): WorkTime?
    suspend fun updateDriverName(oldName: String, newName: String)

    suspend fun syncProfile(name: String, email: String, phone: String, whatsapp: String, telegram: String, plate: String, photoUrl: String?, uuid: String?, profileUpdatedAt: Long): Long?
    suspend fun activateDriver(code: String, deviceId: String, deviceName: String): com.example.driverassistant.data.api.ApiProfileResponse?
    suspend fun unlinkDevice(uuid: String?, deviceId: String)
    suspend fun getProfile(name: String): com.example.driverassistant.data.api.ApiProfileResponse?
    suspend fun getProfileByUuid(uuid: String): com.example.driverassistant.data.api.ApiProfileResponse?
    suspend fun uploadPhoto(driverName: String, base64: String, uuid: String?): com.example.driverassistant.data.api.PhotoUploadResponse?

    suspend fun getMappingForCustomer(name: String): CustomerMapping?
    suspend fun insertCustomerMapping(mapping: CustomerMapping)

    fun getAllMessages(driverName: String): Flow<List<ChatMessage>>
    suspend fun insertMessage(message: ChatMessage)

    // Cargo
    fun getCargoForTour(tourId: Long): Flow<List<Cargo>>
    suspend fun getCargoForTourWithDeleted(tourId: Long): List<Cargo>
    suspend fun insertCargo(cargo: Cargo): Long
    suspend fun updateCargo(cargo: Cargo)
    suspend fun deleteCargo(cargo: Cargo)
    suspend fun getCargoByUuid(uuid: String): Cargo?
    suspend fun getCargoBySerialNumberInTour(serialNumber: String, tourId: Long): Cargo?
    suspend fun getCargoBySerialNumberGlobally(serialNumber: String): Cargo?
    suspend fun insertCargoEvent(event: CargoEvent)
    fun getEventsForCargo(cargoId: Long): Flow<List<CargoEvent>>
    suspend fun syncRemoteCargo(tourId: Long, remoteCargo: List<Cargo>)

    suspend fun clearAllData()
}
