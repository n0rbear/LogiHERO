package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.OsrmApi
import com.example.driverassistant.data.api.WorkTimeConflictDto
import com.example.driverassistant.data.sync.DeltaSyncEngine
import com.example.driverassistant.data.sync.DeltaSyncResult
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.model.Stop
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.domain.repository.LocationRepository
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.awaitClose
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val locationRepository: LocationRepository,
    private val backendApi: BackendApi,
    private val deltaSyncEngine: DeltaSyncEngine,
    private val osrmApi: OsrmApi,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context
) : ViewModel() {

    private val gson = Gson()
    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    
    // Reaktív sofőr név, ami figyeli a változásokat
    private val _driverName = MutableStateFlow(prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr")
    val driverNameFlow = _driverName.asStateFlow()
    private val driverName get() = _driverName.value
    private val _driverPhoto = MutableStateFlow(prefs.getString("driver_photo", null))
    val driverPhoto = _driverPhoto.asStateFlow()

    val lastLocation = locationRepository.getLocationHistory()
        .map { it.firstOrNull() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val dateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    fun getCurrentDate() = dateSdf.format(Date())

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val workTimes = combine(
        flow {
            while(true) {
                emit(getCurrentDate())
                kotlinx.coroutines.delay(60000)
            }
        },
        driverNameFlow
    ) { date, name ->
        date to name
    }.flatMapLatest { (date, name) ->
        repository.getWorkTimesByDate(date, name)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val ongoingWorkTime = driverNameFlow.flatMapLatest { name ->
        repository.getOngoingWorkTimesFlow(name)
    }.map { all ->
        all.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val _workTimeConflicts = MutableStateFlow<List<WorkTimeConflictDto>>(emptyList())
    val workTimeConflicts = _workTimeConflicts.asStateFlow()

    private val _lastData = MutableStateFlow<Pair<String, Int>?>(null)
    val lastData = _lastData.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    data class ServerStatusData(
        val nextDist: Float?,
        val nextDur: Long?,
        val tourDist: Float?,
        val tourDur: Long?,
        val nextStopInfo: String?
    )

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val serverStatusData = callbackFlow<ServerStatusData?> {
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { p, key ->
            if (key?.startsWith("server_") == true) {
                val nextDist = p.getFloat("server_next_stop_dist", -1f).takeIf { it >= 0 }
                val nextDur = p.getLong("server_next_stop_dur", -1L).takeIf { it >= 0 }
                val tourDist = p.getFloat("server_tour_dist", -1f).takeIf { it >= 0 }
                val tourDur = p.getLong("server_tour_dur", -1L).takeIf { it >= 0 }
                val nextStopInfo = p.getString("server_next_stop_info", null)
                trySend(ServerStatusData(nextDist, nextDur, tourDist, tourDur, nextStopInfo))
            }
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        val nextDist = prefs.getFloat("server_next_stop_dist", -1f).takeIf { it >= 0 }
        val nextDur = prefs.getLong("server_next_stop_dur", -1L).takeIf { it >= 0 }
        val tourDist = prefs.getFloat("server_tour_dist", -1f).takeIf { it >= 0 }
        val tourDur = prefs.getLong("server_tour_dur", -1L).takeIf { it >= 0 }
        val nextStopInfo = prefs.getString("server_next_stop_info", null)
        send(ServerStatusData(nextDist, nextDur, tourDist, tourDur, nextStopInfo))
        awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val _includeRests = MutableStateFlow(prefs.getBoolean("include_rests", true))
    val includeRests = _includeRests.asStateFlow()

    fun setIncludeRests(value: Boolean) {
        _includeRests.value = value
        prefs.edit().putBoolean("include_rests", value).apply()
    }

    val drivingTimeTodaySeconds = workTimes.map { list ->
        list.filter { normalizeStatus(it.status.ifBlank { it.type }) == "DRIVING" }
            .sumOf { (it.endTime ?: System.currentTimeMillis()) - it.startTime } / 1000
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0L)

    private fun normalizeStatus(value: String): String = when (value) {
        "Vezetés", "Vezetes", "DRIVING" -> "DRIVING"
        "Pihenő", "Piheno", "REST" -> "REST"
        "Szünet", "Szunet", "BREAK" -> "BREAK"
        "Rendelkezésre állás", "Rendelkezesre allas", "AVAILABILITY" -> "AVAILABILITY"
        "Offline", "OFFLINE" -> "OFFLINE"
        else -> "WORK"
    }

    private fun displayStatus(value: String): String = when (normalizeStatus(value)) {
        "DRIVING" -> "Vezetés"
        "REST" -> "Pihenő"
        "BREAK" -> "Szünet"
        "AVAILABILITY" -> "Rendelkezésre állás"
        "OFFLINE" -> "Offline"
        else -> "Munka"
    }

    init {
        // Figyeljük a preferenciák változását (pl. profil szerkesztés után)
        viewModelScope.launch {
            while(true) {
                val latest = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                if (latest != _driverName.value) _driverName.value = latest
                val latestPhoto = prefs.getString("driver_photo", null)
                if (latestPhoto != _driverPhoto.value) _driverPhoto.value = latestPhoto
                kotlinx.coroutines.delay(2000)
            }
        }

        viewModelScope.launch {
            val last = repository.getLastWorkTime(_driverName.value)
            val defaultPlate = prefs.getString("default_plate", "") ?: ""
            if (last != null) {
                _lastData.value = (last.licensePlate ?: defaultPlate) to (last.endMileage ?: last.mileage ?: 0)
            } else if (defaultPlate.isNotBlank()) {
                _lastData.value = defaultPlate to 0
            }
            
            while(true) {
                syncWithBackend()
                syncTours()
                syncHotels()
                kotlinx.coroutines.delay(60000)
            }
        }
    }

    private fun syncTours() {
        viewModelScope.launch {
            try {
                android.util.Log.d("SyncDebug", "--- START SYNC (DashboardViewModel) ---")
                
                // 1. PUSH local changes
                val tours = repository.getAllToursWithDeleted(_driverName.value)
                val toursWithStops = tours.map { t ->
                    com.example.driverassistant.data.api.TourWithStops(
                        t, 
                        repository.getStopsForTourWithDeleted(t.id),
                        repository.getCargoForTourWithDeleted(t.id)
                    )
                }
                android.util.Log.d("SyncDebug", "PUSH Payload for driver: ${_driverName.value}")
                backendApi.syncTours(_driverName.value, toursWithStops)

                // 2. PULL remote changes
                val remoteTours = backendApi.getTours(_driverName.value)
                repository.syncRemoteTours(_driverName.value, remoteTours)
                
                android.util.Log.d("SyncDebug", "--- SYNC COMPLETED SUCCESSFULLY (Dashboard) ---")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- SYNC FAILED (Dashboard) ---", e)
            }
        }
    }

    private fun syncHotels() {
        viewModelScope.launch {
            try {
                val syncStartedAt = System.currentTimeMillis()
                val remoteHotels = backendApi.getManualHotels(_driverName.value)
                repository.syncRemoteHotels(_driverName.value, remoteHotels, syncStartedAt)
                val allHotels = repository.getAllHotelsSnapshot(_driverName.value)
                backendApi.syncHotels(allHotels)
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- HOTEL SYNC FAILED (Dashboard) ---", e)
            }
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val currentTour = driverNameFlow.flatMapLatest { name ->
        repository.getCurrentTour(name)
    }
        .onEach { tour ->
            if (tour != null) {
                android.util.Log.d("DashboardTrace", "DashboardViewModel.currentTour COLLECT: ID: ${tour.id}, UUID: ${tour.uuid}, Name: ${tour.name}, isCurrent: ${tour.isCurrent}, isClosed: ${tour.isClosed}, updatedAt: ${tour.updatedAt}")
            } else {
                android.util.Log.d("DashboardTrace", "DashboardViewModel.currentTour COLLECT: NULL")
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val currentStops = currentTour.flatMapLatest { tour ->
        if (tour != null) repository.getStopsForTour(tour.id) else flowOf(emptyList())
    }.onEach { stops ->
        stops.forEach { stop ->
            if (stop.latitude == null || stop.latitude == 0.0) {
                geocodeStop(stop)
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val profileDepot = repository.getAllSavedLocations()
        .map { it.find { loc -> loc.type == "BASE" } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val nextStop = currentTour.flatMapLatest { tour ->
        if (tour != null) {
            repository.getStopsForTour(tour.id).map { stops ->
                val stop = stops.find { !it.isCompleted }
                android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop COMPUTE: TourID: ${tour.id}, StopFound: ${stop?.contactName}")
                stop
            }
        } else {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop COMPUTE: Tour is NULL")
            flowOf(null)
        }
    }.onEach { stop ->
        if (stop != null) {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop EMIT: ${stop.contactName}, isCompleted: ${stop.isCompleted}")
        } else {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop EMIT: NULL")
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val nextHotel = currentTour.flatMapLatest { tour ->
        if (tour != null) {
            repository.getHotelsForTour(tour.id).map { hotels ->
                hotels.filter { it.status != "CHECKED_OUT" && it.status != "CANCELLED" }
                    .sortedBy { it.checkInDate ?: "" }
                    .firstOrNull()
            }
        } else {
            flowOf(null)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun geocodeStop(stop: Stop) {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val geocoder = android.location.Geocoder(context, java.util.Locale.getDefault())
                @Suppress("DEPRECATION")
                val addresses = geocoder.getFromLocationName(stop.address, 1)
                addresses?.firstOrNull()?.let { addr ->
                    repository.updateStop(stop.copy(
                        latitude = addr.latitude,
                        longitude = addr.longitude,
                        updatedAt = System.currentTimeMillis()
                    ))
                    android.util.Log.d("Geocode", "Successfully geocoded stop ${stop.id}: ${addr.latitude}, ${addr.longitude}")
                }
            } catch (e: Exception) {
                android.util.Log.e("Geocode", "Failed to geocode stop ${stop.id}: ${stop.address}", e)
            }
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val nextStopDistance = combine(
        locationRepository.getLocationHistory().map { it.firstOrNull() },
        nextStop,
        currentTour,
        repository.getAllSavedLocations().map { it.find { loc -> loc.type == "BASE" } }
    ) { location, stop, tour, profileDepot ->
        if (location != null) {
            val targetLat: Double
            val targetLng: Double
            
            if (stop != null && stop.latitude != null && stop.longitude != null && stop.latitude != 0.0) {
                targetLat = stop.latitude
                targetLng = stop.longitude
            } else if (profileDepot != null && profileDepot.latitude != null && profileDepot.latitude != 0.0) {
                targetLat = profileDepot.latitude
                targetLng = profileDepot.longitude
            } else {
                return@combine null
            }

            try {
                val coords = "${location.longitude},${location.latitude};$targetLng,$targetLat"
                val response = osrmApi.getRoute(coords)
                val route = response.routes.firstOrNull()
                (route?.distance ?: 0.0) / 1000.0 to (route?.duration?.toLong() ?: 0L)
            } catch (e: Exception) {
                // Fallback to Haversine if OSRM fails (offline)
                val dist = haversineDistance(location.latitude, location.longitude, targetLat, targetLng)
                val dur = (dist / 62.0 * 3600.0).toLong() // Estimate at 62 km/h
                dist to dur
            }
        } else {
            null
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val tourRemainingDistance = combine(
        locationRepository.getLocationHistory().map { it.firstOrNull() },
        currentTour,
        currentTour.flatMapLatest { tour ->
            if (tour != null) repository.getStopsForTour(tour.id) else flowOf(emptyList())
        },
        repository.getAllSavedLocations().map { it.find { loc -> loc.type == "BASE" } }
    ) { location, tour, stops, profileDepot ->
        if (location != null && tour != null) {
            val incompleteStops = stops.filter { !it.isCompleted && it.latitude != null && it.longitude != null && it.latitude != 0.0 }
            
            val depotLat = profileDepot?.latitude?.takeIf { it != 0.0 }
            val depotLng = profileDepot?.longitude?.takeIf { it != 0.0 }

            if (incompleteStops.isEmpty() && (depotLat == null || depotLng == null)) return@combine null

            val waypoints = mutableListOf("${location.longitude},${location.latitude}")
            waypoints.addAll(incompleteStops.map { "${it.longitude},${it.latitude}" })
            
            if (depotLat != null && depotLng != null) {
                waypoints.add("$depotLng,$depotLat")
            }
            
            if (waypoints.size < 2) return@combine null

            try {
                val coords = waypoints.joinToString(";")
                val response = osrmApi.getRoute(coords)
                val route = response.routes.firstOrNull()
                (route?.distance ?: 0.0) / 1000.0 to (route?.duration?.toLong() ?: 0L)
            } catch (e: Exception) {
                // Fallback to Haversine chain
                var totalDist = 0.0
                var currentLat = location.latitude
                var currentLng = location.longitude
                
                incompleteStops.forEach { s ->
                    totalDist += haversineDistance(currentLat, currentLng, s.latitude!!, s.longitude!!)
                    currentLat = s.latitude
                    currentLng = s.longitude
                }
                
                if (depotLat != null && depotLng != null) {
                    totalDist += haversineDistance(currentLat, currentLng, depotLat, depotLng)
                }
                
                val totalDur = (totalDist / 62.0 * 3600.0).toLong()
                totalDist to totalDur
            }
        } else {
            null
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun arriveStop(stopId: Long) {
        viewModelScope.launch {
            val stop = repository.getStopById(stopId)
            if (stop != null) {
                repository.updateStop(stop.copy(
                    stopStatus = "ARRIVED",
                    arrivalTime = stop.arrivalTime ?: System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis()
                ))
                syncTours()
            }
        }
    }

    fun completeStop(stopId: Long) {
        viewModelScope.launch {
            val stop = repository.getStopById(stopId)
            if (stop != null) {
                // Check for pending cargo operations at this stop
                val tourId = stop.tourId
                val cargoList = repository.getCargoForTour(tourId).first()
                
                val pendingPickup = cargoList.filter { it.pickupStopId == stopId && it.status == "READY_FOR_PICKUP" }
                val pendingDelivery = cargoList.filter { it.deliveryStopId == stopId && (it.status == "PICKED_UP" || it.status == "IN_TRANSIT") }
                
                if (pendingPickup.isNotEmpty() || pendingDelivery.isNotEmpty()) {
                    _error.value = "Hiba: Ezen a megállón még van elvégzetlen szállítmány feladat!"
                    return@launch
                }

                repository.updateStop(stop.copy(
                    stopStatus = "COMPLETED",
                    isCompleted = true,
                    arrivalTime = stop.arrivalTime ?: System.currentTimeMillis(),
                    actualDepartureTime = System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis()
                ))
                syncTours()
            }
        }
    }

    fun getTotalTime(type: String, now: Long): String {
        val wanted = normalizeStatus(type)
        val times = workTimes.value.filter { normalizeStatus(it.status.ifBlank { it.type }) == wanted }
        
        var totalMs = 0L
        times.forEach { wt ->
            if (wt.endTime != null) {
                totalMs += (wt.endTime - wt.startTime)
            }
        }
        
        // Csak a legutolsó nyitott bejegyzést mérjük valós időben, ha az a megfelelő típusú
        // Ez megakadályozza a "gyorsuló" időt, ha véletlenül több bejegyzés maradt nyitva
        workTimes.value.filter { it.endTime == null }
            .maxByOrNull { it.startTime }
            ?.let { latestOngoing ->
                if (normalizeStatus(latestOngoing.status.ifBlank { latestOngoing.type }) == wanted) {
                    totalMs += (now - latestOngoing.startTime)
                }
            }
        
        val hours = totalMs / 3600000
        val minutes = (totalMs % 3600000) / 60000
        return String.format("%02d:%02d", hours, minutes)
    }

    fun updateStatus(type: String, mileage: Int? = null, license_plate: String? = null) {
        viewModelScope.launch {
            val currentDriverName = driverName
            val today = getCurrentDate()
            val now = System.currentTimeMillis()
            
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] START | type=$type | driver=$currentDriverName")

            // 1. Ha már ebben a státuszban vagyunk, ne csináljunk semmit (duplikáció védelem)
            val currentlyOngoing = repository.getAllOngoingWorkTimes(currentDriverName)
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Found ${currentlyOngoing.size} ongoing tasks for $currentDriverName")
            currentlyOngoing.forEach { 
                android.util.Log.d("StatusTrace", "  Ongoing: id=${it.id}, type=${it.type}, start=${it.startTime}")
            }

            val technicalStatus = normalizeStatus(type)
            val displayType = displayStatus(type)

            if (currentlyOngoing.any { normalizeStatus(it.status.ifBlank { it.type }) == technicalStatus }) {
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Status $type already active, skipping insert.")
                return@launch
            }
            
            // 2. Minden futó feladatot lezárunk
            currentlyOngoing.forEach { ongoing ->
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Closing ongoing task: ${ongoing.type} (id=${ongoing.id})")
                repository.updateWorkTime(ongoing.copy(
                    endTime = now, 
                    durationMs = now - ongoing.startTime,
                    endMileage = if (technicalStatus == "OFFLINE") mileage else ongoing.endMileage,
                    updatedAt = now,
                    syncState = "PENDING"
                ))
            }
            
            // 3. Új feladat indítása (ha nem kilépés)
            if (technicalStatus != "OFFLINE") {
                val newWork = WorkTime(
                    driverName = currentDriverName,
                    type = displayType,
                    status = technicalStatus,
                    startTime = now,
                    date = today,
                    mileage = mileage,
                    licensePlate = license_plate,
                    updatedAt = now,
                    syncState = "PENDING"
                )
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Inserting new task: $type (UUID=${newWork.uuid})")
                repository.insertWorkTime(newWork)
                
                // Verification read-back
                val verify = repository.getAllOngoingWorkTimes(currentDriverName)
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Post-insert verification: found ${verify.size} ongoing tasks")
                verify.forEach { 
                    android.util.Log.d("StatusTrace", "  Verify Ongoing: id=${it.id}, type=${it.type}, start=${it.startTime}, uuid=${it.uuid}")
                }
            }
            syncWithBackend()
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] END")
        }
    }

    private fun syncWithBackend() {
        viewModelScope.launch {
            try {
                android.util.Log.d("SyncDebug", "DashboardViewModel: START syncWithBackend (WorkTimes)")
                
                val pending = repository.getPendingWorkTimes(driverName).map { wt ->
                    gson.toJsonTree(wt).asJsonObject.apply {
                        addProperty("baseRevision", wt.revision)
                        addProperty("type", wt.type)
                        addProperty("status", normalizeStatus(wt.status.ifBlank { wt.type }))
                        addProperty("start_time", wt.startTime)
                        if (wt.endTime != null) addProperty("end_time", wt.endTime)
                        addProperty("duration_ms", wt.durationMs)
                        addProperty("driver_name", wt.driverName)
                        addProperty("sync_state", wt.syncState)
                    }
                }
                when (val result = deltaSyncEngine.sync(0L, mapOf("work_times" to pending))) {
                    is DeltaSyncResult.Success -> {
                        val remoteArray = result.pulled.changes["work_times"]
                        val remoteWorkTimes = mutableListOf<WorkTime>()
                        if (remoteArray != null) {
                            for (json in remoteArray) {
                                runCatching { gson.fromJson(json, WorkTime::class.java) }
                                    .getOrNull()
                                    ?.let { remoteWorkTimes.add(it) }
                            }
                        }
                        repository.syncRemoteWorkTimes(driverName, remoteWorkTimes)
                    }
                    is DeltaSyncResult.Conflict -> {
                        android.util.Log.w("SyncDebug", "DashboardViewModel: Work Time conflict ${result.conflict.error}")
                        refreshWorkTimeConflicts()
                    }
                    is DeltaSyncResult.Failed -> {
                        android.util.Log.e("SyncDebug", "DashboardViewModel: Delta Work Time sync failed", result.error)
                    }
                }
                android.util.Log.d("SyncDebug", "DashboardViewModel: syncWithBackend COMPLETED")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "DashboardViewModel: Failed to sync work times", e)
            }
        }
    }

    private fun haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    fun deleteWorkTime(workTime: WorkTime) {
        viewModelScope.launch {
            repository.deleteWorkTime(workTime)
        }
    }

    fun updateWorkTime(workTime: WorkTime) {
        viewModelScope.launch {
            repository.updateWorkTime(workTime)
        }
    }

    fun refreshWorkTimeConflicts() {
        viewModelScope.launch {
            runCatching { backendApi.getWorkTimeConflicts() }
                .onSuccess { _workTimeConflicts.value = it }
                .onFailure { android.util.Log.w("SyncDebug", "Could not load Work Time conflicts", it) }
        }
    }

    fun acceptServerConflict(uuid: String) {
        viewModelScope.launch {
            runCatching { backendApi.acceptWorkTimeServerConflict(uuid) }
                .onSuccess { refreshWorkTimeConflicts() }
                .onFailure { android.util.Log.w("SyncDebug", "Could not accept server Work Time conflict", it) }
        }
    }

    fun reapplyLocalConflict(uuid: String) {
        viewModelScope.launch {
            runCatching { backendApi.reapplyWorkTimeLocalConflict(uuid) }
                .onSuccess {
                    refreshWorkTimeConflicts()
                    syncWithBackend()
                }
                .onFailure { android.util.Log.w("SyncDebug", "Could not reapply Work Time conflict", it) }
        }
    }

    fun deferConflict(uuid: String) {
        viewModelScope.launch {
            runCatching { backendApi.deferWorkTimeConflict(uuid) }
                .onSuccess { refreshWorkTimeConflicts() }
                .onFailure { android.util.Log.w("SyncDebug", "Could not defer Work Time conflict", it) }
        }
    }
}
