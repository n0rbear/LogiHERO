package com.example.driverassistant.worktime

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.ui.screen.WorkTimeScreenContent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkTimeScreenInstrumentedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun emptyWorkDayShowsOfflineStateAndPrimaryActions() {
        val actions = mutableListOf<String>()
        compose.setContent {
            WorkTimeScreenContent(
                workTimes = emptyList(),
                ongoing = null,
                serverConflicts = emptyList(),
                now = 1_000_000L,
                onStatusChange = { actions.add(it) },
                onAcceptServer = {},
                onReapplyLocal = {},
                onDefer = {}
            )
        }

        compose.onNodeWithText("Current status: OFFLINE").assertIsDisplayed()
        compose.onNodeWithText("WORK: 00:00").assertIsDisplayed()
        compose.onNodeWithText("Work").performClick()
        assertEquals(listOf("WORK"), actions)
    }

    @Test
    fun activeDrivingDayShowsTimelineAndPendingSync() {
        compose.setContent {
            WorkTimeScreenContent(
                workTimes = listOf(
                    workTime(status = "WORK", start = 0L, end = 600_000L, syncState = "SYNCED"),
                    workTime(status = "DRIVING", start = 600_000L, end = null, syncState = "PENDING")
                ),
                ongoing = workTime(status = "DRIVING", start = 600_000L, end = null, syncState = "PENDING"),
                serverConflicts = emptyList(),
                now = 1_200_000L,
                onStatusChange = {},
                onAcceptServer = {},
                onReapplyLocal = {},
                onDefer = {}
            )
        }

        compose.onNodeWithText("Current status: DRIVING").assertIsDisplayed()
        compose.onNodeWithText("Pending sync: 1 | Conflicts: 0 | Approval: PENDING").assertIsDisplayed()
        compose.onNodeWithText("DRIVING | 00:10 - open").assertIsDisplayed()
        compose.onNodeWithText("Duration: 00:10 | Sync: PENDING").assertIsDisplayed()
    }

    @Test
    fun statusButtonsEmitWorkDrivingBreakRestAndEndDay() {
        val actions = mutableListOf<String>()
        compose.setContent {
            WorkTimeScreenContent(
                workTimes = listOf(workTime(status = "WORK", start = 0L, end = null)),
                ongoing = workTime(status = "WORK", start = 0L, end = null),
                serverConflicts = emptyList(),
                now = 60_000L,
                onStatusChange = { actions.add(it) },
                onAcceptServer = {},
                onReapplyLocal = {},
                onDefer = {}
            )
        }

        listOf("Driving", "Break", "Work", "Rest", "End day").forEach {
            compose.onNodeWithText(it).performClick()
        }
        assertEquals(listOf("DRIVING", "BREAK", "WORK", "REST", "OFFLINE"), actions)
    }

    private fun workTime(
        status: String,
        start: Long,
        end: Long?,
        syncState: String = "PENDING"
    ) = WorkTime(
        uuid = "11111111-1111-4111-8111-${start.toString().padStart(12, '0').takeLast(12)}",
        type = status,
        status = status,
        startTime = start,
        endTime = end,
        date = "2026-07-26",
        syncState = syncState
    )
}
