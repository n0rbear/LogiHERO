package com.example.driverassistant.ui.screen

import androidx.compose.foundation.clickable
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
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.ui.viewmodel.HotelsViewModel

@Composable
fun HotelsScreen(
    onOpenHotel: (Long) -> Unit,
    viewModel: HotelsViewModel = hiltViewModel()
) {
    val hotels by viewModel.hotels.collectAsState()

    Scaffold { padding ->
        Column(modifier = Modifier.padding(padding)) {
            Text(
                text = "Hotelek",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(16.dp)
            )

            if (hotels.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(text = "Nincsenek elérhető szállások", color = Color.Gray)
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    items(hotels) { hotel ->
                        HotelListItem(
                            hotel = hotel,
                            onClick = { onOpenHotel(hotel.id) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun HotelListItem(
    hotel: Hotel,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .clickable { onClick() }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = hotel.name, style = MaterialTheme.typography.titleLarge)
                    Text(
                        text = "${hotel.city ?: ""} ${hotel.addressLine1}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.Gray
                    )
                }
                HotelStatusBadge(hotel.status)
            }
            
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CalendarToday, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color.Gray)
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "Check-in: ${hotel.checkInDate ?: "---"}",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
fun HotelStatusBadge(status: String) {
    val (color, text) = when (status) {
        "PLANNED" -> Color.Gray to "Tervezett"
        "BOOKED" -> MaterialTheme.colorScheme.primary to "Lefoglalva"
        "CONFIRMED" -> Color(0xFF2E7D32) to "Visszaigazolva"
        "CHECKED_IN" -> Color(0xFF16884F) to "Checked In"
        "CHECKED_OUT" -> Color.Black to "Checked Out"
        "CANCELLED" -> Color.Red to "Lemondva"
        "PROBLEM" -> Color(0xFFEF6C00) to "Probléma"
        else -> Color.Gray to status
    }

    Surface(
        color = color.copy(alpha = 0.1f),
        shape = MaterialTheme.shapes.small,
        border = androidx.compose.foundation.BorderStroke(1.dp, color)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}
