package com.example.driverassistant.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

object IntentUtils {
    fun openMaps(context: Context, address: String) {
        val encodedAddress = Uri.encode(address)
        
        // Try Google Maps Navigation first
        val gmapsUri = Uri.parse("google.navigation:q=$encodedAddress")
        val gmapsIntent = Intent(Intent.ACTION_VIEW, gmapsUri).setPackage("com.google.android.apps.maps")
        
        // Try Waze
        val wazeUri = Uri.parse("waze://?q=$encodedAddress&navigate=yes")
        val wazeIntent = Intent(Intent.ACTION_VIEW, wazeUri).setPackage("com.waze")

        if (gmapsIntent.resolveActivity(context.packageManager) != null) {
            context.startActivity(gmapsIntent)
        } else if (wazeIntent.resolveActivity(context.packageManager) != null) {
            context.startActivity(wazeIntent)
        } else {
            // Generic fallback
            val genericUri = Uri.parse("geo:0,0?q=$encodedAddress")
            val genericIntent = Intent(Intent.ACTION_VIEW, genericUri)
            try {
                context.startActivity(genericIntent)
            } catch (e: Exception) {
                Toast.makeText(context, "Nem található navigációs app", Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun dialPhoneNumber(context: Context, phoneNumber: String) {
        val intent = Intent(Intent.ACTION_DIAL).apply {
            data = Uri.parse("tel:$phoneNumber")
        }
        context.startActivity(intent)
    }

    fun sendEmail(context: Context, email: String) {
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:")
            putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
            putExtra(Intent.EXTRA_SUBJECT, "LogiHERO üzenet")
        }
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Nincs e-mail kliens telepítve", Toast.LENGTH_SHORT).show()
        }
    }
}
