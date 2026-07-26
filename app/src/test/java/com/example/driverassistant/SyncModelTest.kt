package com.example.driverassistant

import com.example.driverassistant.domain.model.Cost
import com.example.driverassistant.domain.model.WorkTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class SyncModelTest {
    @Test
    fun workTimeHasOfflineFirstSyncMetadata() {
        val workTime = WorkTime(type = "Munka", startTime = 1L, date = "2026-07-26")
        assertNotNull(workTime.uuid)
        assertEquals("PENDING", workTime.syncState)
        assertEquals("WORK", workTime.status)
        assertEquals("PENDING", workTime.approvalStatus)
        assertEquals(1, workTime.revision)
        assertNotNull(workTime.createdAt)
        assertNotNull(workTime.updatedAt)
    }

    @Test
    fun costHasOfflineFirstSyncMetadata() {
        val cost = Cost(amount = 12.0, currency = "EUR", category = "Hotel", timestamp = 1L)
        assertNotNull(cost.uuid)
        assertEquals("SYNCED", cost.syncState)
        assertEquals(1, cost.revision)
        assertNotNull(cost.createdAt)
        assertNotNull(cost.updatedAt)
    }
}
