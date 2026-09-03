package io.freetalk.mobile

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class MediaCacheTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun cachedImagesSurviveNewInstanceAndAccountsAreIsolated() = runBlocking {
        val dir = folder.newFolder()
        val cache = MediaCache(dir)
        cache.image("a", "image", false, null) { byteArrayOf(1, 2, 3) }
        val restored = MediaCache(dir)
        assertArrayEquals(byteArrayOf(1, 2, 3), restored.image("a", "image", false, null) { error("Must use disk") })
        assertArrayEquals(byteArrayOf(4), restored.image("b", "image", false, null) { byteArrayOf(4) })
        assertEquals(2, restored.entryCount())
        restored.clear()
        assertEquals(0L, restored.sizeBytes())
    }

    @Test fun fullSizeAndThumbnailHaveSeparateEntries() = runBlocking {
        val cache = MediaCache(folder.newFolder())
        cache.image("a", "image", false, null) { byteArrayOf(1) }
        cache.image("a", "image", true, null) { byteArrayOf(2) }
        assertEquals(2, cache.entryCount())
    }

    @Test fun limitEvictsOldEntries() = runBlocking {
        val cache = MediaCache(folder.newFolder(), 5)
        cache.image("a", "one", false, null) { byteArrayOf(1, 2, 3) }
        cache.directory.listFiles()!!.single().setLastModified(1)
        cache.image("a", "two", false, null) { byteArrayOf(4, 5, 6) }
        assertEquals(3L, cache.sizeBytes())
        assertArrayEquals(byteArrayOf(4, 5, 6), cache.image("a", "two", false, null) { error("Must be cached") })
    }

    @Test fun expiredImagesAreNotReturned() = runBlocking {
        val cache = MediaCache(folder.newFolder())
        cache.image("a", "one", false, null) { byteArrayOf(1) }
        val result = runCatching { cache.image("a", "one", false, 1) { error("Must not download") } }
        assertTrue(result.isFailure)
        assertEquals(0, cache.entryCount())
    }

    @Test fun clearDuringDownloadDoesNotRefillDisk() = runBlocking {
        val cache = MediaCache(folder.newFolder())
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        val download = async {
            cache.image("a", "one", false, null) { started.complete(Unit); finish.await(); byteArrayOf(1) }
        }
        started.await()
        cache.clear()
        finish.complete(Unit)
        download.await()
        assertEquals(0L, cache.sizeBytes())
    }
}
