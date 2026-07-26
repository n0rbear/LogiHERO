package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.ui.viewmodel.HotelsViewModel
import com.example.driverassistant.util.IntentUtils

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HotelDetailScreen(
    hotelId: Long,
    onBack: () -> Unit,
    viewModel: HotelsViewModel = hiltViewModel()
) {
    val hotel by viewModel.getHotelById(hotelId).collectAsState(initial = null)
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    var showProblemDialog by remember { mutableStateOf(false) }
    var problemReason by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Hotel részletek") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Vissza")
                    }
                }
            )
        }
    ) { padding ->
        hotel?.let { h ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = h.name,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    HotelStatusBadge(h.status)
                }

                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "${h.postalCode ?: ""} ${h.city ?: ""} ${h.addressLine1}",
                    style = MaterialTheme.typography.bodyLarge
                )
                if (h.addressLine2?.isNotBlank() == true) {
                    Text(text = h.addressLine2, style = MaterialTheme.typography.bodyMedium)
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Actions Card
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(text = "Műveletek", style = MaterialTheme.typography.titleMedium)
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val isValidCoord = h.latitude != null && h.longitude != null && h.latitude != 0.0
                            
                            Button(
                                onClick = { 
                                    if (isValidCoord) {
                                        IntentUtils.openMaps(context, "${h.latitude},${h.longitude}") 
                                    } else {
                                        IntentUtils.openMaps(context, "${h.city} ${h.addressLine1}")
                                    }
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Default.Navigation, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Navigáció")
                            }

                            if (h.phone?.isNotBlank() == true) {
                                Button(
                                    onClick = { IntentUtils.dialPhoneNumber(context, h.phone) },
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
                                ) {
                                    Icon(Icons.Default.Phone, contentDescription = null)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Hívás")
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Booking Info
                InfoItem(label = "Foglalási szám", value = h.bookingNumber ?: "---", onCopy = { clipboardManager.setText(AnnotatedString(it)) })
                InfoItem(label = "Foglalási szolgáltató", value = h.bookingProvider ?: "---")
                InfoItem(label = "Check-in", value = "${h.checkInDate ?: "---"} ${h.checkInTime ?: ""}")
                InfoItem(label = "Check-out", value = "${h.checkOutDate ?: "---"} ${h.checkOutTime ?: ""}")
                InfoItem(label = "Szoba", value = h.roomNumber ?: "---")
                InfoItem(label = "Belépőkód", value = h.entryCode ?: "---", color = MaterialTheme.colorScheme.primary)
                
                if (h.notes?.isNotBlank() == true) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(text = "Megjegyzés", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                    Text(text = h.notes, style = MaterialTheme.typography.bodyMedium)
                }

                Spacer(modifier = Modifier.height(32.dp))

                // Status Buttons
                if (h.status != "CHECKED_OUT" && h.status != "CANCELLED") {
                    if (h.status != "CHECKED_IN") {
                        Button(
                            onClick = { viewModel.transitionStatus(h, "CHECKED_IN") },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16884F))
                        ) {
                            Text("CHECK-IN")
                        }
                    } else {
                        Button(
                            onClick = { viewModel.transitionStatus(h, "CHECKED_OUT") },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Black)
                        ) {
                            Text("CHECK-OUT")
                        }
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    OutlinedButton(
                        onClick = { showProblemDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF6C00))
                    ) {
                        Text("PROBLÉMA JELZÉSE")
                    }
                }
            }
        } ?: Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
    }

    if (showProblemDialog) {
        AlertDialog(
            onDismissRequest = { showProblemDialog = false },
            title = { Text("Probléma jelentése") },
            text = {
                TextField(
                    value = problemReason,
                    onValueChange = { problemReason = it },
                    placeholder = { Text("Mi a probléma?") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(onClick = {
                    hotel?.let { viewModel.transitionStatus(it, "PROBLEM", problemReason) }
                    showProblemDialog = false
                }) {
                    Text("Küldés")
                }
            },
            dismissButton = {
                TextButton(onClick = { showProblemDialog = false }) {
                    Text("Mégse")
                }
            }
        )
    }
}

@Composable
fun InfoItem(label: String, value: String, color: Color = Color.Unspecified, onCopy: ((String) -> Unit)? = null) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = Color.Gray)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = value,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = color,
                modifier = Modifier.weight(1f)
            )
            if (onCopy != null && value != "---") {
                IconButton(onClick = { onCopy(value) }, modifier = Modifier.size(24.dp)) {
                    Icon(Icons.Default.ContentCopy, contentDescription = "Másolás", modifier = Modifier.size(16.dp))
                }
            }
        }
        Divider(modifier = Modifier.padding(top = 4.dp), thickness = 0.5.dp, color = Color.LightGray)
    }
}
