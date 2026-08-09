package com.example.driverassistant

import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class AndroidMistralCredentialBoundaryTest {
    private val root = File(System.getProperty("user.dir")).let { cwd ->
        if (File(cwd, "app/build.gradle.kts").exists()) cwd else cwd.parentFile
    }

    @Test
    fun androidDoesNotEmbedPrivilegedMistralCredentialConfiguration() {
        val appBuild = File(root, "app/build.gradle.kts").readText()
        assertFalse(appBuild.contains("MISTRAL_API_KEY"))
        assertFalse(appBuild.contains("BuildConfig.MISTRAL"))
    }

    @Test
    fun androidMainSourceDoesNotCallMistralDirectly() {
        val mainSource = File(root, "app/src/main/java")
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .joinToString("\n") { it.readText() }

        assertFalse(mainSource.contains("https://api.mistral.ai/"))
        assertFalse(mainSource.contains("api.mistral.ai"))
        assertFalse(mainSource.contains("AiAuth"))
        assertFalse(mainSource.contains("MISTRAL_API_KEY"))
        assertFalse(mainSource.contains("@Header(\"Authorization\") authHeader"))
    }
}
