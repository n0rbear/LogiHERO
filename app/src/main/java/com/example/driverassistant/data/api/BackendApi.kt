package com.example.driverassistant.data.api

import com.example.driverassistant.domain.model.*
import retrofit2.http.*

data class LiveUpdate(
    val uuid: String? = null,
    val driverName: String,
    val driverPhoto: String? = null,
    val driverPhone: String? = null,
    val driverEmail: String? = null,
    val licensePlate: String,
    val latitude: Double,
    val longitude: Double,
    val speed: Float,
    val status: String? = null,
    val timestamp: Long,
    val currentTour: String? = null,
    val nextStop: String? = null,
    val nextLat: Double? = null,
    val nextLng: Double? = null,
    val nextStopDistance: Float? = null,
    val tourRemainingDistance: Float? = null,
    val tourRemainingDuration: Long? = null, // In seconds
    val nextStopDuration: Long? = null, // In seconds
    val depotName: String? = null,
    val depotLat: Double? = null,
    val depotLng: Double? = null,
    val includeRests: Boolean = true,
    val nextBreakInSeconds: Long? = null
)

data class TourWithStops(
    val tour: Tour,
    val stops: List<Stop>,
    val cargo: List<Cargo>? = null
)

data class CostStatusUpdate(
    val id: Long, // Server ID
    val uuid: String? = null,
    val status: String,
    val timestamp: Long,
    val amount: Double
)

data class ApiChatMessage(
    val uuid: String? = null,
    val driverName: String,
    val sender: String,
    val message: String,
    val timestamp: Long
)

data class SetCurrentTourRequest(
    val driverName: String,
    val tourUuid: String
)

data class LiveUpdateResponse(
    val status: String,
    val licensePlate: String? = null,
    val nextStopDist: Float? = null,
    val nextStopDur: Long? = null,
    val tourRemainingDist: Float? = null,
    val tourRemainingDur: Long? = null,
    val nextStopInfo: String? = null,
    val nextLat: Double? = null,
    val nextLng: Double? = null,
    val depotName: String? = null,
    val depotLat: Double? = null,
    val depotLng: Double? = null
)

data class ApiProfile(
    val uuid: String? = null,
    val name: String,
    val email: String,
    val phone: String,
    val whatsapp: String,
    val telegram: String,
    val licensePlate: String,
    val photoUrl: String?,
    val profileUpdatedAt: Long = 0L
)

data class ApiProfileResponse(
    val uuid: String? = null,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val whatsapp: String? = null,
    val telegram: String? = null,
    @com.google.gson.annotations.SerializedName("license_plate") val licensePlate: String? = null,
    @com.google.gson.annotations.SerializedName("photo_url") val photoUrl: String? = null,
    @com.google.gson.annotations.SerializedName("profile_updated_at") val profileUpdatedAt: Long? = null,
    val deviceToken: String? = null
)

data class ActivateDriverRequest(
    val code: String,
    val deviceId: String,
    val deviceName: String
)

data class UnlinkDeviceRequest(
    val uuid: String? = null,
    val deviceId: String
)

data class WorkTimeConflictDto(
    val uuid: String,
    val workDayUuid: String? = null,
    val entryUuid: String? = null,
    val driverUuid: String? = null,
    val localRevision: Int? = null,
    val backendRevision: Int? = null,
    val localValue: Map<String, Any?>? = null,
    val backendValue: Map<String, Any?>? = null,
    val approvalStatus: String? = null,
    val adminCorrection: Boolean = false,
    val reason: String,
    val resolutionStatus: String = "UNRESOLVED",
    val createdAt: Long? = null,
    val resolvedAt: Long? = null
)

data class ProfileSyncResponse(
    val success: Boolean = true,
    val profileUpdatedAt: Long? = null
)

data class PhotoUploadRequest(
    val driverName: String,
    val imageBase64: String,
    val uuid: String? = null
)

data class PhotoUploadResponse(
    val photoUrl: String,
    val profileUpdatedAt: Long? = null
)

data class StopPhotoUploadRequest(
    val stopUuid: String,
    val imageBase64: String
)

data class StopPhotoUploadResponse(
    val photoUrl: String,
    val updatedAt: Long
)

interface BackendApi {
    @GET("api/sync")
    suspend fun getDeltaSync(@Query("since") since: Long): DeltaSyncResponse

    @POST("api/sync")
    suspend fun postDeltaSync(@Body request: DeltaSyncRequest): DeltaSyncApplyResponse

    @GET("api/sync/version")
    suspend fun getSyncVersion(): SyncVersionResponse

    @GET("api/cost-status/{driverName}")
    suspend fun getCostStatus(@Path("driverName") driverName: String): List<CostStatusUpdate>

    @GET("api/get-chat/{driverName}")
    suspend fun getMessages(@Path("driverName") driverName: String): List<ApiChatMessage>

    @POST("api/send-chat")
    suspend fun sendMessage(@Body message: ApiChatMessage)

    @POST("api/live-update")
    suspend fun sendLiveUpdate(@Body update: LiveUpdate): LiveUpdateResponse

    @POST("api/sync-costs")
    suspend fun syncCosts(@Body costs: List<Cost>, @Header("X-NDP-Trace-Id") traceId: String? = null)

    @POST("api/sync-tours/{driverName}")
    suspend fun syncTours(@Path("driverName") driverName: String, @Body tours: List<TourWithStops>)

    @POST("api/sync-worktimes")
    suspend fun syncWorkTimes(@Body workTimes: List<WorkTime>)

    @GET("api/get-worktimes/{driverName}")
    suspend fun getWorkTimes(@Path("driverName") driverName: String): List<WorkTime>

    @GET("api/get-costs/{driverName}")
    suspend fun getCosts(@Path("driverName") driverName: String): List<Cost>

    @GET("api/get-tours/{driverName}")
    suspend fun getTours(@Path("driverName") driverName: String): List<TourWithStops>

    @POST("api/set-current-tour")
    suspend fun setCurrentTour(@Body request: SetCurrentTourRequest)

    @POST("api/sync-hotels")
    suspend fun syncHotels(@Body hotels: List<Hotel>)

    @GET("api/get-manual-hotels/{driverName}")
    suspend fun getManualHotels(@Path("driverName") driverName: String): List<Hotel>

    @POST("api/sync-profile")
    suspend fun syncProfile(@Body profile: ApiProfile): ProfileSyncResponse

    @POST("api/activate-driver")
    suspend fun activateDriver(@Body request: ActivateDriverRequest): ApiProfileResponse

    @POST("api/unlink-device")
    suspend fun unlinkDevice(@Body request: UnlinkDeviceRequest)

    @GET("api/work-time/conflicts")
    suspend fun getWorkTimeConflicts(): List<WorkTimeConflictDto>

    @GET("api/work-time/conflicts/{uuid}")
    suspend fun getWorkTimeConflict(@Path("uuid") uuid: String): WorkTimeConflictDto

    @POST("api/work-time/conflicts/{uuid}/accept-server")
    suspend fun acceptWorkTimeServerConflict(@Path("uuid") uuid: String): WorkTimeConflictDto

    @POST("api/work-time/conflicts/{uuid}/reapply-local")
    suspend fun reapplyWorkTimeLocalConflict(@Path("uuid") uuid: String): WorkTimeConflictDto

    @POST("api/work-time/conflicts/{uuid}/defer")
    suspend fun deferWorkTimeConflict(@Path("uuid") uuid: String): WorkTimeConflictDto

    @GET("api/get-profile/{name}")
    suspend fun getProfile(@Path("name") name: String): ApiProfileResponse

    @GET("api/get-profile-by-uuid/{uuid}")
    suspend fun getProfileByUuid(@Path("uuid") uuid: String): ApiProfileResponse

    @POST("api/upload-photo")
    suspend fun uploadPhoto(@Body request: PhotoUploadRequest): PhotoUploadResponse

    @POST("api/upload-stop-photo")
    suspend fun uploadStopPhoto(@Body request: StopPhotoUploadRequest): StopPhotoUploadResponse

    // Hotels
    @GET("api/tours/{tourId}/hotels")
    suspend fun getHotelsForTour(@Path("tourId") tourId: Long): List<Hotel>

    @POST("api/tours/{tourId}/hotels")
    suspend fun addHotel(@Path("tourId") tourId: Long, @Body hotel: Hotel): Hotel

    @GET("api/hotels/{hotelId}")
    suspend fun getHotel(@Path("hotelId") hotelId: Long): Hotel

    @PATCH("api/hotels/{hotelId}")
    suspend fun updateHotel(@Path("hotelId") hotelId: Long, @Body hotel: Hotel): Hotel

    @DELETE("api/hotels/{hotelId}")
    suspend fun deleteHotel(@Path("hotelId") hotelId: Long): retrofit2.Response<Unit>

    @POST("api/hotels/{hotelId}/confirm")
    suspend fun confirmHotel(@Path("hotelId") hotelId: Long, @Body request: HotelStatusRequest): Hotel

    @POST("api/hotels/{hotelId}/check-in")
    suspend fun checkInHotel(@Path("hotelId") hotelId: Long, @Body request: HotelStatusRequest): Hotel

    @POST("api/hotels/{hotelId}/check-out")
    suspend fun checkOutHotel(@Path("hotelId") hotelId: Long, @Body request: HotelStatusRequest): Hotel

    @POST("api/hotels/{hotelId}/cancel")
    suspend fun cancelHotel(@Path("hotelId") hotelId: Long, @Body request: HotelStatusRequest): Hotel

    @POST("api/hotels/{hotelId}/report-problem")
    suspend fun reportHotelProblem(@Path("hotelId") hotelId: Long, @Body request: HotelStatusRequest): Hotel

    // Cargo
    @GET("api/tours/{tourId}/cargo")
    suspend fun getCargoForTour(@Path("tourId") tourId: Long): List<Cargo>

    @POST("api/tours/{tourId}/cargo")
    suspend fun addCargo(@Path("tourId") tourId: Long, @Body cargo: Cargo): Cargo

    @PATCH("api/cargo/{cargoId}")
    suspend fun updateCargo(@Path("cargoId") cargoId: Long, @Body cargo: Cargo): Cargo

    @DELETE("api/cargo/{cargoId}")
    suspend fun deleteCargo(@Path("cargoId") cargoId: Long): retrofit2.Response<Unit>

    @POST("api/cargo/{cargoId}/pickup")
    suspend fun pickupCargo(@Path("cargoId") cargoId: Long, @Body request: CargoTransitionRequest): Cargo

    @POST("api/cargo/{cargoId}/deliver")
    suspend fun deliverCargo(@Path("cargoId") cargoId: Long, @Body request: CargoTransitionRequest): Cargo

    @POST("api/cargo/{cargoId}/report-damage")
    suspend fun reportDamage(@Path("cargoId") cargoId: Long, @Body request: CargoTransitionRequest): Cargo

    @POST("api/cargo/{cargoId}/report-missing")
    suspend fun reportMissing(@Path("cargoId") cargoId: Long, @Body request: CargoTransitionRequest): Cargo
}

data class CargoTransitionRequest(
    val stopId: Long,
    val driverName: String,
    val condition: String? = null,
    val reason: String? = null,
    val clientEventId: String? = null,
    val metadata: String? = null
)

data class HotelStatusRequest(
    val driverName: String,
    val reason: String? = null,
    val clientEventId: String? = null,
    val isOverride: Boolean = false,
    val metadata: String? = null
)
