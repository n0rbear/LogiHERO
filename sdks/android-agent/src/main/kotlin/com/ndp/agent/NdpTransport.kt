package com.ndp.agent

interface NdpTransport {
    fun send(configuration: NdpConfiguration, body: String): Boolean
}
