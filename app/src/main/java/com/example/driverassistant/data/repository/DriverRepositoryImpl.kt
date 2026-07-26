package com.example.driverassistant.data.repository

import com.example.driverassistant.data.local.dao.DriverDao
import com.example.driverassistant.domain.model.*
import com.example.driverassistant.domain.repository.DriverRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import javax.inject.Inject

class DriverRepositoryImpl @Inject constructor(
    private val dao: DriverDao,
    private val backendApi: com.example.driverassistant.data.api.BackendApi
) : DriverRepository {
    override fun getAllTours(driverName: String): Flow<List<Tour>> = dao.getAllTours(driverName)
    override suspend fun getAllToursWithDeleted(driverName: String): List<Tour> = dao.getAllToursWithDeleted(driverName)
    override suspend fun insertTour(tour: Tour): Long = dao.insertTour(tour)
    override suspend fun updateTour(tour: Tour) = dao.updateTour(tour)
    override suspend fun deleteTour(tour: Tour) = dao.updateTour(tour.copy(deletedAt = System.currentTimeMillis()))

    override fun getStopsForTour(tourId: Long): Flow<List<Stop>> = dao.getStopsForTour(tourId).onEach { stops ->
        android.util.Log.d("DashboardTrace", "DriverRepository.getStopsForTour EMIT: TourID: $tourId, StopCount: ${stops.size}")
    }
    override suspend fun getStopsForTourWithDeleted(tourId: Long): List<Stop> = dao.getStopsForTourWithDeleted(tourId)
    override suspend fun getStopById(stopId: Long): Stop? = dao.getStopById(stopId)
    override suspend fun insertStop(stop: Stop) = dao.insertStop(stop)
    override suspend fun updateStop(stop: Stop) = dao.updateStop(stop)
    override suspend fun deleteStop(stop: Stop) = dao.updateStop(stop.copy(deletedAt = System.currentTimeMillis()))

    override fun getAllDocuments(driverName: String): Flow<List<Document>> = dao.getAllDocuments(driverName)
    override suspend fun insertDocument(document: Document) = dao.insertDocument(document)
    override suspend fun updateDocument(document: Document) = dao.updateDocument(document)
    override suspend fun deleteDocument(document: Document) = dao.deleteDocument(document)

    override fun getAllCosts(driverName: String): Flow<List<Cost>> = dao.getAllCosts(driverName)
    override suspend fun insertCost(cost: Cost) = dao.insertCost(cost)
    override suspend fun updateCost(cost: Cost) = dao.updateCost(cost)
    override suspend fun deleteCost(cost: Cost) = dao.deleteCost(cost)

    // Hotels
    override fun getAllHotels(driverName: String): Flow<List<Hotel>> = dao.getAllHotels(driverName)
    override fun getHotelsForTour(tourId: Long): Flow<List<Hotel>> = dao.getHotelsForTour(tourId)
    override fun getHotelById(id: Long): Flow<Hotel?> = dao.getHotelById(id)
    override fun getHotelStops(driverName: String): Flow<List<Stop>> = dao.getHotelStops(driverName)
    override suspend fun insertHotel(hotel: Hotel) = dao.insertHotel(hotel)
    override suspend fun insertHotels(hotels: List<Hotel>) = dao.insertHotels(hotels)
    override suspend fun updateHotel(hotel: Hotel) = dao.updateHotel(hotel)
    override suspend fun deleteHotel(hotel: Hotel) = dao.deleteHotel(hotel)
    override suspend fun deleteHotelByPublicId(publicId: String) = dao.deleteHotelByPublicId(publicId)
    override suspend fun getAllHotelsSnapshot(driverName: String): List<Hotel> = dao.getAllHotelsSnapshot(driverName)
    override suspend fun getHotelsForTourSnapshot(tourId: Long): List<Hotel> = dao.getHotelsForTourSnapshot(tourId)

    override suspend fun syncRemoteHotels(driverName: String, remoteHotels: List<Hotel>, syncStartedAt: Long) {
        val localHotels = dao.getAllHotelsSnapshot(driverName)
        val remoteByPublicId = remoteHotels
            .filter { it.publicId.isNotBlank() }
            .associateBy { it.publicId }

        for (remote in remoteHotels) {
            val existing = if (remote.publicId.isNotBlank()) dao.getHotelByPublicId(remote.publicId) else null
            val normalizedRemote = remote.copy(
                id = existing?.id ?: 0,
                driverName = driverName
            )

            if (existing == null) {
                dao.insertHotel(normalizedRemote)
            } else if (remote.updatedAt >= existing.updatedAt) {
                dao.updateHotel(normalizedRemote)
            }
        }

        // Deletions if we are syncing all hotels for a driver
        if (remoteHotels.isNotEmpty()) {
            localHotels
                .filter { it.publicId.isNotBlank() && it.publicId !in remoteByPublicId && it.updatedAt <= syncStartedAt }
                .forEach { dao.deleteHotelByPublicId(it.publicId) }
        }
    }

    override suspend fun insertHotelEvent(event: HotelEvent) = dao.insertHotelEvent(event)
    override suspend fun getUnsyncedHotelEvents(): List<HotelEvent> = dao.getUnsyncedHotelEvents()
    override suspend fun markHotelEventSynced(id: Long) = dao.markHotelEventSynced(id)

    override fun getLocationHistory(): Flow<List<LocationData>> = dao.getLocationHistory()
    override suspend fun insertLocation(location: LocationData) = dao.insertLocation(location)

    override fun getWorkTimesByDate(date: String, driverName: String): Flow<List<WorkTime>> = dao.getWorkTimesByDate(date, driverName)
    override fun getWorkTimesByPattern(pattern: String, driverName: String): Flow<List<WorkTime>> = dao.getWorkTimesByPattern(pattern, driverName)
    override suspend fun insertWorkTime(workTime: WorkTime) = dao.insertWorkTime(workTime)
    override suspend fun updateWorkTime(workTime: WorkTime) = dao.updateWorkTime(workTime)
    override suspend fun deleteWorkTime(workTime: WorkTime) = dao.deleteWorkTime(workTime)
    override suspend fun getAllOngoingWorkTimes(driverName: String): List<WorkTime> = dao.getAllOngoingWorkTimes(driverName)
    override fun getOngoingWorkTimesFlow(driverName: String): Flow<List<WorkTime>> = dao.getOngoingWorkTimesFlow(driverName)
    override suspend fun closeAllOngoingWorkTimes(driverName: String, endTime: Long) = dao.closeAllOngoingWorkTimes(driverName, endTime)

    override suspend fun syncRemoteWorkTimes(driverName: String, remoteWorkTimes: List<WorkTime>) {
        for (remote in remoteWorkTimes) {
            val existing = dao.getWorkTimeByUuid(remote.uuid)
            if (existing == null) {
                dao.insertWorkTime(remote.copy(id = 0))
            } else {
                dao.updateWorkTime(remote.copy(id = existing.id))
            }
        }
    }

    override suspend fun syncRemoteCosts(driverName: String, remoteCosts: List<Cost>) {
        val localCosts = dao.getAllCosts(driverName).first()
        val remoteByUuid = remoteCosts.associateBy { it.uuid }
        for (remote in remoteCosts) {
            val existing = dao.getCostByUuid(remote.uuid)
            if (existing == null) {
                dao.insertCost(remote.copy(id = 0))
            } else {
                dao.updateCost(remote.copy(id = existing.id))
            }
        }
        if (remoteCosts.isNotEmpty()) {
            localCosts.forEach { local ->
                if (local.uuid !in remoteByUuid) dao.deleteCost(local)
            }
        }
    }

    override fun getAllSavedLocations(): Flow<List<SavedLocation>> = dao.getAllSavedLocations()
    override suspend fun insertSavedLocation(location: SavedLocation) = dao.insertSavedLocation(location)
    override suspend fun deleteSavedLocationByType(type: String) = dao.deleteSavedLocationByType(type)

    override suspend fun deleteOldTours(timestamp: Long) = dao.deleteOldTours(timestamp)

    override fun getCurrentTour(driverName: String): Flow<Tour?> = dao.getCurrentTour(driverName)
    override suspend fun setCurrentTour(tourId: Long) = dao.setCurrentTour(tourId)

    override suspend fun syncRemoteTours(driverName: String, remoteTours: List<com.example.driverassistant.data.api.TourWithStops>) {
        val localTours = dao.getAllToursWithDeleted(driverName)
        for (remote in remoteTours) {
            val existing = localTours.find { it.uuid == remote.tour.uuid }
            if (remote.tour.deletedAt != null) {
                if (existing != null) dao.deleteTour(existing)
                continue
            }
            val remoteUpdatedAt = remote.tour.updatedAt ?: 0
            val localUpdatedAt = existing?.updatedAt ?: 0
            val tourId = if (existing != null) {
                if (remoteUpdatedAt > localUpdatedAt) dao.updateTour(remote.tour.copy(id = existing.id))
                existing.id
            } else {
                dao.insertTour(remote.tour.copy(id = 0))
            }
            if (remote.tour.isCurrent) dao.clearOtherCurrentTours(remote.tour.driverName, remote.tour.uuid, System.currentTimeMillis())
            
            // Stops
            val localStops = dao.getStopsForTourWithDeleted(tourId)
            val remoteStopUuids = remote.stops.map { it.uuid }.toSet()
            for (rStop in remote.stops) {
                val existingStop = localStops.find { it.uuid == rStop.uuid }
                if (rStop.deletedAt != null) {
                    if (existingStop != null) dao.deleteStop(existingStop)
                    continue
                }
                val rStopUp = rStop.updatedAt ?: 0
                val lStopUp = existingStop?.updatedAt ?: 0
                if (existingStop != null) {
                    if (rStopUp > lStopUp) dao.updateStop(rStop.copy(id = existingStop.id, tourId = tourId))
                } else {
                    dao.insertStop(rStop.copy(id = 0, tourId = tourId))
                }
            }
            if (remoteUpdatedAt > localUpdatedAt) {
                localStops.filter { it.deletedAt == null && it.uuid !in remoteStopUuids }.forEach {
                    dao.updateStop(it.copy(deletedAt = remoteUpdatedAt, updatedAt = remoteUpdatedAt))
                }
            }
            // Cargo
            if (remote.cargo != null) syncRemoteCargo(tourId, remote.cargo)
        }
    }

    override suspend fun updateStopStatus(stopId: Long, completed: Boolean, time: Long?) = dao.updateStopStatus(stopId, completed, time, System.currentTimeMillis())

    override suspend fun getLastWorkTime(driverName: String): WorkTime? = dao.getLastWorkTime(driverName)
    
    override suspend fun updateDriverName(oldName: String, newName: String) {
        dao.updateWorkTimesDriverName(oldName, newName)
        dao.updateToursDriverName(oldName, newName)
        dao.updateCostsDriverName(oldName, newName)
        dao.updateHotelsDriverName(oldName, newName)
        dao.updateDocumentsDriverName(oldName, newName)
        dao.updateChatMessagesDriverName(oldName, newName)
    }

    override suspend fun syncProfile(name: String, email: String, phone: String, whatsapp: String, telegram: String, plate: String, photoUrl: String?, uuid: String?, profileUpdatedAt: Long): Long? {
        return try {
            val response = backendApi.syncProfile(com.example.driverassistant.data.api.ApiProfile(uuid, name, email, phone, whatsapp, telegram, plate, photoUrl, profileUpdatedAt))
            response.profileUpdatedAt
        } catch (e: Exception) { null }
    }

    override suspend fun getProfile(name: String): com.example.driverassistant.data.api.ApiProfileResponse? = try { backendApi.getProfile(name) } catch (e: Exception) { null }
    override suspend fun activateDriver(code: String, deviceId: String, deviceName: String): com.example.driverassistant.data.api.ApiProfileResponse? = try { backendApi.activateDriver(com.example.driverassistant.data.api.ActivateDriverRequest(code, deviceId, deviceName)) } catch (e: Exception) { null }
    override suspend fun unlinkDevice(uuid: String?, deviceId: String) { try { backendApi.unlinkDevice(com.example.driverassistant.data.api.UnlinkDeviceRequest(uuid, deviceId)) } catch (e: Exception) { } }
    override suspend fun getProfileByUuid(uuid: String): com.example.driverassistant.data.api.ApiProfileResponse? = try { backendApi.getProfileByUuid(uuid) } catch (e: Exception) { null }
    override suspend fun uploadPhoto(driverName: String, base64: String, uuid: String?): com.example.driverassistant.data.api.PhotoUploadResponse? = try { backendApi.uploadPhoto(com.example.driverassistant.data.api.PhotoUploadRequest(driverName, base64, uuid)) } catch (e: Exception) { null }

    override suspend fun getMappingForCustomer(name: String): CustomerMapping? = dao.getMappingForCustomer(name)
    override suspend fun insertCustomerMapping(mapping: CustomerMapping) = dao.insertCustomerMapping(mapping)

    override fun getAllMessages(driverName: String): Flow<List<ChatMessage>> = dao.getAllMessages(driverName)
    override suspend fun insertMessage(message: ChatMessage) = dao.insertMessage(message)

    override fun getCargoForTour(tourId: Long): Flow<List<Cargo>> = dao.getCargoForTour(tourId)
    override suspend fun getCargoForTourWithDeleted(tourId: Long): List<Cargo> = dao.getCargoForTourWithDeleted(tourId)
    override suspend fun insertCargo(cargo: Cargo): Long = dao.insertCargo(cargo)
    override suspend fun updateCargo(cargo: Cargo) = dao.updateCargo(cargo)
    override suspend fun deleteCargo(cargo: Cargo) = dao.deleteCargoById(cargo.id, System.currentTimeMillis())
    override suspend fun getCargoByUuid(uuid: String): Cargo? = dao.getCargoByUuid(uuid)
    override suspend fun getCargoBySerialNumberInTour(serialNumber: String, tourId: Long): Cargo? = dao.getCargoBySerialNumberInTour(serialNumber, tourId)
    override suspend fun getCargoBySerialNumberGlobally(serialNumber: String): Cargo? = dao.getCargoBySerialNumberGlobally(serialNumber)
    override suspend fun insertCargoEvent(event: CargoEvent) = dao.insertCargoEvent(event)
    override fun getEventsForCargo(cargoId: Long): Flow<List<CargoEvent>> = dao.getEventsForCargo(cargoId)

    override suspend fun syncRemoteCargo(tourId: Long, remoteCargo: List<Cargo>) {
        val localCargo = dao.getCargoForTourWithDeleted(tourId)
        val remoteByUuid = remoteCargo.associateBy { it.uuid }
        for (remote in remoteCargo) {
            val existing = localCargo.find { it.uuid == remote.uuid }
            if (remote.deletedAt != null) {
                if (existing != null) dao.deleteCargoById(existing.id, remote.deletedAt)
                continue
            }
            if (existing == null) {
                dao.insertCargo(remote.copy(id = 0, tourId = tourId))
            } else if (remote.updatedAt > existing.updatedAt) {
                dao.updateCargo(remote.copy(id = existing.id, tourId = tourId))
            }
        }
        if (remoteCargo.isNotEmpty()) {
            localCargo.filter { it.deletedAt == null && it.uuid !in remoteByUuid }.forEach { dao.deleteCargoById(it.id, System.currentTimeMillis()) }
        }
    }

    override suspend fun clearAllData() = dao.clearAllData()
}
