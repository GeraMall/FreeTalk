package io.freetalk.mobile

import android.content.Context
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

class MediaCache internal constructor(val directory: File, private val maxBytes: Long = 384L * 1024L * 1024L) {
    constructor(context: Context) : this(File(context.cacheDir, "chat-media"))
    private val lock = Any()
    private val downloads = Semaphore(2)
    private var generation = 0L
    init { directory.mkdirs() }

    fun sizeBytes(): Long = synchronized(lock) { files().sumOf { it.length() } }
    fun entryCount(): Int = synchronized(lock) { files().size }
    fun clear() = synchronized(lock) {
        generation++
        files().forEach { it.delete() }
        Unit
    }
    fun trim() = synchronized(lock) {
        var total = files().sumOf { it.length() }
        for (file in files().sortedBy { it.lastModified() }) {
            if (total <= maxBytes) break
            val length = file.length()
            if (file.delete()) total -= length
        }
    }

    suspend fun image(
        accountId: String, messageId: String, full: Boolean, expiresAtMillis: Long?,
        fetch: suspend () -> ByteArray,
    ): ByteArray = withContext(Dispatchers.IO) {
        val key = MessageDigest.getInstance("SHA-256")
            .digest("$accountId/$messageId/$full".toByteArray())
            .joinToString("") { "%02x".format(it) }
        val file = File(directory, key)
        fun cached(): ByteArray? = synchronized(lock) {
            if (expiresAtMillis != null && expiresAtMillis <= System.currentTimeMillis()) {
                file.delete()
                error("Срок хранения фотографии истёк")
            }
            if (file.isFile) {
                file.setLastModified(System.currentTimeMillis())
                file.readBytes()
            } else null
        }
        cached()?.let { return@withContext it }
        downloads.withPermit {
            cached()?.let { return@withPermit it }
            val startedGeneration = synchronized(lock) { generation }
            val bytes = fetch()
            require(bytes.isNotEmpty() && bytes.size <= maxBytes) { "Недопустимый размер фотографии" }
            synchronized(lock) {
                if (expiresAtMillis != null && expiresAtMillis <= System.currentTimeMillis()) error("Срок хранения фотографии истёк")
                // Clearing during a download must not silently refill the cache.
                if (generation == startedGeneration && !file.exists()) {
                    val temporary = File.createTempFile("image-", ".part", directory)
                    try {
                        temporary.writeBytes(bytes)
                        check(temporary.renameTo(file)) { "Не удалось сохранить фото в кэш" }
                        trim()
                    } finally { temporary.delete() }
                }
            }
            bytes
        }
    }
    private fun files(): List<File> = directory.listFiles()?.filter { it.isFile }.orEmpty()
}
