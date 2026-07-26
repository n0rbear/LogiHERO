package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.data.api.WorkTimeConflictDto
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.ui.viewmodel.DashboardViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun WorkTimeScreen(viewModel: DashboardViewModel = hiltViewModel()) {
    val workTimes by viewModel.workTimes.collectAsState()
    val ongoing by viewModel.ongoingWorkTime.collectAsState()
    val serverConflicts by viewModel.workTimeConflicts.collectAsState()
    LaunchedEffect(Unit) { viewModel.refreshWorkTimeConflicts() }
    val now by produceState(initialValue = System.currentTimeMillis()) {
        while (true) {
            value = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }

    WorkTimeScreenContent(
        workTimes = workTimes,
        ongoing = ongoing,
        serverConflicts = serverConflicts,
        now = now,
        onStatusChange = viewModel::updateStatus,
        onAcceptServer = viewModel::acceptServerConflict,
        onReapplyLocal = viewModel::reapplyLocalConflict,
        onDefer = viewModel::deferConflict
    )
}

@Composable
fun WorkTimeScreenContent(
    workTimes: List<WorkTime>,
    ongoing: WorkTime?,
    serverConflicts: List<WorkTimeConflictDto>,
    now: Long,
    onStatusChange: (String) -> Unit,
    onAcceptServer: (String) -> Unit,
    onReapplyLocal: (String) -> Unit,
    onDefer: (String) -> Unit
) {
    val pending = workTimes.count { it.syncState != "SYNCED" }
    val conflicts = workTimes.count { it.syncState == "CONFLICT" } + serverConflicts.count { it.resolutionStatus == "UNRESOLVED" }
    val approval = workTimes.firstOrNull { it.approvalStatus != "PENDING" }?.approvalStatus ?: "PENDING"

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            ElevatedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Work Time", style = MaterialTheme.typography.headlineSmall)
                    Text("Current status: ${displayStatus(ongoing)}", style = MaterialTheme.typography.titleMedium)
                    Text("Current status duration: ${durationText((ongoing?.startTime ?: now).let { now - it })}")
                    Text("Work day start: ${ongoing?.startTime?.let(::timeText) ?: "-"}")
                    Text("Pending sync: $pending | Conflicts: $conflicts | Approval: $approval")
                    if (conflicts > 0) {
                        Text("Conflict review required. Compare local and server values before accepting server, reapplying local, or deferring.", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        item { SummaryGrid(workTimes, now) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Work", Modifier.weight(1f)) { onStatusChange("WORK") }
                    BigStatusButton("Driving", Modifier.weight(1f)) { onStatusChange("DRIVING") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Break", Modifier.weight(1f)) { onStatusChange("BREAK") }
                    BigStatusButton("Rest", Modifier.weight(1f)) { onStatusChange("REST") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Availability", Modifier.weight(1f)) { onStatusChange("AVAILABILITY") }
                    OutlinedButton(onClick = { onStatusChange("OFFLINE") }, modifier = Modifier.weight(1f).height(56.dp)) {
                        Text("End day")
                    }
                }
            }
        }
        item { Text("Daily timeline", style = MaterialTheme.typography.titleMedium) }
        items(workTimes.sortedBy { it.startTime }) { entry ->
            ElevatedCard {
                Column(Modifier.padding(12.dp)) {
                    Text("${entry.status} | ${timeText(entry.startTime)} - ${entry.endTime?.let(::timeText) ?: "open"}")
                    Text("Duration: ${durationText((entry.endTime ?: now) - entry.startTime)} | Sync: ${entry.syncState}")
                    if (entry.manualEdit) Text("Admin/manual correction", color = MaterialTheme.colorScheme.error)
                    if (entry.correctionReason != null) Text("Reason: ${entry.correctionReason}")
                }
            }
        }
        if (serverConflicts.isNotEmpty()) {
            item { Text("Conflicts", style = MaterialTheme.typography.titleMedium) }
            items(serverConflicts, key = { it.uuid }) { conflict ->
                ConflictCard(
                    conflict = conflict,
                    onAcceptServer = { onAcceptServer(conflict.uuid) },
                    onReapplyLocal = { onReapplyLocal(conflict.uuid) },
                    onDefer = { onDefer(conflict.uuid) }
                )
            }
        }
    }
}

@Composable
fun ConflictCard(
    conflict: WorkTimeConflictDto,
    onAcceptServer: () -> Unit,
    onReapplyLocal: () -> Unit,
    onDefer: () -> Unit
) {
    val manualReview = conflict.approvalStatus == "APPROVED" ||
        conflict.adminCorrection ||
        conflict.reason.contains("SOFT_DELETED") ||
        conflict.reason.contains("OVERLAP")
    ElevatedCard {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("UUID: ${conflict.uuid}", style = MaterialTheme.typography.labelLarge)
            Text("Status: ${conflict.resolutionStatus} | Reason: ${conflict.reason}")
            Text("Day: ${conflict.workDayUuid ?: "-"} | Entry: ${conflict.entryUuid ?: "-"}")
            Text("Local revision: ${conflict.localRevision ?: "-"} | Backend revision: ${conflict.backendRevision ?: "-"}")
            Text("Approval: ${conflict.approvalStatus ?: "-"} | Admin correction: ${if (conflict.adminCorrection) "yes" else "no"}")
            Text("Created: ${conflict.createdAt?.let(::timeText) ?: "-"}")
            Text("Local value: ${friendlyValue(conflict.localValue)}")
            Text("Server value: ${friendlyValue(conflict.backendValue)}")
            if (manualReview) Text("Manual admin review required.", color = MaterialTheme.colorScheme.error)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAcceptServer, modifier = Modifier.weight(1f), enabled = conflict.resolutionStatus == "UNRESOLVED") {
                    Text("Server")
                }
                OutlinedButton(onClick = onReapplyLocal, modifier = Modifier.weight(1f), enabled = conflict.resolutionStatus == "UNRESOLVED" && !manualReview) {
                    Text("Reapply")
                }
                OutlinedButton(onClick = onDefer, modifier = Modifier.weight(1f), enabled = conflict.resolutionStatus == "UNRESOLVED") {
                    Text("Later")
                }
            }
        }
    }
}

@Composable
private fun SummaryGrid(workTimes: List<WorkTime>, now: Long) {
    val groups = listOf("WORK", "DRIVING", "BREAK", "REST", "AVAILABILITY")
    ElevatedCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            groups.forEach { status ->
                val total = workTimes.filter { it.status == status }.sumOf { (it.endTime ?: now) - it.startTime }
                Text("$status: ${durationText(total)}")
            }
        }
    }
}

@Composable
private fun BigStatusButton(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier.height(56.dp)) { Text(label) }
}

private fun friendlyValue(value: Map<String, Any?>?): String {
    if (value.isNullOrEmpty()) return "-"
    return listOf("date", "work_date", "status", "approval_status", "revision")
        .mapNotNull { key -> value[key]?.let { "$key=$it" } }
        .ifEmpty { value.entries.take(3).map { "${it.key}=${it.value}" } }
        .joinToString(", ")
}

private fun displayStatus(workTime: WorkTime?): String = workTime?.status ?: "OFFLINE"
private fun timeText(value: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(value))
private fun durationText(ms: Long): String {
    val minutes = (ms.coerceAtLeast(0) / 60000)
    return "%02d:%02d".format(minutes / 60, minutes % 60)
}
