package com.example.driverassistant.conflicts

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.driverassistant.data.api.WorkTimeConflictDto
import com.example.driverassistant.ui.screen.ConflictCard
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkTimeConflictUiInstrumentedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun unresolvedConflictShowsReadableDetailsAndActions() {
        val actions = mutableListOf<String>()
        compose.setContent {
            val c = conflict(reason = "STALE_REVISION")
            ConflictCard(
                conflict = c,
                onAcceptServer = { actions.add("server:${c.uuid}") },
                onReapplyLocal = { actions.add("local:${c.uuid}") },
                onDefer = { actions.add("defer:${c.uuid}") }
            )
        }

        compose.onNodeWithText("Status: UNRESOLVED | Reason: STALE_REVISION").assertIsDisplayed()
        compose.onNodeWithText("Local value: status=DRIVING, approval_status=PENDING, revision=1").assertIsDisplayed()
        compose.onNodeWithText("Server value: status=WORK, approval_status=PENDING, revision=2").assertIsDisplayed()
        compose.onNodeWithText("Server").performClick()
        compose.onNodeWithText("Reapply").performClick()
        compose.onNodeWithText("Later").performClick()
        assertEquals(listOf("server:conflict-1", "local:conflict-1", "defer:conflict-1"), actions)
    }

    @Test
    fun approvedConflictRequiresManualReviewAndDisablesReapply() {
        compose.setContent {
            ConflictCard(
                conflict = conflict(reason = "APPROVED_RECORD_LOCKED", approval = "APPROVED"),
                onAcceptServer = {},
                onReapplyLocal = {},
                onDefer = {}
            )
        }

        compose.onNodeWithText("Manual admin review required.").assertIsDisplayed()
        compose.onNodeWithText("Reapply").assertIsNotEnabled()
        compose.onNodeWithText("Server").assertIsEnabled()
        compose.onNodeWithText("Later").assertIsEnabled()
    }

    @Test
    fun deferredConflictRemainsVisibleButActionsDisabled() {
        compose.setContent {
            ConflictCard(
                conflict = conflict(reason = "STALE_REVISION", status = "DEFERRED"),
                onAcceptServer = {},
                onReapplyLocal = {},
                onDefer = {}
            )
        }

        compose.onNodeWithText("Status: DEFERRED | Reason: STALE_REVISION").assertIsDisplayed()
        compose.onNodeWithText("Server").assertIsNotEnabled()
        compose.onNodeWithText("Reapply").assertIsNotEnabled()
        compose.onNodeWithText("Later").assertIsNotEnabled()
    }

    private fun conflict(reason: String, approval: String = "PENDING", status: String = "UNRESOLVED") = WorkTimeConflictDto(
        uuid = "conflict-1",
        workDayUuid = "day-1",
        entryUuid = "entry-1",
        localRevision = 1,
        backendRevision = 2,
        localValue = mapOf("status" to "DRIVING", "approval_status" to approval, "revision" to 1),
        backendValue = mapOf("status" to "WORK", "approval_status" to approval, "revision" to 2),
        approvalStatus = approval,
        reason = reason,
        resolutionStatus = status,
        createdAt = 1_000L
    )
}
