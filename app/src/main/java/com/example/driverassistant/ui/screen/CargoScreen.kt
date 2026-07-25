package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.domain.model.Cargo
import com.example.driverassistant.ui.viewmodel.CargoViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CargoScreen(
    tourId: Long,
    viewModel: CargoViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val cargoList by viewModel.getCargoForTour(tourId).collectAsState(initial = emptyList())
    val stops by viewModel.getStopsForTour(tourId).collectAsState(initial = emptyList())
    
    var selectedCargo by remember { mutableStateOf<Cargo?>(null) }
    var showActionDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Szállítmányok") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Vissza")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (cargoList.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Nincsenek szállítmányok ehhez a túrához.")
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                    items(cargoList) { cargo ->
                        CargoItemCard(
                            cargo = cargo,
                            onAction = {
                                selectedCargo = cargo
                                showActionDialog = true
                            }
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }
        }
    }

    if (showActionDialog && selectedCargo != null) {
        CargoActionDialog(
            cargo = selectedCargo!!,
            stops = stops,
            onDismiss = { showActionDialog = false },
            onPickup = { stopId, cond, reason ->
                viewModel.pickupCargo(selectedCargo!!, stopId, cond, reason)
                showActionDialog = false
            },
            onDeliver = { stopId, cond, reason ->
                viewModel.deliverCargo(selectedCargo!!, stopId, cond, reason)
                showActionDialog = false
            },
            onReportProblem = { stopId, type, reason ->
                viewModel.reportProblem(selectedCargo!!, stopId, type, reason)
                showActionDialog = false
            }
        )
    }
}

@Composable
fun CargoItemCard(cargo: Cargo, onAction: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onAction
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(text = cargo.name, style = MaterialTheme.typography.titleMedium)
                CargoStatusBadge(status = cargo.status)
            }
            Text(text = "Típus: ${cargo.type}", style = MaterialTheme.typography.bodySmall)
            if (!cargo.serialNumber.isNullOrBlank()) {
                Text(text = "S/N: ${cargo.serialNumber}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
            }
            Text(text = "Mennyiség: ${cargo.quantity} ${cargo.unit}", style = MaterialTheme.typography.bodySmall)
            
            Divider(modifier = Modifier.padding(vertical = 8.dp))
            
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color.Gray)
                Spacer(modifier = Modifier.width(4.dp))
                Text(text = "Pickup stop ID: ${cargo.pickupStopId ?: "---"}", style = MaterialTheme.typography.labelSmall)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Flag, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color.Gray)
                Spacer(modifier = Modifier.width(4.dp))
                Text(text = "Delivery stop ID: ${cargo.deliveryStopId ?: "---"}", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
fun CargoStatusBadge(status: String) {
    val color = when (status) {
        "PLANNED" -> Color.Gray
        "READY_FOR_PICKUP" -> Color(0xFF3498db)
        "PICKED_UP", "IN_TRANSIT" -> Color(0xFFf39c12)
        "DELIVERED" -> Color(0xFF2ecc71)
        "DAMAGED", "REJECTED" -> Color(0xFFe74c3c)
        "MISSING" -> Color.Black
        else -> Color.Gray
    }
    Surface(
        color = color,
        shape = MaterialTheme.shapes.small
    ) {
        Text(
            text = status,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White
        )
    }
}

@Composable
fun CargoActionDialog(
    cargo: Cargo,
    stops: List<com.example.driverassistant.domain.model.Stop>,
    onDismiss: () -> Unit,
    onPickup: (Long, String?, String?) -> Unit,
    onDeliver: (Long, String?, String?) -> Unit,
    onReportProblem: (Long, String, String) -> Unit
) {
    var reason by remember { mutableStateOf("") }
    var condition by remember { mutableStateOf("") }
    var selectedStopId by remember { mutableStateOf(stops.firstOrNull()?.id ?: 0L) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(text = "Művelet: ${cargo.name}") },
        text = {
            Column {
                Text(text = "S/N: ${cargo.serialNumber ?: "N/A"}")
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(text = "Helyszín választása:", style = MaterialTheme.typography.labelSmall)
                // Simplified stop selector for now
                stops.forEach { stop ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedStopId == stop.id, onClick = { selectedStopId = stop.id })
                        Text(text = stop.recipient.ifBlank { stop.address }.take(30), style = MaterialTheme.typography.bodySmall)
                    }
                }
                
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(value = condition, onValueChange = { condition = it }, label = { Text("Állapot (pl. ép, karcos)") })
                OutlinedTextField(value = reason, onValueChange = { reason = it }, label = { Text("Megjegyzés / Indoklás") })
            }
        },
        confirmButton = {
            Column {
                if (cargo.status == "PLANNED" || cargo.status == "READY_FOR_PICKUP") {
                    Button(onClick = { onPickup(selectedStopId, condition, reason) }, modifier = Modifier.fillMaxWidth()) {
                        Text("FELVÉVE")
                    }
                }
                if (cargo.status == "PICKED_UP" || cargo.status == "IN_TRANSIT") {
                    Button(onClick = { onDeliver(selectedStopId, condition, reason) }, modifier = Modifier.fillMaxWidth()) {
                        Text("ÁTADVA")
                    }
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { onReportProblem(selectedStopId, "Sérült", reason) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFe74c3c)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("SÉRÜLT")
                    }
                    Button(
                        onClick = { onReportProblem(selectedStopId, "Hiányzik", reason) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color.Black),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("HIÁNYZIK")
                    }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Mégse") }
        }
    )
}
