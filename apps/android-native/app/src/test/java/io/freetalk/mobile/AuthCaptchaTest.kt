package io.freetalk.mobile

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AuthCaptchaTest {
    private val required = ApiException("CAPTCHA_REQUIRED", "Проверка CAPTCHA", 403)

    @Test fun successfulFirstAttemptSkipsWidget() = runBlocking {
        val result = withAuthCaptcha({ error("unnecessary challenge") }) { token ->
            assertNull(token)
            "accepted"
        }
        assertEquals("accepted", result)
    }

    @Test fun challengeRetriesOnceWithFreshToken() = runBlocking {
        val tokens = mutableListOf<String?>()
        val outcome = runCatching {
            withAuthCaptcha({ "fresh" }) { token ->
                tokens += token
                throw required
            }
        }
        assertEquals(listOf(null, "fresh"), tokens)
        assertSame(required, outcome.exceptionOrNull())
    }

    @Test fun dismissingChallengeDoesNotRetryAndOtherErrorsSkipWidget() = runBlocking {
        var submissions = 0
        val cancelled = runCatching {
            withAuthCaptcha({ null }) { submissions++; throw required }
        }
        assertTrue(cancelled.exceptionOrNull() is CaptchaDismissed)
        assertEquals(1, submissions)
        val error = ApiException("INVALID_CREDENTIALS", "unauthorized", 401)
        val other = runCatching { withAuthCaptcha({ error("unexpected challenge") }) { throw error } }
        assertSame(error, other.exceptionOrNull())
    }
}
