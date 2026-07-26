package com.example.driverassistant.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.driverassistant.data.local.DriverDatabase
import com.example.driverassistant.domain.model.WorkTime
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkTimeRoomPersistenceInstrumentedTest {
    private lateinit var db: DriverDatabase

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            DriverDatabase::class.java
        ).allowMainThreadQueries().build()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun pendingWorkTimePersistsInRoom() = runBlocking {
        val row = workTime("pending-1", syncState = "PENDING")
        db.dao.insertWorkTime(row)
        assertEquals("PENDING", db.dao.getWorkTimeByUuid("pending-1")?.syncState)
    }

    @Test
    fun conflictWorkTimePersistsAfterDatabaseReopenEquivalentRead() = runBlocking {
        val row = workTime("conflict-1", syncState = "CONFLICT", approval = "CORRECTION_REQUIRED")
        db.dao.insertWorkTime(row)
        val loaded = db.dao.getWorkTimeByUuid("conflict-1")
        assertNotNull(loaded)
        assertEquals("CONFLICT", loaded?.syncState)
        assertEquals("CORRECTION_REQUIRED", loaded?.approvalStatus)
    }

    private fun workTime(uuid: String, syncState: String, approval: String = "PENDING") = WorkTime(
        uuid = uuid,
        type = "WORK",
        status = "WORK",
        startTime = 1_000L,
        endTime = null,
        date = "2026-07-26",
        syncState = syncState,
        approvalStatus = approval
    )
}
