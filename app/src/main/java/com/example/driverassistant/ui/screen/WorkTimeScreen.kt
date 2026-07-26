package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.ui.viewmodel.DashboardViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun WorkTimeScreen(viewModel: DashboardViewModel = hiltViewModel()) {
    val workTimes by viewModel.workTimes.collectAsState()
    val ongoing by viewModel.ongoingWorkTime.collectAsState()
    val now by produceState(initialValue = System.currentTimeMillis()) {
        while (true) {
            value = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }
    val pending = workTimes.count { it.syncState != "SYNCED" }
    val conflicts = workTimes.count { it.syncState == "CONFLICT" }
    val approval = workTimes.firstOrNull { it.approvalStatus != "PENDING" }?.approvalStatus ?: "PENDING"

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            ElevatedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Munkaidő", style = MaterialTheme.typography.headlineSmall)
                    Text("Aktuális státusz: ${displayStatus(ongoing)}", style = MaterialTheme.typography.titleMedium)
                    Text("Aktuális státusz ideje: ${durationText((ongoing?.startTime ?: now).let { now - it })}")
                    Text("Munkanap kezdete: ${ongoing?.startTime?.let(::timeText) ?: "-"}")
                    Text("Pending sync: $pending · Konfliktus: $conflicts · Jóváhagyás: $approval")
                    if (conflicts > 0) {
                        Text("Konfliktus kezelése: nézd át a szerver és helyi változatot, majd fogadd el a szerverváltozatot vagy küldd újra a helyit új revision alapján.", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        item {
            SummaryGrid(workTimes, now)
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Work", Modifier.weight(1f)) { viewModel.updateStatus("WORK") }
                    BigStatusButton("Driving", Modifier.weight(1f)) { viewModel.updateStatus("DRIVING") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Break", Modifier.weight(1f)) { viewModel.updateStatus("BREAK") }
                    BigStatusButton("Rest", Modifier.weight(1f)) { viewModel.updateStatus("REST") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigStatusButton("Availability", Modifier.weight(1f)) { viewModel.updateStatus("AVAILABILITY") }
                    OutlinedButton(onClick = { viewModel.updateStatus("OFFLINE") }, modifier = Modifier.weight(1f).height(56.dp)) { Text("Nap lezárása") }
                }
            }
        }
        item { Text("Napi timeline", style = MaterialTheme.typography.titleMedium) }
        items(workTimes.sortedBy { it.startTime }) { entry ->
            ElevatedCard {
                Column(Modifier.padding(12.dp)) {
                    Text("${entry.status} · ${timeText(entry.startTime)} - ${entry.endTime?.let(::timeText) ?: "nyitott"}")
                    Text("Időtartam: ${durationText((entry.endTime ?: now) - entry.startTime)} · Sync: ${entry.syncState}")
                    if (entry.manualEdit) Text("Admin/manual korrekció", color = MaterialTheme.colorScheme.error)
                    if (entry.correctionReason != null) Text("Indok: ${entry.correctionReason}")
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

private fun displayStatus(workTime: WorkTime?): String = workTime?.status ?: "OFFLINE"
private fun timeText(value: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(value))
private fun durationText(ms: Long): String {
    val minutes = (ms.coerceAtLeast(0) / 60000)
    return "%02d:%02d".format(minutes / 60, minutes % 60)
}
